import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import cbor from 'cbor';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as configuration, POST as register } from '../../app/api/public/native/verification/route';
import { POST as challengeRoute } from '../../app/api/public/native/challenge/route';
import { GET as page } from '../../app/api/public/native/turnstile/route';
import { nativeAttestSettings, nativeChallenge, nativeRequestPayload, registerNativeKey, verifyNativeRequest } from './nativeVerification';
import { verifyLookupRequest, verifyLookupBrowser } from './lookupVerification';
import { SupabaseServiceClient } from './supabase';

const appID = 'TESTTEAM01.com.example.Peek';
const keyID = Buffer.alloc(32, 7).toString('base64');
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const storedKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
function request(path = '/api/public/parcels', body = '{"trackingNumber":"SYNTHETIC"}', ip = '192.0.2.10') {
  return new NextRequest(`https://peek.example${path}`, { method: 'POST', body,
    headers: { 'Content-Type': 'application/json', host: 'peek.example', 'x-real-ip': ip } });
}
async function signedRequest(options: { counter?: number; appID?: string; extension?: object } = {}) {
  const req = request();
  const { challenge } = nativeChallenge(req, keyID, 'assertion');
  const auth = Buffer.alloc(37);
  createHash('sha256').update(options.appID ?? appID).digest().copy(auth);
  auth.writeUInt32BE(options.counter ?? 1, 33);
  if (options.extension) auth[32] = 0x80;
  const authenticatorData = options.extension ? Buffer.concat([auth, await cbor.encodeAsync(options.extension)]) : auth;
  const payload = nativeRequestPayload(req, challenge, Buffer.from('{"trackingNumber":"SYNTHETIC"}'));
  const nonce = createHash('sha256').update(Buffer.concat([authenticatorData, createHash('sha256').update(payload).digest()])).digest();
  const signature = sign('sha256', nonce, privateKey);
  req.headers.set('X-App-Attest-Key-Id', keyID);
  req.headers.set('X-App-Attest-Challenge', challenge);
  req.headers.set('X-App-Attest-Assertion', (await cbor.encodeAsync({ signature, authenticatorData })).toString('base64'));
  return req;
}
const service = new SupabaseServiceClient('https://database.example', 'test-key');
beforeEach(() => {
  vi.stubEnv('APP_ATTEST_APP_ID', appID);
  vi.stubEnv('APP_ATTEST_ALLOW_DEVELOPMENT', 'false');
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'synthetic-secret');
  vi.stubEnv('TURNSTILE_SITE_KEY', 'synthetic-site-key');
  vi.stubEnv('TURNSTILE_HOSTNAMES', 'peek.example');
  vi.stubEnv('TURNSTILE_ALLOW_NATIVE_USER_AGENT', 'true');
  vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  vi.spyOn(SupabaseServiceClient.prototype, 'request').mockImplementation(async (path) => {
    if (path.endsWith('get_native_attest_key')) return { public_key: storedKey, app_id: appID, sign_count: 0 };
    if (path.endsWith('accept_native_assertion')) return 'accepted';
    return true;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('native verification', () => {
  it('requires a valid app ID and secret, and refuses development keys in production', () => {
    expect(nativeAttestSettings({})).toBeNull();
    expect(() => nativeAttestSettings({ APP_ATTEST_APP_ID: 'invalid' })).toThrow('valid app ID');
    expect(() => nativeAttestSettings({ APP_ATTEST_APP_ID: appID, TURNSTILE_SECRET_KEY: 'secret', NODE_ENV: 'production', APP_ATTEST_ALLOW_DEVELOPMENT: 'true' })).toThrow('production');
    expect(nativeAttestSettings({ APP_ATTEST_APP_ID: appID, TURNSTILE_SECRET_KEY: 'secret' })?.bundleIdentifier).toBe('com.example.Peek');
  });
  it('verifies a real synthetic P256 signature and atomically spends the installation allowance', async () => {
    await verifyNativeRequest(await signedRequest(), service);
    expect(service.request).toHaveBeenLastCalledWith('/rest/v1/rpc/accept_native_assertion', expect.objectContaining({ body: expect.objectContaining({
      p_key_id: keyID, p_counter: 1, p_kind: 'lookup', p_limit: 15, p_challenge: expect.stringMatching(/^[a-f0-9]{64}$/),
    }) }));
  });
  it.each(['body', 'path', 'method', 'network', 'hostname', 'key', 'challenge', 'signature'])('rejects a signed request after changing its %s', async (kind) => {
    const original = await signedRequest();
    let req: Request = original;
    if (kind === 'body') req = new Request(original.url, { method: 'POST', headers: original.headers, body: '{}' });
    if (kind === 'path') req = new Request('https://peek.example/api/public/detect', original);
    if (kind === 'method') req = new Request(original, { method: 'PUT' });
    if (kind === 'network') req.headers.set('x-real-ip', '198.51.100.4');
    if (kind === 'hostname') req.headers.set('host', 'attacker.example');
    if (kind === 'key') req.headers.set('x-app-attest-key-id', Buffer.alloc(32, 8).toString('base64'));
    if (kind === 'challenge') req.headers.set('x-app-attest-challenge', original.headers.get('x-app-attest-challenge')!.replace(/.$/, '!'));
    if (kind === 'signature') req.headers.set('x-app-attest-assertion', (await cbor.encodeAsync({ signature: Buffer.alloc(71), authenticatorData: Buffer.alloc(37) })).toString('base64'));
    await expect(verifyNativeRequest(req, service)).rejects.toMatchObject({ status: 403 });
    expect(service.request).not.toHaveBeenCalledWith('/rest/v1/rpc/accept_native_assertion', expect.anything());
  });
  it('rejects expired, wrongly scoped, malformed and unconfigured challenges', async () => {
    vi.useFakeTimers();
    const req = await signedRequest();
    vi.advanceTimersByTime(121_000);
    await expect(verifyNativeRequest(req, service)).rejects.toMatchObject({ status: 403 });
    expect(() => nativeChallenge(request(), 'invalid', 'assertion')).toThrow('Invalid');
    expect(() => nativeChallenge(request(), keyID, 'other')).toThrow('Invalid');
    const other = await signedRequest();
    other.headers.set('x-app-attest-challenge', nativeChallenge(other, keyID, 'attestation').challenge);
    await expect(verifyNativeRequest(other, service)).rejects.toMatchObject({ status: 403 });
    const unconfigured = await signedRequest();
    vi.stubEnv('APP_ATTEST_APP_ID', '');
    await expect(verifyNativeRequest(unconfigured, service)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects replayed counters, unknown or incorrectly scoped keys and malformed assertions', async () => {
    await expect(verifyNativeRequest(await signedRequest({ counter: 0 }), service)).rejects.toMatchObject({ status: 403 });
    await expect(verifyNativeRequest(await signedRequest({ appID: 'TESTTEAM02.com.example.Other' }), service)).rejects.toMatchObject({ status: 403 });
    vi.mocked(service.request).mockResolvedValueOnce(null);
    await expect(verifyNativeRequest(await signedRequest(), service)).rejects.toMatchObject({ status: 403 });
    vi.mocked(service.request).mockResolvedValueOnce({ public_key: storedKey, app_id: 'other', sign_count: 0 });
    await expect(verifyNativeRequest(await signedRequest(), service)).rejects.toMatchObject({ status: 403 });
    for (const value of ['not base64!', 'AA==', (await cbor.encodeAsync({ signature: 'bad', authenticatorData: Buffer.alloc(37) })).toString('base64'), 'A'.repeat(4100)]) {
      const req = await signedRequest(); req.headers.set('x-app-attest-assertion', value);
      await expect(verifyNativeRequest(req, service)).rejects.toMatchObject({ status: 403 });
    }
  });
  it('checks signed launch categories and bundle versions on systems that supply them', async () => {
    await verifyNativeRequest(await signedRequest({ extension: { validationCategory: 4, bundleVersion: '2.1' } }), service);
    for (const extension of [{ validationCategory: 0 }, { validationCategory: 3 }, { bundleVersion: '<bad>' }]) {
      await expect(verifyNativeRequest(await signedRequest({ extension }), service)).rejects.toMatchObject({ status: 403 });
    }
    vi.stubEnv('APP_ATTEST_ALLOW_DEVELOPMENT', 'true');
    await verifyNativeRequest(await signedRequest({ extension: { validationCategory: 3 } }), service);
  });
  it('returns daily limits and rejects a replay refused by the atomic database check', async () => {
    vi.mocked(service.request).mockResolvedValueOnce({ public_key: storedKey, app_id: appID, sign_count: 0 }).mockResolvedValueOnce('limited');
    await expect(verifyNativeRequest(await signedRequest(), service)).rejects.toMatchObject({ status: 429, headers: { 'Retry-After': expect.any(String) } });
    vi.mocked(service.request).mockResolvedValueOnce({ public_key: storedKey, app_id: appID, sign_count: 0 }).mockResolvedValueOnce('rejected');
    await expect(verifyNativeRequest(await signedRequest(), service)).rejects.toMatchObject({ status: 403 });
  });
  it('does not let incomplete attestation headers fall back to a browser proof or legacy user-agent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, hostname: 'peek.example', action: 'parcel_lookup' })));
    const req = request();
    const { proof } = await verifyLookupBrowser(req, 'synthetic-token');
    req.headers.set('x-lookup-proof', proof);
    req.headers.set('user-agent', 'PeekDeliveryTracker/1 CFNetwork/1 Darwin/1');
    req.headers.set('x-app-attest-key-id', keyID);
    await expect(verifyLookupRequest(req, service)).rejects.toMatchObject({ status: 403 });
    req.headers.delete('x-app-attest-key-id'); req.headers.delete('x-lookup-proof'); req.headers.set('x-native-verification', '1');
    await expect(verifyLookupRequest(req, service)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects invalid attestations before storing a public key', async () => {
    const req = request();
    const challenge = nativeChallenge(req, keyID, 'attestation').challenge;
    for (const attestation of ['bad!', (await cbor.encodeAsync({ attStmt: { x5c: [Buffer.alloc(10), Buffer.alloc(10)] }, authData: Buffer.alloc(87) })).toString('base64')]) {
      await expect(registerNativeKey(req, service, { keyId: keyID, challenge, attestation })).rejects.toMatchObject({ status: 403 });
    }
    expect(service.request).not.toHaveBeenCalled();
  });
  it('exposes the free fallback without enabling App Attest and returns no-store challenges', async () => {
    vi.stubEnv('APP_ATTEST_APP_ID', '');
    const config = await configuration(new NextRequest('https://peek.example/api/public/native/verification'), { params: Promise.resolve({}) });
    expect(await config.json()).toEqual({ appAttestAppId: null, turnstile: true });
    const unavailable = await register(request('/api/public/native/verification', '{}'), { params: Promise.resolve({}) });
    expect(unavailable.status).toBe(503);
    vi.stubEnv('APP_ATTEST_APP_ID', appID);
    const result = await challengeRoute(request('/api/public/native/challenge', JSON.stringify({ keyId: keyID, purpose: 'assertion' })), { params: Promise.resolve({}) });
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.json()).toMatchObject({ challenge: expect.any(String), expiresAt: expect.any(Number) });
  });
  it('hosts a nonce-protected, non-cacheable WKWebView bridge on the configured origin', async () => {
    const result = await page(new NextRequest('https://peek.example/api/public/native/turnstile?language=fr'), { params: Promise.resolve({}) });
    const html = await result.text();
    const nonce = /nonce="([^"]+)"/.exec(html)![1];
    expect(result.headers.get('Content-Security-Policy')).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(html).toContain('peekVerification'); expect(html).toContain('parcel_lookup'); expect(html).toContain('"language":"fr"');
    expect(html).not.toContain('synthetic-secret');
    vi.stubEnv('TURNSTILE_SITE_KEY', ''); vi.stubEnv('TURNSTILE_SECRET_KEY', ''); vi.stubEnv('TURNSTILE_HOSTNAMES', '');
    expect((await page(new NextRequest('https://peek.example/api/public/native/turnstile'), { params: Promise.resolve({}) })).status).toBe(503);
  });
});
