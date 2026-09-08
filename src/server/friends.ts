import 'server-only';
import { createHash } from 'node:crypto';
import { isInvitationPreviewId } from '../lib/invitationLinkFormat';
import type { ApiFriendCard, ApiFriendProfile, ApiFriendsActionRequest, ApiFriendsActionResponse, ApiFriendsSnapshot, ApiFriendStamp, ApiFriendsActivity } from '../generated/apiContract';
import { HttpError } from './api';
import { isRecord, type JsonObject } from './types';
import { SupabaseError, type SupabaseUserClient, type SupabaseServiceClient } from './supabase';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const stamps = new Set<ApiFriendStamp>(['first', 'ten', 'connected', 'express']);
const fields: Record<ApiFriendsActionRequest['action'], string[]> = {
  save_profile: ['nickname', 'shareStats', 'shareArrival'], create_invite: [], revoke_invite: [],
  preview_invite: ['code'], accept_invite: ['code'], remove_friend: ['friendId'], acknowledge_friend: ['friendId'], disable: [],
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

/** A bearer invitation reveals only its sender's nickname, without consuming it. */
export async function invitationPreview(client: SupabaseServiceClient, payload: JsonObject): Promise<{ previewNickname: string }> {
  if (Object.keys(payload).length !== 1 || typeof payload.code !== 'string' || !/^[a-f0-9]{32}$/.test(payload.code)) throw invalid();
  return invitationPreviewByHash(client, createHash('sha256').update(payload.code).digest('hex'));
}

/** The public preview hash can reveal a nickname, but cannot accept an invitation. */
export async function invitationPreviewByHash(client: SupabaseServiceClient, hash: string): Promise<{ previewNickname: string }> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw invalid();
  return invitationPreviewLookup(client, 'code_hash', hash);
}

export async function invitationPreviewById(client: SupabaseServiceClient, previewId: string): Promise<{ previewNickname: string }> {
  if (!isInvitationPreviewId(previewId)) throw invalid();
  return invitationPreviewLookup(client, 'preview_id', previewId);
}

async function invitationPreviewLookup(client: SupabaseServiceClient, column: 'code_hash' | 'preview_id', value: string): Promise<{ previewNickname: string }> {
  const query = new URLSearchParams({
    select: 'friend_profiles!inner(nickname)',
    [column]: `eq.${value}`,
    expires_at: `gt.${new Date().toISOString()}`,
    limit: '1',
  });
  const result = await client.request(`/rest/v1/friend_invites?${query}`);
  if (!Array.isArray(result)) return corrupt();
  if (!result.length) throw new HttpError(404, 'Invitation unavailable');
  const sender = isRecord(result[0]) ? result[0].friend_profiles : null;
  if (!isRecord(sender) || !nickname(sender.nickname)) return corrupt();
  return { previewNickname: sender.nickname };
}
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
      if (error.code === 'P0004') throw new HttpError(422, 'Cannot accept your own invitation');
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
    if (value.previewId !== undefined && !isInvitationPreviewId(value.previewId)) return corrupt();
    return { inviteCode: value.inviteCode, expiresAt: value.expiresAt, ...(value.previewId !== undefined ? { previewId: value.previewId } : {}) };
  }
  if (action === 'preview_invite') {
    if (!nickname(value.previewNickname)) return corrupt();
    return { previewNickname: value.previewNickname };
  }
  return { snapshot: friendsSnapshot(value.snapshot), ...(action === 'accept_invite' && value.acceptedFriend ? { acceptedFriend: friendCard(value.acceptedFriend) } : {}) };
}

export function friendsActivity(value: unknown): ApiFriendsActivity {
  if (!isRecord(value) || !Array.isArray(value.updates) || value.updates.length > 50) return corrupt();
  return { updates: value.updates.map((item) => {
    if (!isRecord(item) || typeof item.friendId !== 'string' || !uuid.test(item.friendId) || !nickname(item.nickname)) return corrupt();
    return { friendId: item.friendId, nickname: item.nickname };
  }) };
}
