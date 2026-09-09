import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFriendsClient, friendTone, ownFriendCard } from './friends';
import type { ParcelWithEvents } from '../types';
const profile = { nickname: 'Alex', shareStats: true, shareArrival: false };
const parcel = { id: 'p1', label: 'Private contents', carrier: 'ups', trackingNumber: 'PRIVATE123', createdAt: '2026-09-01T00:00:00Z', events: [
  { id: 'e1', stage: 'accepted', occurredAt: '2026-09-08T01:00:00Z', location: 'Private sender' },
  { id: 'e2', stage: 'delivered', occurredAt: '2026-09-09T02:00:00Z', location: 'Private address' },
] } as ParcelWithEvents;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Friends client and self preview', () => {
  it('uses the complete shared collection and UTC calendar in self previews', () => {
    const origins = ['CH', 'DE', 'FR', 'IT', 'GB'];
    const parcels = Array.from({ length: 25 }, (_, i) => ({ ...parcel, id: `p${i}`, carrier: (['ups', 'dhl', 'dpd'] as const)[i % 3], archivedAt: '2024-12-02T00:00:00Z', events: [
      { id: 'start', parcelId: `p${i}`, description: 'Private', stage: 'accepted' as const, occurredAt: i === 0 ? '2024-10-01T00:00:00Z' : '2024-11-30T12:00:00Z', location: origins[i % 5] },
      { id: 'pickup', parcelId: `p${i}`, description: 'Private', stage: 'ready_for_pickup' as const, occurredAt: '2024-12-01T10:00:00Z', location: 'CH' },
      { id: 'end', parcelId: `p${i}`, description: 'Private', stage: 'delivered' as const, occurredAt: '2024-12-01T12:00:00Z', location: 'CH' },
    ] }));
    expect(ownFriendCard(parcels, profile).stats?.stamps).toEqual(['first', 'ten', 'connected', 'express', 'acrossBorders', 'aroundWorld', 'theRegular', 'rightNextDoor', 'worthTheWait', 'busyDoorstep', 'pickedUp', 'homeForHolidays']);
    expect(ownFriendCard(parcels, { ...profile, shareStats: false }).stats).toBeNull();
    expect(ownFriendCard([{ ...parcel, events: [{ id: 'end', parcelId: 'p1', description: 'Private', stage: 'delivered', occurredAt: '2024-11-30T23:30:00Z' }] }], profile).stats?.stamps).not.toContain('homeForHolidays');
  });

  it('rounds journeys and keeps all private parcel fields out of the preview', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
    const card = ownFriendCard([parcel], { ...profile, shareArrival: true });
    expect(card.stats).toEqual({ deliveredCount: 1, averageDays: 2, stamps: ['first', 'express'] });
    expect(card.arrivedThisWeek).toBe(true); expect(JSON.stringify(card)).not.toContain('Private');
    expect(ownFriendCard([parcel], { ...profile, shareStats: false }).stats).toBeNull();
    expect(ownFriendCard([], profile).stats?.averageDays).toBeNull();
    const many = Array.from({ length: 10 }, (_, i) => ({ ...parcel, id: String(i), carrier: ['ups', 'dhl', 'dpd'][i % 3] })) as ParcelWithEvents[];
    expect(ownFriendCard(many, profile).stats?.stamps).toContain('ten');
    expect(ownFriendCard(many, profile).stats?.stamps).toContain('connected');
  });
  it('never sends demo actions to real accounts, and retains local changes across tab visits', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const client = createFriendsClient(true);
    expect((await client.load([])).friends).toHaveLength(3);
    const result = await client.action({ action: 'save_profile', ...profile, shareStats: false }, [parcel]);
    expect(result.snapshot?.ownCard?.stats).toBeNull();
    const friendId = (await client.load([])).friends[0].id;
    await client.action({ action: 'remove_friend', friendId }, []);
    expect((await client.load([])).friends).toHaveLength(2);
    await expect(client.action({ action: 'create_invite' }, [])).rejects.toMatchObject({ key: 'friends.demoInvites' });
    await client.action({ action: 'disable' }, []);
    expect(await client.load([])).toEqual({ profile: null, ownCard: null, friends: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends codes only in authenticated POST bodies with no-store requests', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ previewNickname: 'Mila' }))); vi.stubGlobal('fetch', fetch);
    const client = createFriendsClient(false, { userId: 'owner', getAccessToken: async () => 'session-token' });
    await client.checkInvitation('a'.repeat(32));
    expect(fetch.mock.calls[0][0]).toBe('/api/friends');
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', cache: 'no-store' });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ action: 'preview_invite', code: 'a'.repeat(32) });
    expect(fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer session-token');
    fetch.mockResolvedValue(new Response(JSON.stringify({ profile: null, ownCard: null, friends: [] })));
    expect((await client.load([])).friends).toEqual([]);
  });
  it.each([[404,'friends.inviteUnavailable'],[409,'friends.circleFull'],[422,'friends.selfInvitation'],[503,'friends.unavailable'],[400,'friends.actionFailed']])('handles response %s safely', async (status, key) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: Number(status) })));
    await expect(createFriendsClient(false).load([])).rejects.toMatchObject({ key });
  });
  it('gives avatars stable colors', () => { expect(friendTone('11000000')).toBe('lilac'); expect(friendTone('not-an-id')).toBe('blue'); });
});
