import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { POST } from '../../app/api/friends/invite-preview/route';
import { SupabaseServiceClient } from './supabase';
import { SupabaseAuthenticator } from './auth';

const code = 'ab'.repeat(16);
let address = 0;
function call(body: unknown, ip = `192.0.2.${++address}`) {
  return POST(new NextRequest('https://delivery.example/api/friends/invite-preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
}
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('lets a signed-out recipient see only the nickname, without consuming or authenticating', async () => {
  const authenticate = vi.spyOn(SupabaseAuthenticator.prototype, 'validate');
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue([{ user_id: 'private', friend_profiles: { nickname: 'Paul', email: 'secret@example.test', stats: { parcels: 8 } } }]);
  const response = await call({ code });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ previewNickname: 'Paul' });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(authenticate).not.toHaveBeenCalled();
  const path = request.mock.calls[0][0];
  const query = new URL(path, 'https://database.example').searchParams;
  expect(query.get('select')).toBe('friend_profiles!inner(nickname)');
  expect(query.get('code_hash')).toBe(`eq.${createHash('sha256').update(code).digest('hex')}`);
  expect(query.get('expires_at')).toMatch(/^gt\.\d{4}-/);
  expect(query.get('limit')).toBe('1');
  expect(path).not.toContain(code);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]).toHaveLength(1);
});
it.each([{ code: 'invalid' }, { code, userId: 'spoof' }, { code, nickname: 'Fake' }])('rejects malformed and additional input before querying', async (body) => {
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request');
  expect((await call(body)).status).toBe(400);
  expect(request).not.toHaveBeenCalled();
});
it('treats expired, revoked, consumed, and unknown invitations alike', async () => {
  vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue([]);
  const response = await call({ code });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Invitation unavailable' });
});
it('limits anonymous preview requests and returns an uncached retry response', async () => {
  const request = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue([]);
  for (let i = 0; i < 30; i++) expect((await call({ code }, '198.51.100.1')).status).toBe(404);
  const response = await call({ code }, '198.51.100.1');
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBeTruthy();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(request).toHaveBeenCalledTimes(30);
});
