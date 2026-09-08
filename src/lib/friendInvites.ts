import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { FriendsError } from './friends';
import { isInvitationPreviewId, shortInvitationPreviewId } from './invitationLinkFormat';

const tokenPattern = /^[a-f0-9]{32}$/;
export const INVITATION_STORAGE_KEY = 'sdt.pendingFriendInvitation.v1'; // gitleaks:allow -- sessionStorage key, not a credential
const eventName = 'delivery-invitation-change';
const maxAge = 7 * 24 * 60 * 60 * 1_000;
type PendingInvitation = { code: string | null; opened: boolean; receivedAt: number; accepted?: boolean };
let memory: string | null = null;

export async function invitationURL(code: string, previewId?: string, origin = window.location.origin): Promise<string> {
  if (!tokenPattern.test(code)) throw new Error('Invalid invitation');
  if (previewId !== undefined) {
    if (!isInvitationPreviewId(previewId)) throw new Error('Invalid invitation preview');
    return new URL(`/i/${previewId}#${code}`, origin).href;
  }
  // Older servers do not return a preview ID yet; their existing links still work.
  const url = new URL(`/invite#${code}`, origin);
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
    const preview = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    url.searchParams.set('preview', preview);
  } catch { /* Older or insecure browsers can still share a working fragment-only link. */ }
  return url.href;
}

export function invitationCode(text: string, origin = window.location.origin): string | null {
  try {
    const url = new URL(text.trim());
    if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (shortInvitationPreviewId(url.pathname)) {
      if (url.search) return null;
    } else {
      if (url.pathname !== '/invite') return null;
      if (url.search && (url.searchParams.size !== 1 || !/^[a-f0-9]{64}$/.test(url.searchParams.get('preview') ?? ''))) return null;
    }
    const code = url.hash.slice(1);
    return tokenPattern.test(code) ? code : null;
  } catch { return null; }
}

function stored(): string | null {
  if (memory && (JSON.parse(memory) as PendingInvitation).accepted) return memory;
  try { return sessionStorage.getItem(INVITATION_STORAGE_KEY); } catch { return memory; }
}
function read(): string {
  const url = new URL(window.location.href);
  const shortRoute = url.pathname.startsWith('/i/');
  if (shortRoute || (url.pathname === '/invite' && (url.hash || url.search))) return JSON.stringify({ code: invitationCode(url.href), opened: false, receivedAt: 0 });
  const raw = stored();
  if (raw) {
    try {
      const value = JSON.parse(raw) as PendingInvitation;
      const age = Date.now() - value.receivedAt;
      if (tokenPattern.test(value.code ?? '') && typeof value.opened === 'boolean' && age >= 0 && age < maxAge) return raw;
    } catch { /* A damaged or expired pending link is unavailable. */ }
  }
  return url.pathname === '/invite' ? 'invalid' : '';
}
function subscribe(notify: () => void) {
  for (const event of [eventName, 'hashchange', 'popstate', 'storage']) window.addEventListener(event, notify);
  return () => { for (const event of [eventName, 'hashchange', 'popstate', 'storage']) window.removeEventListener(event, notify); };
}
function write(value: PendingInvitation | null, path?: string) {
  memory = value?.code ? JSON.stringify(value) : null;
  try {
    if (memory && !value?.accepted) sessionStorage.setItem(INVITATION_STORAGE_KEY, memory);
    else sessionStorage.removeItem(INVITATION_STORAGE_KEY);
  } catch { /* Preserve the invitation in memory when storage is unavailable. */ }
  if (path) window.history.replaceState(window.history.state, '', path);
  window.dispatchEvent(new Event(eventName));
}
export function openPendingInvitation(url: string) {
  const code = invitationCode(url);
  if (!code) return;
  write({ code, opened: false, receivedAt: Date.now() }, '/invite');
}
export function usePendingInvitation(invitationRoute = false) {
  const snapshot = useSyncExternalStore(subscribe, read, () => invitationRoute ? 'invalid' : '');
  const pending = useMemo<PendingInvitation | null>(() => snapshot === 'invalid' ? { code: null, opened: false, receivedAt: -1 } : snapshot ? JSON.parse(snapshot) as PendingInvitation : null, [snapshot]);
  useEffect(() => {
    // Strip the fragment and preview key before authentication. Only the token and opened state
    // survive the OAuth round trip in this tab; never persist the sender's name.
    if (pending?.receivedAt === 0) write({ ...pending, receivedAt: Date.now() }, '/invite');
  }, [pending]);
  return {
    pending,
    setOpened(opened: boolean) { if (pending) write({ ...pending, opened }); },
    markAccepted() {
      const current = read();
      if (!pending?.code || !current || current === 'invalid' || (JSON.parse(current) as PendingInvitation).code !== pending.code) return false;
      // Keep the receipt animation in memory; a reload goes straight to Friends.
      write({ ...pending, opened: true, accepted: true }, '/?view=friends');
      return true;
    },
    clear(accepted = false) {
      if (accepted) {
        const current = read();
        if (!pending?.code || !current || current === 'invalid' || (JSON.parse(current) as PendingInvitation).code !== pending.code) return;
      }
      write(null, accepted ? '/?view=friends' : '/');
    },
  };
}
export type PendingInvitationState = ReturnType<typeof usePendingInvitation>;

export async function previewInvitation(code: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch('/api/friends/invite-preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
  });
  if (!response.ok) throw new FriendsError(response.status === 400 || response.status === 404 ? 'friends.inviteUnavailable' : 'friends.unavailable');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || !('previewNickname' in value) || typeof value.previewNickname !== 'string' || !value.previewNickname.trim() || [...value.previewNickname].length > 24 || /[\p{Cc}\p{Cf}]/u.test(value.previewNickname)) throw new FriendsError('friends.unavailable');
  return value.previewNickname;
}
