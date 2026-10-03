import { useSyncExternalStore } from 'react';
import { cleanLinkText, isParcelLinkId, MAX_GIFT_FROM_LENGTH, MAX_GIFT_NOTE_LENGTH, PARCEL_ALERT_PRESETS, type ParcelAlertPreset } from './linkModel';
import { SAMPLE_LINK_ID } from './sample';

/**
 * What this browser keeps about a parcel link besides the parcel itself: the
 * words its sharer sends along with it, and the alert this browser turned on.
 * None of it is stored on a server: the words travel in the link's `#` part,
 * and the server knows an alert only by the browser's push address.
 */
export const LINK_NOTES_STORAGE_KEY = 'sdt.peek.linknotes.v1'; // gitleaks:allow -- public localStorage name
/** Only the latest links can still matter. */
const MAX_NOTES = 60;
const eventName = 'peek-link-notes-change';

/** What a sharer chose for the link they hand out, and adds to it. */
export interface ShareWords {
  /** The link carries the parcel's name. */
  name: boolean;
  /** A gift's note, and who it is from. */
  note: string;
  from: string;
}

/** The alert this browser has on a link: what it announces, and the push address the server knows it by. */
export interface DeviceAlert {
  preset: ParcelAlertPreset;
  endpoint: string;
}

export interface LinkNote {
  share?: ShareWords;
  alert?: DeviceAlert;
}

type Notes = Record<string, LinkNote>;
/** Notes are kept about parcel links, and about the sample, whose alert is nothing but a note. */
const noted = (id: string) => isParcelLinkId(id) || id === SAMPLE_LINK_ID;
const EMPTY: Notes = {};
// Storage that cannot be read or written leaves the notes working for as long as the page lives.
let memory: string | null = null;
let storageFailed = false;
let cached: { raw: string | null; notes: Notes } = { raw: null, notes: EMPTY };

function stored(): string | null {
  if (storageFailed) return memory;
  try { return window.localStorage.getItem(LINK_NOTES_STORAGE_KEY); } catch { return memory; }
}

function note(value: unknown): LinkNote | null {
  if (!value || typeof value !== 'object') return null;
  const { share, alert } = value as { share?: Partial<ShareWords>; alert?: Partial<DeviceAlert> };
  const kept: LinkNote = {};
  if (share && typeof share === 'object') {
    kept.share = {
      name: share.name === true,
      note: cleanLinkText(typeof share.note === 'string' ? share.note : '', MAX_GIFT_NOTE_LENGTH) ?? '',
      from: cleanLinkText(typeof share.from === 'string' ? share.from : '', MAX_GIFT_FROM_LENGTH) ?? '',
    };
  }
  if (alert && typeof alert === 'object' && typeof alert.endpoint === 'string' && alert.endpoint
    && PARCEL_ALERT_PRESETS.includes(alert.preset as ParcelAlertPreset)) {
    kept.alert = { preset: alert.preset as ParcelAlertPreset, endpoint: alert.endpoint };
  }
  return kept.share || kept.alert ? kept : null;
}

function read(): Notes {
  const raw = stored();
  if (raw === cached.raw) return cached.notes;
  let notes: Notes = EMPTY;
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      notes = Object.fromEntries(Object.entries(value)
        .map(([id, entry]): [string, LinkNote | null] => [id, noted(id) ? note(entry) : null])
        .filter((entry): entry is [string, LinkNote] => entry[1] !== null));
    }
  } catch { /* Damaged notes are no notes. */ }
  cached = { raw, notes };
  return notes;
}

function write(notes: Notes) {
  const kept = Object.entries(notes).slice(-MAX_NOTES);
  memory = kept.length ? JSON.stringify(Object.fromEntries(kept)) : null;
  try {
    if (memory) window.localStorage.setItem(LINK_NOTES_STORAGE_KEY, memory);
    else window.localStorage.removeItem(LINK_NOTES_STORAGE_KEY);
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
  window.dispatchEvent(new Event(eventName));
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== LINK_NOTES_STORAGE_KEY) return;
    storageFailed = false;
    notify();
  };
  window.addEventListener(eventName, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(eventName, notify);
    window.removeEventListener('storage', onStorage);
  };
}

const NOTHING: LinkNote = {};

export function linkNote(id: string): LinkNote {
  return read()[id] ?? NOTHING;
}

/** This browser's notes about one link; empty for a link it has none about. */
export function useLinkNote(id: string | null): LinkNote {
  return useSyncExternalStore(subscribe, () => id ? linkNote(id) : NOTHING, () => NOTHING);
}

/** Changes what this browser keeps about a link. A part set to null is dropped; the newest link is kept longest. */
export function noteLink(id: string, changes: { share?: ShareWords | null; alert?: DeviceAlert | null }): void {
  if (!noted(id)) return;
  const { [id]: existing, ...others } = read();
  const next = note({
    share: changes.share === undefined ? existing?.share : changes.share ?? undefined,
    alert: changes.alert === undefined ? existing?.alert : changes.alert ?? undefined,
  });
  write(next ? { ...others, [id]: next } : others);
}

/** Drops everything this browser keeps about a link, as when its parcel is forgotten. */
export function forgetLinkNote(id: string): void {
  const { [id]: existing, ...others } = read();
  if (existing) write(others);
}

export function forgetAllLinkNotes(): void {
  write({});
}
