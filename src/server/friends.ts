import 'server-only';
import type { ApiFriendCard, ApiFriendProfile, ApiFriendsActionRequest, ApiFriendsActionResponse, ApiFriendsSnapshot, ApiFriendStamp } from '../generated/apiContract';
import { HttpError } from './api';
import { isRecord, type JsonObject } from './types';
import { SupabaseError, type SupabaseUserClient } from './supabase';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stamps = new Set<ApiFriendStamp>(['first', 'ten', 'connected', 'express']);
const fields: Record<ApiFriendsActionRequest['action'], string[]> = {
  save_profile: ['nickname', 'shareStats', 'shareArrival'], create_invite: [], revoke_invite: [],
  preview_invite: ['code'], accept_invite: ['code'], remove_friend: ['friendId'], disable: [],
};
const invalid = () => new HttpError(400, 'Invalid Friends request');
function nickname(value: unknown): value is string {
  return typeof value === 'string' && [...value.trim()].length >= 1 && [...value.trim()].length <= 24 && !/[\p{Cc}\p{Cf}]/u.test(value);
}
export function friendsAction(payload: JsonObject): ApiFriendsActionRequest {
  if (typeof payload.action !== 'string' || !Object.hasOwn(fields, payload.action)) throw invalid();
  const allowed = fields[payload.action as ApiFriendsActionRequest['action']];
  if (Object.keys(payload).some((key) => key !== 'action' && !allowed.includes(key)) || allowed.some((key) => payload[key] === undefined)) throw invalid();
  if (payload.action === 'save_profile' && (!nickname(payload.nickname) || typeof payload.shareStats !== 'boolean' || typeof payload.shareArrival !== 'boolean')) throw invalid();
  if (allowed.includes('code') && (typeof payload.code !== 'string' || !/^[a-f0-9]{32}$/.test(payload.code))) throw invalid();
  if (allowed.includes('friendId') && (typeof payload.friendId !== 'string' || !uuid.test(payload.friendId))) throw invalid();
  return { ...payload, ...(typeof payload.nickname === 'string' ? { nickname: payload.nickname.trim() } : {}) } as unknown as ApiFriendsActionRequest;
}
function corrupt(): never { throw new HttpError(502, 'Friends is temporarily unavailable'); }
function profile(value: unknown): ApiFriendProfile | null {
  if (value === null) return null;
  if (!isRecord(value) || !nickname(value.nickname) || typeof value.shareStats !== 'boolean' || typeof value.shareArrival !== 'boolean') return corrupt();
  return { nickname: value.nickname, shareStats: value.shareStats, shareArrival: value.shareArrival };
}
/** Explicit projection is a second boundary: adding a DB field can never publish it. */
export function friendCard(value: unknown): ApiFriendCard {
  if (!isRecord(value) || typeof value.id !== 'string' || !uuid.test(value.id) || !nickname(value.nickname) || !(value.arrivedThisWeek === null || typeof value.arrivedThisWeek === 'boolean')) return corrupt();
  let stats: ApiFriendCard['stats'] = null;
  if (value.stats !== null) {
    const s = value.stats;
    if (!isRecord(s) || !Number.isSafeInteger(s.deliveredCount) || Number(s.deliveredCount) < 0 || !(s.averageDays === null || (Number.isSafeInteger(s.averageDays) && Number(s.averageDays) >= 1)) || !Array.isArray(s.stamps) || s.stamps.length > 4 || s.stamps.some((stamp) => !stamps.has(stamp as ApiFriendStamp))) return corrupt();
    stats = { deliveredCount: Number(s.deliveredCount), averageDays: s.averageDays === null ? null : Number(s.averageDays), stamps: [...new Set(s.stamps as ApiFriendStamp[])] };
  }
  return { id: value.id, nickname: value.nickname, stats, arrivedThisWeek: value.arrivedThisWeek };
}
export function friendsSnapshot(value: unknown): ApiFriendsSnapshot {
  if (!isRecord(value) || !Array.isArray(value.friends) || value.friends.length > 50) return corrupt();
  const own = profile(value.profile);
  if (!own && (value.ownCard !== null || value.friends.length)) return corrupt();
  return { profile: own, ownCard: value.ownCard === null ? null : friendCard(value.ownCard), friends: value.friends.map(friendCard) };
}
export async function friendsRPC(client: SupabaseUserClient, action?: ApiFriendsActionRequest): Promise<unknown> {
  try {
    return await client.request(`/rest/v1/rpc/${action ? 'friends_action' : 'friends_snapshot'}`, {
      method: 'POST', body: action ? {
        p_action: action.action, p_nickname: action.nickname ?? null, p_share_stats: action.shareStats ?? null,
        p_share_arrival: action.shareArrival ?? null, p_code: action.code ?? null, p_friend_id: action.friendId ?? null,
      } : {},
    });
  } catch (error) {
    if (error instanceof SupabaseError) {
      if (error.code === 'P0002') throw new HttpError(404, 'Invitation unavailable');
      if (error.code === 'P0003') throw new HttpError(409, 'Your circle is full');
      if (error.code === '22023') throw invalid();
      if (error.code === 'PGRST202' || error.code === '42883') throw new HttpError(503, 'Friends is temporarily unavailable');
    }
    throw error;
  }
}
export function friendsActionResponse(value: unknown, action: ApiFriendsActionRequest['action']): ApiFriendsActionResponse {
  if (!isRecord(value)) return corrupt();
  if (action === 'create_invite') {
    if (typeof value.inviteCode !== 'string' || !/^[a-f0-9]{32}$/.test(value.inviteCode) || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) return corrupt();
    return { inviteCode: value.inviteCode, expiresAt: value.expiresAt };
  }
  if (action === 'preview_invite') {
    if (!nickname(value.previewNickname)) return corrupt();
    return { previewNickname: value.previewNickname };
  }
  return { snapshot: friendsSnapshot(value.snapshot) };
}
