import fixture from '../../shared/friends-demo.json';
import type { ApiFriendCard, ApiFriendProfile, ApiFriendsActionRequest, ApiFriendsActionResponse, ApiFriendsSnapshot, ApiFriendStamp } from '../generated/apiContract';
import type { MessageKey } from '../i18n';
import type { ParcelWithEvents } from '../types';
import { authenticatedFetch, type ApiAuth } from './apiClient';
import { currentStage } from './stages';
import { passportStatistics } from './passport';

export const friendStamps: Record<ApiFriendStamp, { title: MessageKey; explanation: MessageKey; icon: 'parcel' | 'stamp' | 'globe' | 'express'; tone: string }> = {
  first: { title: 'passport.firstArrival', explanation: 'friends.firstStampDetail', icon: 'parcel', tone: 'green' },
  ten: { title: 'passport.doubleDigits', explanation: 'friends.tenStampDetail', icon: 'stamp', tone: 'lilac' },
  connected: { title: 'passport.wellConnected', explanation: 'friends.connectedStampDetail', icon: 'globe', tone: 'blue' },
  express: { title: 'passport.expressArrival', explanation: 'friends.expressStampDetail', icon: 'express', tone: 'peach' },
};
export const friendTone = (id: string) => ['blue', 'lilac', 'peach', 'green'][parseInt(id.replaceAll('-', '').slice(0, 2), 16) % 4 || 0];
export function ownFriendCard(parcels: readonly ParcelWithEvents[], profile: ApiFriendProfile): ApiFriendCard {
  const stats = passportStatistics(parcels);
  const earned: ApiFriendStamp[] = [];
  if (stats.deliveredCount >= 1) earned.push('first');
  if (stats.deliveredCount >= 10) earned.push('ten');
  if (stats.carrierCount >= 3) earned.push('connected');
  if (stats.fastestDelivery && stats.fastestDelivery.duration <= 172800_000) earned.push('express');
  const week = new Date(); week.setUTCHours(0, 0, 0, 0); week.setUTCDate(week.getUTCDate() - (week.getUTCDay() + 6) % 7);
  return {
    id: '44000000-0000-4000-8000-000000000004', nickname: profile.nickname,
    stats: profile.shareStats ? { deliveredCount: stats.deliveredCount, averageDays: stats.averageDeliveryDuration == null ? null : Math.max(1, Math.ceil(stats.averageDeliveryDuration / 86400_000)), stamps: earned } : null,
    arrivedThisWeek: profile.shareArrival ? parcels.some((p) => currentStage(p.events) === 'delivered' && (() => {
      const arrived = Math.min(...p.events.filter((e) => e.stage === 'delivered').map((e) => Date.parse(e.occurredAt)));
      return arrived >= week.getTime() && arrived <= Date.now();
    })()) : null,
  };
}
export class FriendsError extends Error {
  constructor(readonly key: MessageKey) { super(key); }
}
export function createFriendsClient(demo: boolean, auth?: ApiAuth) {
  let local = structuredClone(fixture) as ApiFriendsSnapshot;
  const snapshot = (parcels: readonly ParcelWithEvents[]): ApiFriendsSnapshot => ({ ...structuredClone(local), ownCard: local.profile ? ownFriendCard(parcels, local.profile) : null });
  async function request<T>(body?: ApiFriendsActionRequest): Promise<T> {
    const response = await authenticatedFetch('/api/friends', auth, body ? { method: 'POST', body: JSON.stringify(body) } : undefined);
    if (!response.ok) throw new FriendsError(response.status === 404 ? 'friends.inviteUnavailable' : response.status === 409 ? 'friends.circleFull' : response.status === 422 ? 'friends.selfInvitation' : response.status >= 500 ? 'friends.unavailable' : 'friends.actionFailed');
    return response.json() as Promise<T>;
  }
  return {
    /** Validate an opened invitation for this account without accepting it. */
    async checkInvitation(code: string): Promise<ApiFriendsActionResponse> {
      if (demo) throw new FriendsError('friends.demoInvites');
      return request({ action: 'preview_invite', code });
    },
    async load(parcels: readonly ParcelWithEvents[]): Promise<ApiFriendsSnapshot> {
      return demo ? snapshot(parcels) : request();
    },
    async action(action: ApiFriendsActionRequest, parcels: readonly ParcelWithEvents[]): Promise<ApiFriendsActionResponse> {
      if (!demo) return request(action);
      switch (action.action) {
        case 'save_profile': local.profile = { nickname: action.nickname!.trim(), shareStats: action.shareStats!, shareArrival: action.shareArrival! }; break;
        case 'disable': local = { profile: null, ownCard: null, friends: [] }; break;
        case 'remove_friend': local.friends = local.friends.filter((friend) => friend.id !== action.friendId); break;
        default: throw new FriendsError('friends.demoInvites');
      }
      return { snapshot: snapshot(parcels) };
    },
  };
}
export type FriendsClient = ReturnType<typeof createFriendsClient>;
