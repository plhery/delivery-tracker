import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DELETE, GET, PUT } from '../../app/api/packages/[id]/share/route';
import contractFixture from '../../contracts/fixtures/delivery-api.json';
import { SupabaseAuthenticator } from './auth';
import * as metrics from './metrics';
import { SupabaseError, SupabaseUserClient } from './supabase';

// Synthetic identifiers only.
const userId = '54000000-0000-4000-a000-000000000001';
const packageId = '54000000-0000-4000-a000-000000000002';
const share = { id: 'g8Rn3yJe2SuX', showNumber: false, gift: true, createdAt: '2026-10-01T08:00:00+00:00' };

function request(handler: typeof GET, method: string, body?: unknown, id = packageId, authenticated = true) {
  return handler(new NextRequest(`https://delivery.example/api/packages/${id}/share`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(authenticated ? { Authorization: 'Bearer share-test' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({ id: userId, email: null, authenticatedAt: null, sessionId: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('reads the link a parcel is shared through, in the shape the clients decode, or null', async () => {
  const read = vi.spyOn(SupabaseUserClient.prototype, 'packageShare').mockResolvedValueOnce(share).mockResolvedValue(null);
  const shared = await request(GET, 'GET');
  expect(shared.status).toBe(200);
  expect(shared.headers.get('cache-control')).toBe('no-store');
  expect(await shared.json()).toEqual(contractFixture.parcelShare);
  const none = await request(GET, 'GET');
  expect(none.status).toBe(200);
  expect(await none.json()).toEqual({ link: null });
  expect(read).toHaveBeenNthCalledWith(1, packageId);
});

it('shares a parcel under the caller\'s own token: a new link, then the same one changed', async () => {
  const store = vi.spyOn(SupabaseUserClient.prototype, 'sharePackage')
    .mockResolvedValueOnce({ ...share, created: true })
    .mockResolvedValueOnce({ ...share, showNumber: true, created: false });
  const counted = vi.spyOn(metrics, 'recordParcelShare');
  const first = await request(PUT, 'PUT', { gift: true, label: 'never stored', shared: false });
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual(contractFixture.parcelShare);
  const second = await request(PUT, 'PUT', { showNumber: true });
  expect(await second.json()).toEqual({ link: { ...contractFixture.parcelShare.link, showNumber: true } });
  // Only the two switches an account's link has are read; the answer never says whether the link is new.
  expect(store.mock.calls).toEqual([[packageId, { gift: true }], [packageId, { showNumber: true }]]);
  expect(counted.mock.calls).toEqual([['account', 'started'], ['account', 'changed']]);
  // Sharing with nothing to change keeps what the link shows.
  store.mockResolvedValueOnce({ ...share, created: false });
  expect((await request(PUT, 'PUT', {})).status).toBe(200);
  expect(store).toHaveBeenLastCalledWith(packageId, {});
});

it('stops sharing, and answers the same when the parcel was not shared', async () => {
  const stop = vi.spyOn(SupabaseUserClient.prototype, 'stopPackageShare').mockResolvedValueOnce(true).mockResolvedValue(false);
  const counted = vi.spyOn(metrics, 'recordParcelShare');
  for (const response of [await request(DELETE, 'DELETE'), await request(DELETE, 'DELETE')]) {
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
  expect(stop).toHaveBeenCalledWith(packageId);
  expect(counted).toHaveBeenCalledExactlyOnceWith('account', 'stopped');
});

it('answers another account\'s parcel like one that does not exist', async () => {
  const missing = new SupabaseError('Package not found', 404, 'P0002');
  vi.spyOn(SupabaseUserClient.prototype, 'packageShare').mockRejectedValue(missing);
  vi.spyOn(SupabaseUserClient.prototype, 'sharePackage').mockRejectedValue(missing);
  vi.spyOn(SupabaseUserClient.prototype, 'stopPackageShare').mockRejectedValue(missing);
  const counted = vi.spyOn(metrics, 'recordParcelShare');
  for (const response of [await request(GET, 'GET'), await request(PUT, 'PUT', { gift: true }), await request(DELETE, 'DELETE')]) {
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Package not found' });
  }
  expect(counted).not.toHaveBeenCalled();
});

it('rejects a malformed parcel id or switch, and a caller who is not signed in, before any request', async () => {
  const read = vi.spyOn(SupabaseUserClient.prototype, 'packageShare');
  const store = vi.spyOn(SupabaseUserClient.prototype, 'sharePackage');
  const stop = vi.spyOn(SupabaseUserClient.prototype, 'stopPackageShare');
  expect((await request(GET, 'GET', undefined, 'not-a-uuid')).status).toBe(400);
  expect((await request(DELETE, 'DELETE', undefined, 'not-a-uuid')).status).toBe(400);
  for (const body of [{ gift: 'yes' }, { showNumber: 1 }, { gift: null }]) {
    const response = await request(PUT, 'PUT', body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/must be true or false/) });
  }
  for (const [handler, method, body] of [[GET, 'GET', undefined], [PUT, 'PUT', { gift: true }], [DELETE, 'DELETE', undefined]] as const) {
    expect((await request(handler, method, body, packageId, false)).status).toBe(401);
  }
  expect(read).not.toHaveBeenCalled();
  expect(store).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
});

it('passes a database failure on as one', async () => {
  vi.spyOn(SupabaseUserClient.prototype, 'sharePackage').mockRejectedValue(new SupabaseError('database down', 503));
  expect((await request(PUT, 'PUT', { gift: true })).status).toBe(502);
});


it('saves and reads a protected gift message through the account sharing route', async () => {
  const giftWords = { name: 'Trail shoes', note: 'Happy birthday!', from: 'Sam' };
  const store = vi.spyOn(SupabaseUserClient.prototype, 'sharePackage').mockResolvedValue({ ...share, giftWords, created: false });
  const response = await request(PUT, 'PUT', { giftWords: { ...giftWords, note: ' Happy\n birthday! ' } });
  expect(response.status).toBe(200);
  expect(store).toHaveBeenCalledExactlyOnceWith(packageId, { giftWords });
  expect((await response.json()).link.giftWords).toEqual(giftWords);
  vi.spyOn(SupabaseUserClient.prototype, 'packageShare').mockResolvedValue({ ...share, giftWords });
  expect((await (await request(GET, 'GET')).json()).link.giftWords).toEqual(giftWords);
});

it('rejects malformed or oversized gift words before any write', async () => {
  const store = vi.spyOn(SupabaseUserClient.prototype, 'sharePackage');
  for (const giftWords of [null, [], 'message', {}, { name: null, note: 1, from: null },
    { name: 'a'.repeat(81), note: null, from: null }, { name: null, note: 'a'.repeat(281), from: null },
    { name: null, note: null, from: 'a'.repeat(61) }]) {
    expect((await request(PUT, 'PUT', { giftWords })).status).toBe(400);
  }
  expect(store).not.toHaveBeenCalled();
});
