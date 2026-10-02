import { useSyncExternalStore } from 'react';
import { cleanParcelName } from './recents';

const eventName = 'peek-route-change';

/** Pip carries this name on the front door and on the parcel page, so the browser can move it between them. */
export const PIP_TRANSITION_NAME = 'peek-pip';

/**
 * The link id in a `/p/<id>` address, or null anywhere else. Any id makes a
 * parcel address: a malformed one opens the same unavailable page as a
 * forgotten one.
 */
export function parcelLinkIdFromPath(pathname: string): string | null {
  const segment = /^\/p\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (!segment) return null;
  try { return decodeURIComponent(segment); } catch { return segment; }
}

export function parcelLinkPath(id: string): string {
  return `/p/${encodeURIComponent(id)}`;
}

/** A parcel's own address, to share or copy. It never carries the name. */
export function parcelLinkURL(id: string, origin = window.location.origin): string {
  return new URL(parcelLinkPath(id), origin).href;
}

/** The name a link carries in its `#n=<name>` part, which never reaches a server. */
export function linkNameFromHash(hash: string): string | null {
  const encoded = /^#n=(.*)$/s.exec(hash)?.[1];
  if (!encoded) return null;
  try { return cleanParcelName(decodeURIComponent(encoded)); } catch { return null; }
}

/** The name in the open link's address. The address keeps it: a reload or a share still has it. */
export function linkNameFromLocation(): string | null {
  return typeof window === 'undefined' ? null : linkNameFromHash(window.location.hash);
}

function subscribe(notify: () => void) {
  window.addEventListener(eventName, notify);
  window.addEventListener('popstate', notify);
  return () => {
    window.removeEventListener(eventName, notify);
    window.removeEventListener('popstate', notify);
  };
}

const current = () => parcelLinkIdFromPath(window.location.pathname) ?? '';

/**
 * The link id of the parcel page the address shows, or null. `serverId` is
 * the id the server rendered the page for, so the first paint already is the
 * parcel page.
 */
export function useParcelLinkRoute(serverId: string | null = null): string | null {
  return useSyncExternalStore(subscribe, current, () => serverId ?? '') || null;
}

/** Shows a parcel's page at its own address. Back returns to where the visitor was. */
export function openParcelLink(id: string, { replace = false }: { replace?: boolean } = {}): void {
  if (replace) window.history.replaceState(window.history.state, '', parcelLinkPath(id));
  else window.history.pushState(null, '', parcelLinkPath(id));
  window.dispatchEvent(new Event(eventName));
}

/** Leaves the parcel page: for the front door, or the deliveries of someone signed in. */
export function leaveParcelLink(path = '/'): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(eventName));
}
