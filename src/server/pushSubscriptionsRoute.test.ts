import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PATCH } from '../../app/api/push/subscriptions/route';
import { POST as status } from '../../app/api/push/subscriptions/status/route';
import { SupabaseAuthenticator } from './auth';
import { SupabaseServiceClient } from './supabase';

const owner = '10000000-0000-0000-0000-000000000001';
const endpoint = 'https://fcm.googleapis.com/fcm/send/test-locale';
const request = (body: unknown, authenticated = true) => PATCH(new NextRequest('https://delivery.example/api/push/subscriptions', {
  method: 'PATCH', headers: { 'content-type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-session' } : {}) },
  body: JSON.stringify(body),
}), { params: Promise.resolve({}) });

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({
    id: owner, email: null, authenticatedAt: null, sessionId: null,
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('changes the language only on the signed-in user’s enabled browser subscription', async () => {
  const write = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue(null);
  expect((await request({ endpoint, locale: 'fr' })).status).toBe(200);
  expect(write).toHaveBeenCalledOnce();
  const [path, options] = write.mock.calls[0];
  const url = new URL(path, 'https://database.example');
  expect(url.searchParams.get('user_id')).toBe(`eq.${owner}`);
  expect(url.searchParams.get('endpoint')).toBe(`eq.${endpoint}`);
  expect(url.searchParams.get('disabled_at')).toBe('is.null');
  expect(options).toMatchObject({ method: 'PATCH', body: { locale: 'fr' } });
  expect(options?.body).toEqual({ locale: 'fr' }); // No re-enable, new cursor, or test notification.
});

it.each([undefined, 'nl', ['fr'], '', null])('rejects invalid language %j without changing the subscription', async (locale) => {
  const write = vi.spyOn(SupabaseServiceClient.prototype, 'request');
  expect((await request({ endpoint, locale })).status).toBe(400);
  expect(write).not.toHaveBeenCalled();
});

it('requires authentication before updating a language', async () => {
  const write = vi.spyOn(SupabaseServiceClient.prototype, 'request');
  expect((await request({ endpoint, locale: 'fr' }, false)).status).toBe(401);
  expect(write).not.toHaveBeenCalled();
});

it.each(['es', 'pt', 'pl'])('stores the new notification locale %s', async (locale) => {
  const write = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue(null);
  expect((await request({ endpoint, locale })).status).toBe(200);
  expect(write.mock.calls[0]?.[1]?.body).toEqual({ locale });
});

const statusRequest = (body: unknown) => status(new NextRequest('https://delivery.example/api/push/subscriptions/status', {
  method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer test-session' },
  body: JSON.stringify(body),
}), { params: Promise.resolve({}) });

it.each([[[{ id: 'subscription-1' }], true], [[], false]])(
  'reports whether the server still delivers to this browser (%j)',
  async (stored, active) => {
    const read = vi.spyOn(SupabaseServiceClient.prototype, 'request').mockResolvedValue(stored);
    const response = await statusRequest({ endpoint });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ active });
    const url = new URL(read.mock.calls[0]![0], 'https://database.example');
    expect(url.searchParams.get('user_id')).toBe(`eq.${owner}`);
    expect(url.searchParams.get('endpoint')).toBe(`eq.${endpoint}`);
    expect(url.searchParams.get('disabled_at')).toBe('is.null');
    expect(read.mock.calls[0]![1]?.method ?? 'GET').toBe('GET');
  },
);

it('rejects a status check without a push endpoint', async () => {
  const read = vi.spyOn(SupabaseServiceClient.prototype, 'request');
  expect((await statusRequest({})).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});
