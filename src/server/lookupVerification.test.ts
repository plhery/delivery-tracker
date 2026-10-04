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

  it('binds a verified proof to its network and hostname, expires it, and rejects tampering', async () => {
    vi.useFakeTimers();
    const { proof } = await verifyLookupBrowser(request(), 'one-use-token');
    expect(() => requireLookupProof(request(proof))).not.toThrow();
    expect(() => requireLookupProof(request(proof, '192.0.2.9'))).toThrow('verify');
    expect(() => requireLookupProof(request(proof, '192.0.2.8', 'old.example'))).toThrow('verify');
    expect(() => requireLookupProof(request(`9${proof.slice(1)}`))).toThrow('verify');
    expect(() => requireLookupProof(request())).toThrow('verify');
    vi.advanceTimersByTime(15 * 60_000);
    expect(() => requireLookupProof(request(proof))).toThrow('verify');
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(init!.body as string)).toEqual({ secret: 'test-server-secret', response: 'one-use-token' });
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

  it('keeps local carrier detection available without verification', async () => {
    const response = await detect(new NextRequest('https://peek.example/api/public/detect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trackingNumber: 'TESTPARCEL123456' }),
    }), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
  });
});
