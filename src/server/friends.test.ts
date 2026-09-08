import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as exportGET } from '../../app/api/account/export/route';
import { GET, POST } from '../../app/api/friends/route';
import { GET as activityGET } from '../../app/api/friends/activity/route';
import { SupabaseAuthenticator } from './auth';
import { SupabaseError, SupabaseUserClient } from './supabase';
import { friendCard, friendsAction, friendsActionResponse, friendsSnapshot, friendsActivity } from './friends';

const id = '11000000-0000-4000-8000-000000000001';
const card = { id, nickname: 'Mila', stats: { deliveredCount: 12, averageDays: 3, stamps: ['first', 'ten'] }, arrivedThisWeek: null };
const snapshot = { profile: { nickname: 'Alex', shareStats: true, shareArrival: false }, ownCard: card, friends: [card] };
function call(body?: unknown, authenticated = true) {
  const request = new NextRequest('https://delivery.example/api/friends', { method: body ? 'POST' : 'GET', headers: authenticated ? { Authorization: 'Bearer friends-test-session' } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  return (body ? POST : GET)(request, { params: Promise.resolve({}) });
}
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example'); vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'public-key');
  vi.spyOn(console, 'log').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({ id, email: null, authenticatedAt: null, sessionId: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Friends privacy boundary', () => {
  it('returns only shared nicknames and profile IDs in authenticated sender notices', async () => {
    const updates = { updates: [{ friendId: id, nickname: 'Mila' }] };
    const rpc = vi.spyOn(SupabaseUserClient.prototype, 'request').mockResolvedValue({ updates: [{ ...updates.updates[0], email: 'private', parcel: 'private' }] });
    const response = await activityGET(new NextRequest('https://delivery.example/api/friends/activity', { headers: { Authorization: 'Bearer activity-test' } }), { params: Promise.resolve({}) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual(updates);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(rpc).toHaveBeenCalledWith('/rest/v1/rpc/friends_activity', { method: 'POST', body: {} });
    expect((await activityGET(new NextRequest('https://delivery.example/api/friends/activity'), { params: Promise.resolve({}) })).status).toBe(401);
    expect(() => friendsActivity({ updates: [{ friendId: id, nickname: '\u202espoof' }] })).toThrow();
    expect(() => friendsActivity({ updates: Array(51).fill(updates.updates[0]) })).toThrow();
    expect(friendsAction({ action: 'acknowledge_friend', friendId: id })).toEqual({ action: 'acknowledge_friend', friendId: id });
  });
  it('includes the accepted profile without exposing extra fields', () => {
    expect(friendsActionResponse({ snapshot, acceptedFriend: { ...card, email: 'private' } }, 'accept_invite')).toEqual({ snapshot, acceptedFriend: card });
    expect(friendsActionResponse({ snapshot, acceptedFriend: card }, 'save_profile')).toEqual({ snapshot });
  });
  it('projects an allowlist at every nesting level, excluding all parcel and account data', async () => {
    const privateCard = { ...card, email: 'private@example.test', trackingNumber: 'PRIVATE123', parcel: { label: 'Private purchase' }, stats: { ...card.stats, location: 'Private address' } };
    vi.spyOn(SupabaseUserClient.prototype, 'request').mockResolvedValue({ ...snapshot, ownCard: privateCard, friends: [privateCard], invites: ['secret-code'] });
    const response = await call(); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(snapshot);
  });
  it('exports the owner’s profile and connections without copying friends’ statistics', async () => {
    vi.spyOn(SupabaseUserClient.prototype, 'request').mockResolvedValue(snapshot);
    vi.spyOn(SupabaseUserClient.prototype, 'listPackages').mockResolvedValue([]);
    const response = await exportGET(new NextRequest('https://delivery.example/api/account/export', { headers: { Authorization: 'Bearer friends-export-test' } }), { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const exported = await response.json();
    expect(exported.friends).toEqual({ profile: snapshot.profile, connections: [{ id, nickname: 'Mila' }] });
    expect(exported.friends).not.toHaveProperty('ownCard');
    expect(exported.friends.connections[0]).not.toHaveProperty('stats');
  });
  it('uses the authenticated database RPC, never a client-supplied owner', async () => {
    const rpc = vi.spyOn(SupabaseUserClient.prototype, 'request').mockResolvedValue({ snapshot });
    expect((await call({ action: 'save_profile', nickname: ' Alex ', shareStats: true, shareArrival: false })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('/rest/v1/rpc/friends_action', { method: 'POST', body: { p_action: 'save_profile', p_nickname: 'Alex', p_share_stats: true, p_share_arrival: false, p_code: null, p_friend_id: null } });
    expect((await call({ action: 'disable', userId: id })).status).toBe(400);
  });
  it('denies unauthenticated reads and validates before accessing the database', async () => {
    const rpc = vi.spyOn(SupabaseUserClient.prototype, 'request');
    expect((await call(undefined, false)).status).toBe(401);
    expect((await call({ action: 'accept_invite', code: 'short' })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    { action: 'save_profile', nickname: '', shareStats: true, shareArrival: false },
    { action: 'save_profile', nickname: 'x'.repeat(25), shareStats: true, shareArrival: false },
    { action: 'save_profile', nickname: '\u202espoof', shareStats: true, shareArrival: false },
    { action: 'save_profile', nickname: 'Alex', shareStats: 'true', shareArrival: false },
    { action: 'save_profile', nickname: 'Alex', shareStats: true },
    { action: 'save_profile', nickname: 'Alex', shareStats: true, shareArrival: false, stats: { deliveredCount: 9000 } },
    { action: 'remove_friend', friendId: 'not-an-id' }, { action: 'bad' }, { action: '__proto__' }, { action: 1 },
  ])('rejects malformed or extra fields: %j', (body) => { expect(() => friendsAction(body)).toThrow(); });
  it('round-trips hidden stats and absent profiles without filling fake data', () => {
    expect(friendCard({ ...card, stats: null, arrivedThisWeek: false })).toEqual({ ...card, stats: null, arrivedThisWeek: false });
    expect(friendsSnapshot({ profile: null, ownCard: null, friends: [] })).toEqual({ profile: null, ownCard: null, friends: [] });
    expect(() => friendsSnapshot({ profile: null, ownCard: card, friends: [card] })).toThrow();
    expect(() => friendsSnapshot({ ...snapshot, friends: Array(51).fill(card) })).toThrow();
  });
  it.each([null, {}, { ...card, stats: { ...card.stats, stamps: ['private-field'] } }, { ...card, stats: { ...card.stats, deliveredCount: -1 } }, { ...card, stats: { ...card.stats, averageDays: 0 } }, { ...card, arrivedThisWeek: '2026-09-09T12:13:14Z' }])('fails closed on malformed summaries: %j', (value) => { expect(() => friendCard(value)).toThrow(); });
  it('strips invitation metadata and prevents previewing any stats', () => {
    expect(friendsActionResponse({ previewNickname: 'Mila', ...card }, 'preview_invite')).toEqual({ previewNickname: 'Mila' });
    expect(friendsActionResponse({ inviteCode: 'a'.repeat(32), expiresAt: '2026-09-16T00:00:00Z', userId: id }, 'create_invite')).toEqual({ inviteCode: 'a'.repeat(32), expiresAt: '2026-09-16T00:00:00Z' });
    expect(() => friendsActionResponse({ inviteCode: 'short' }, 'create_invite')).toThrow();
    expect(() => friendsActionResponse({}, 'preview_invite')).toThrow();
    expect(() => friendsActionResponse(null, 'disable')).toThrow();
  });
  it('projects a validated short preview ID and rejects malformed IDs', () => {
    const result = { inviteCode: 'a'.repeat(32), previewId: 'Ab7kP2mQ9xR4tY6n', expiresAt: '2026-09-16T00:00:00Z' };
    expect(friendsActionResponse({ ...result, privateUserId: id }, 'create_invite')).toEqual(result);
    for (const previewId of ['short', 'a'.repeat(64), 'a'.repeat(15) + '/', null, 123]) {
      expect(() => friendsActionResponse({ ...result, previewId }, 'create_invite')).toThrow();
    }
  });
  it.each([['P0002',404], ['P0003',409], ['P0004',422], ['22023',400], ['PGRST202',503], ['42883',503], ['other',502]] as const)('maps safe database errors: %s', async (code, status) => {
    vi.spyOn(SupabaseUserClient.prototype, 'request').mockRejectedValue(new SupabaseError('PRIVATE_SERVER_PAYLOAD', 400, code));
    const response = await call({ action: 'accept_invite', code: 'a'.repeat(32) });
    expect(response.status).toBe(status); expect(await response.text()).not.toContain('PRIVATE_SERVER_PAYLOAD');
  });
});
