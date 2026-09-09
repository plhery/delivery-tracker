import type { IconName } from '../components/Icon';
import fixture from '../../shared/friends-demo.json';
import type { ApiFriendCard, ApiFriendProfile, ApiFriendsActionRequest, ApiFriendsActionResponse, ApiFriendsSnapshot, ApiFriendStamp } from '../generated/apiContract';
import type { MessageKey } from '../i18n';
import type { ParcelWithEvents } from '../types';
import { authenticatedFetch, type ApiAuth } from './apiClient';
import { currentStage } from './stages';
import { passportStatistics } from './passport';

export const friendStamps: Record<ApiFriendStamp, { title: MessageKey; explanation: MessageKey; icon: IconName; tone: string; numeral?: string }> = {
  first: { title: 'passport.firstArrival', explanation: 'passport.firstExplanation', icon: 'parcel', tone: 'green' },
  ten: { title: 'passport.doubleDigits', explanation: 'passport.tenExplanation', icon: 'stamp', tone: 'lilac' },
  connected: { title: 'passport.wellConnected', explanation: 'passport.carrierExplanation', icon: 'globe', tone: 'blue' },
  express: { title: 'passport.expressArrival', explanation: 'passport.expressExplanation', icon: 'express', tone: 'peach' },
  acrossBorders: { title: 'passport.acrossBorders', explanation: 'passport.acrossExplanation', icon: 'border', tone: 'blue' },
  aroundWorld: { title: 'passport.aroundWorld', explanation: 'passport.aroundExplanation', icon: 'worldMap', tone: 'green' },
  theRegular: { title: 'passport.theRegular', explanation: 'passport.regularExplanation', icon: 'stamp', tone: 'lilac', numeral: '25' },
  rightNextDoor: { title: 'passport.rightNextDoor', explanation: 'passport.domesticExplanation', icon: 'houses', tone: 'green' },
  worthTheWait: { title: 'passport.worthTheWait', explanation: 'passport.waitExplanation', icon: 'hourglass', tone: 'ochre' },
  busyDoorstep: { title: 'passport.busyDoorstep', explanation: 'friends.busyStampDetail', icon: 'parcels', tone: 'peach' },
  pickedUp: { title: 'passport.pickedUp', explanation: 'passport.pickupExplanation', icon: 'storefront', tone: 'blue' },
  homeForHolidays: { title: 'passport.homeForHolidays', explanation: 'friends.holidayStampDetail', icon: 'gift', tone: 'green' },
};
export const friendTone = (id: string) => ['blue', 'lilac', 'peach', 'green'][parseInt(id.replaceAll('-', '').slice(0, 2), 16) % 4 || 0];
export function ownFriendCard(parcels: readonly ParcelWithEvents[], profile: ApiFriendProfile): ApiFriendCard {
  const stats = passportStatistics(parcels, 'UTC');
  const earned: ApiFriendStamp[] = [];
  if (stats.deliveredCount >= 1) earned.push('first');
  if (stats.deliveredCount >= 10) earned.push('ten');
  if (stats.carrierCount >= 3) earned.push('connected');
  if (stats.fastestDelivery && stats.fastestDelivery.duration <= 172800_000) earned.push('express');
  if (stats.crossBorderCount >= 1) earned.push('acrossBorders');
  if (stats.originCountries.length >= 5) earned.push('aroundWorld');
  if (stats.deliveredCount >= 25) earned.push('theRegular');
  if (stats.domesticDeliveryCount >= 1) earned.push('rightNextDoor');
  if (stats.longWaitDeliveryCount >= 1) earned.push('worthTheWait');
  if (stats.maxDeliveriesInOneDay >= 3) earned.push('busyDoorstep');
  if (stats.pickupDeliveryCount >= 1) earned.push('pickedUp');
  if (stats.decemberDeliveryCount >= 1) earned.push('homeForHolidays');
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
