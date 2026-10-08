import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../app/api/public/verification/route';
import { POST as lookup } from '../../app/api/public/parcels/route';
import { POST as detect } from '../../app/api/public/detect/route';
import { SupabaseServiceClient } from './supabase';
import * as amazon from './amazonShippingEligibility';
import { requireLookupProof, turnstileSettings, verifyLookupBrowser } from './lookupVerification';

const request = (proof?: string, ip = '192.0.2.8', hostname = 'peek.example') => new NextRequest(`https://${hostname}/api/public/parcels`, {
  headers: { host: hostname, 'x-real-ip': ip, ...(proof ? { 'x-lookup-proof': proof } : {}) },
});
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  vi.stubEnv('TURNSTILE_SITE_KEY', 'test-site-key');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-server-secret');
  vi.stubEnv('TURNSTILE_HOSTNAMES', 'peek.example,old.example');
  vi.stubEnv('TURNSTILE_ALLOW_NATIVE_USER_AGENT', 'false');
  vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, hostname: 'peek.example', action: 'parcel_lookup' })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('lookup verification', () => {
  it('requires complete configuration and refuses production test keys', () => {
    expect(turnstileSettings({})).toBeNull();
    expect(() => turnstileSettings({ TURNSTILE_SITE_KEY: 'key' })).toThrow('configured together');
    expect(() => turnstileSettings({ NODE_ENV: 'production', TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_HOSTNAMES: 'peek.example' })).toThrow('test keys');
  });

  it('binds a verified proof to its hostname, expires it, and rejects tampering', async () => {
    vi.useFakeTimers();
    const { proof } = await verifyLookupBrowser(request(), 'one-use-token');
    expect(() => requireLookupProof(request(proof))).not.toThrow();
    expect(() => requireLookupProof(request(proof, '192.0.2.8', 'old.example'))).toThrow('verify');
    expect(() => requireLookupProof(request(`9${proof.slice(1)}`))).toThrow('verify');
    expect(() => requireLookupProof(request())).toThrow('verify');
    vi.advanceTimersByTime(15 * 60_000);
    expect(() => requireLookupProof(request(proof))).toThrow('verify');
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({ secret: 'test-server-secret', response: 'one-use-token' });
  });

  describe('refusals', () => {
    let lines: string[];
    beforeEach(() => {
      lines = [];
      vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(line); });
    });
    const events = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>).filter((line) => line.event === 'lookup_proof');
    const refusal = (attempt: Request) => {
      lines.length = 0;
      expect(() => requireLookupProof(attempt)).toThrow('verify');
      expect(events()).toHaveLength(1);
      return events()[0]!;
    };

    it('logs why each proof is refused, with address families and age but never an address or the proof', async () => {
      vi.useFakeTimers();
      const { proof } = await verifyLookupBrowser(request(), 'token');
      const [expires, nonce, network, signed] = proof.split('.') as [string, string, string, string];
      expect(proof).not.toContain('192.0.2.8');
      expect(refusal(request())).toMatchObject({ outcome: 'refused', reason: 'missing', kind: 'lookup', used_family: 'v4' });
      expect(refusal(request('not-a-proof'))).toMatchObject({ reason: 'malformed' });
      // An earlier proof format has no network, and an expiry no proof was issued with is refused before its signature.
      expect(refusal(request(`${expires}.${nonce}.${signed}`))).toMatchObject({ reason: 'malformed' });
      expect(refusal(request(`${Number(expires) + 60}.${nonce}.${network}.${signed}`))).toMatchObject({ reason: 'malformed' });
      expect(refusal(request(`${Number(expires) - 60}.${nonce}.${network}.${signed}`))).toMatchObject({ reason: 'bad_signature' });
      expect(refusal(request(`${expires}.${nonce}.6${network.slice(1)}.${signed}`))).toMatchObject({ reason: 'bad_signature' });
      expect(refusal(request(proof, '192.0.2.8', 'old.example'))).toMatchObject({ reason: 'bad_signature' });
      vi.stubEnv('TURNSTILE_SECRET_KEY', 'rotated-server-secret');
      expect(refusal(request(proof))).toMatchObject({ reason: 'bad_signature' });
      vi.stubEnv('TURNSTILE_SECRET_KEY', 'test-server-secret');
      vi.advanceTimersByTime(15 * 60_000 + 30_000);
      const detection = new NextRequest('https://peek.example/api/public/detect', { headers: { host: 'peek.example', 'x-real-ip': '2001:db8::8', 'x-lookup-proof': proof } });
      expect(refusal(detection)).toMatchObject({ reason: 'expired', kind: 'detection', issued_family: 'v4', used_family: 'v6', age_s: 930 });
      for (const line of lines.concat(JSON.stringify(events()))) {
        expect(line).not.toContain('192.0.2.8');
        expect(line).not.toContain('2001:db8');
        expect(line).not.toContain(nonce);
      }
    });

    it('keeps a proof across IPv4 and IPv6 and an address change, but not on a fourth network', async () => {
      const { proof } = await verifyLookupBrowser(request(undefined, '192.0.2.8'), 'token');
      expect(() => requireLookupProof(request(proof, '2001:db8:1:2::8'))).not.toThrow();
      expect(events()).toEqual([expect.objectContaining({ outcome: 'moved', issued_family: 'v4', used_family: 'v6', networks: 2 })]);
      // IPv6 privacy addresses rotate inside the /64: that is the same network.
      lines.length = 0;
      expect(() => requireLookupProof(request(proof, '2001:db8:1:2:aaaa::9'))).not.toThrow();
      expect(() => requireLookupProof(request(proof, '192.0.2.8'))).not.toThrow();
      expect(events()).toEqual([]);
      expect(() => requireLookupProof(request(proof, '198.51.100.20'))).not.toThrow();
      expect(events()).toEqual([expect.objectContaining({ outcome: 'moved', issued_family: 'v4', used_family: 'v4', networks: 3 })]);
      expect(refusal(request(proof, '203.0.113.30'))).toMatchObject({ outcome: 'refused', reason: 'too_many_networks', networks: 3 });
      expect(refusal(request(proof, '2001:db8:9::1'))).toMatchObject({ reason: 'too_many_networks' });
      for (const ip of ['192.0.2.8', '2001:db8:1:2::1', '198.51.100.20']) expect(() => requireLookupProof(request(proof, ip))).not.toThrow();
      // Each proof counts its own networks.
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({ success: true, hostname: 'peek.example', action: 'parcel_lookup' }));
      const other = (await verifyLookupBrowser(request(undefined, '203.0.113.30'), 'token')).proof;
      expect(() => requireLookupProof(request(other, '203.0.113.30'))).not.toThrow();
      expect(() => requireLookupProof(request(other, '2001:db8:1:2::8'))).not.toThrow();
    });

    it('remembers a bounded number of moved proofs, forgetting expired ones first', async () => {
      const moves = globalThis as { __lookupProofMoves?: Map<string, { expires: number; networks: Set<string> }> };
      const kept = moves.__lookupProofMoves;
      try {
        const now = Math.floor(Date.now() / 1_000);
        moves.__lookupProofMoves = new Map(Array.from({ length: 10_000 }, (_, index) => [`old-${index}`, { expires: now - 1, networks: new Set() }]));
        moves.__lookupProofMoves.set('live', { expires: now + 600, networks: new Set() });
        const { proof } = await verifyLookupBrowser(request(), 'token');
        expect(() => requireLookupProof(request(proof, '198.51.100.20'))).not.toThrow();
        expect([...moves.__lookupProofMoves.keys()]).toEqual(['live', proof.split('.')[1]]);
        moves.__lookupProofMoves = new Map(Array.from({ length: 10_000 }, (_, index) => [`live-${index}`, { expires: now + 600, networks: new Set() }]));
        expect(() => requireLookupProof(request(proof, '203.0.113.30'))).not.toThrow();
        expect(moves.__lookupProofMoves.size).toBe(10_000);
        expect(moves.__lookupProofMoves.has('live-0')).toBe(false);
      } finally {
        moves.__lookupProofMoves = kept;
      }
    });

    it('accepts a proof in another process with the same configuration, as after a deploy', async () => {
      const { proof } = await verifyLookupBrowser(request(), 'token');
      const moves = globalThis as { __lookupProofMoves?: unknown };
      const kept = moves.__lookupProofMoves;
      delete moves.__lookupProofMoves;
      vi.resetModules();
      try {
        const restarted = await import('./lookupVerification');
        expect(() => restarted.requireLookupProof(request(proof))).not.toThrow();
        expect(() => restarted.requireLookupProof(request(proof, '2001:db8::1'))).not.toThrow();
      } finally {
        moves.__lookupProofMoves = kept;
      }
    });
  });

  it.each([
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { success: true, hostname: 'attacker.example', action: 'parcel_lookup' },
    { success: true, hostname: 'peek.example', action: 'login' },
    null,
  ])('rejects invalid, replayed and incorrectly scoped tokens: %j', async (result) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(result));
    await expect(verifyLookupBrowser(request(), 'token')).rejects.toMatchObject({ status: 403 });
  });

  it('fails closed on an outage without exposing upstream diagnostics', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('private upstream diagnostic'));
    const error = await verifyLookupBrowser(request(), 'token').catch((error: unknown) => error);
    expect(error).toMatchObject({ status: 503 });
    expect(error).not.toHaveProperty('cause');
  });

  it('rejects unconfigured hosts and oversized tokens before calling Cloudflare', async () => {
    await expect(verifyLookupBrowser(request(undefined, '192.0.2.8', 'other.example'), 'token')).rejects.toMatchObject({ status: 403 });
    await expect(verifyLookupBrowser(request(), 'x'.repeat(2_049))).rejects.toMatchObject({ status: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a no-store proof through the public exchange route', async () => {
    const result = await POST(new NextRequest('https://peek.example/api/public/verification', {
      method: 'POST', headers: { host: 'peek.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'token' }),
    }), { params: Promise.resolve({}) });
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toMatchObject({ proof: expect.any(String), expiresAt: expect.any(Number) });
  });

  it('exempts the native app only when compatibility is enabled, keeping iPhone browsers protected', () => {
    const native = request();
    native.headers.set('User-Agent', 'PeekDeliveryTracker/1 CFNetwork/3860.500.111.2.2 Darwin/25.5.0');
    expect(() => requireLookupProof(native)).toThrow('verify');
    vi.stubEnv('TURNSTILE_ALLOW_NATIVE_USER_AGENT', 'true');
    expect(() => requireLookupProof(native)).not.toThrow();
    for (const agent of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      'AnotherApp/1 CFNetwork/3860 Darwin/25.5.0',
      'PeekDeliveryTracker/1',
      'Mozilla/5.0 PeekDeliveryTracker/1 CFNetwork/3860 Darwin/25.5.0',
    ]) {
      const browser = request();
      browser.headers.set('User-Agent', agent);
      expect(() => requireLookupProof(browser)).toThrow('verify');
    }
  });

  it('still enforces lookup and detection allowances for exempt native requests', async () => {
    vi.stubEnv('TURNSTILE_ALLOW_NATIVE_USER_AGENT', 'true');
    const allowance = vi.spyOn(SupabaseServiceClient.prototype, 'claimPublicAllowance').mockResolvedValue({ allowed: false, scope: 'bucket', overallUsed: 0 });
    const create = vi.spyOn(SupabaseServiceClient.prototype, 'createOneOffParcel');
    const check = vi.spyOn(amazon, 'checkAmazonShipping');
    for (const [handler, path] of [[lookup, 'parcels'], [detect, 'detect']] as const) {
      const response = await handler(new NextRequest(`https://peek.example/api/public/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'PeekDeliveryTracker/1 CFNetwork/3860 Darwin/25.5.0' },
        body: JSON.stringify({ trackingNumber: 'FR0000000098', carrier: 'amazon-shipping' }),
      }), { params: Promise.resolve({}) });
      expect(response.status).toBe(429);
      expect(response.headers.get('X-Lookup-Verification')).toBeNull();
    }
    expect(allowance).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it('refuses direct callers before claiming allowances, creating parcels or asking carriers', async () => {
    const allowance = vi.spyOn(SupabaseServiceClient.prototype, 'claimPublicAllowance');
    const create = vi.spyOn(SupabaseServiceClient.prototype, 'createOneOffParcel');
    const check = vi.spyOn(amazon, 'checkAmazonShipping');
    const eligibility = vi.spyOn(amazon, 'verifyAmazonShippingAddition');
    for (const [handler, path] of [[lookup, 'parcels'], [detect, 'detect']] as const) {
      const response = await handler(new NextRequest(`https://peek.example/api/public/${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Peek iPhone', 'X-Client': 'ios' },
        body: JSON.stringify({ trackingNumber: 'FR0000000098', carrier: 'amazon-shipping' }),
      }), { params: Promise.resolve({}) });
      expect(response.status).toBe(403);
      expect(response.headers.get('X-Lookup-Verification')).toBe('required');
    }
    expect(allowance).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(eligibility).not.toHaveBeenCalled();
  });

  it('requires verification before an unknown number reaches tracking services', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const retain = vi.spyOn(SupabaseServiceClient.prototype, 'recordTrackingSupportObservation').mockResolvedValue(undefined);
    const response = await detect(new NextRequest('https://peek.example/api/public/detect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackingNumber: 'TESTPARCEL123456' }),
    }), { params: Promise.resolve({}) });
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
  });
});
