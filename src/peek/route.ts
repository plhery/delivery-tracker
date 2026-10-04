import { useSyncExternalStore } from 'react';
import { isLandingPath, LANDING_PATH } from '../lib/experience';
import { cleanLinkText, MAX_GIFT_FROM_LENGTH, MAX_GIFT_NOTE_LENGTH } from './linkModel';
import { cleanParcelName } from './recents';
import { SAMPLE_LINK_ID, SAMPLE_PATH } from './sample';

const eventName = 'peek-route-change';

/** Pip carries this name on the front door and on the parcel page, so the browser can move it between them. */
export const PIP_TRANSITION_NAME = 'peek-pip';

/**
 * The link id in a `/p/<id>` address, or null anywhere else. Any id makes a
 * parcel address: a malformed one opens the same unavailable page as a
 * forgotten one. The sample parcel has an address of its own.
 */
export function parcelLinkIdFromPath(pathname: string): string | null {
  if (pathname === SAMPLE_PATH || pathname === `${SAMPLE_PATH}/`) return SAMPLE_LINK_ID;
  const segment = /^\/p\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (!segment) return null;
  let id = segment;
  try { id = decodeURIComponent(segment); } catch { /* The segment as written is as malformed as any. */ }
  // Only the sample's own address shows the sample.
  return id === SAMPLE_LINK_ID ? 'unavailable' : id;
}

export function parcelLinkPath(id: string): string {
  return id === SAMPLE_LINK_ID ? SAMPLE_PATH : `/p/${encodeURIComponent(id)}`;
}

/** A parcel's own address, to share or copy. It never carries the name. */
export function parcelLinkURL(id: string, origin = window.location.origin): string {
  return new URL(parcelLinkPath(id), origin).href;
}

/**
 * What a link carries after its `#`, which never reaches a server: the
 * parcel's name (`n`), and for a gift a note (`g`) and who it is from (`f`).
 */
export interface LinkWords {
  name: string | null;
  note: string | null;
  from: string | null;
}

const NO_WORDS: LinkWords = { name: null, note: null, from: null };
const WORD_KEYS = { n: 'name', g: 'note', f: 'from' } as const;

/** Reads `#n=<name>&g=<note>&f=<from>`. A part that is not one of these three makes the whole `#` someone else's. */
export function linkWordsFromHash(hash: string): LinkWords {
  if (!hash.startsWith('#') || hash.length < 2) return NO_WORDS;
  const words: LinkWords = { ...NO_WORDS };
  for (const part of hash.slice(1).split('&')) {
    const at = part.indexOf('=');
    const key = at < 0 ? '' : part.slice(0, at);
    if (!Object.hasOwn(WORD_KEYS, key)) return NO_WORDS;
    let value: string;
    try { value = decodeURIComponent(part.slice(at + 1)); } catch { continue; }
    const word = WORD_KEYS[key as keyof typeof WORD_KEYS];
    words[word] = word === 'name' ? cleanParcelName(value)
      : cleanLinkText(value, word === 'note' ? MAX_GIFT_NOTE_LENGTH : MAX_GIFT_FROM_LENGTH);
  }
  return words;
}

/** The name a link carries in its `#n=<name>` part, which never reaches a server. */
export function linkNameFromHash(hash: string): string | null {
  return linkWordsFromHash(hash).name;
}

/**
 * A parcel's address with the words its sharer chose to send along. They go
 * after the `#`, so they reach the recipient's browser and no server.
 */
export function parcelShareURL(id: string, words: Partial<LinkWords> = {}, origin = window.location.origin): string {
  const parts = (Object.entries(WORD_KEYS) as [string, keyof LinkWords][])
    .map(([key, word]): [string, string | null] => [key, word === 'name' ? cleanParcelName(words.name)
      : cleanLinkText(words[word], word === 'note' ? MAX_GIFT_NOTE_LENGTH : MAX_GIFT_FROM_LENGTH)])
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return parcelLinkURL(id, origin) + (parts.length ? `#${parts.join('&')}` : '');
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

const atLanding = () => isLandingPath(window.location.pathname);

/**
 * Whether the address is one of the landing's own (`/home`, or a language's
 * such as `/de`), where the landing shows to someone signed in too.
 * `serverLanding` says the server rendered such an address.
 */
export function useLandingRoute(serverLanding = false): boolean {
  return useSyncExternalStore(subscribe, atLanding, () => serverLanding);
}

/** Shows the landing at its own address, without leaving the page. Back returns to where the reader was. */
export function openLanding(): void {
  window.history.pushState(null, '', LANDING_PATH);
  // Told the way the browser tells a step in the history, so everything that follows the address hears it.
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Shows a parcel's page at its own address. Back returns to where the visitor was. */
export function openParcelLink(id: string, { replace = false }: { replace?: boolean } = {}): void {
  if (replace) window.history.replaceState(window.history.state, '', parcelLinkPath(id));
  else window.history.pushState(null, '', parcelLinkPath(id));
  window.dispatchEvent(new Event(eventName));
}

/** Leaves the parcel page, or the landing's own address: for the front door, or the deliveries of someone signed in. */
export function leaveParcelLink(path = '/'): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(eventName));
}
