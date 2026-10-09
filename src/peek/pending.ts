import { useSyncExternalStore } from 'react';
import { ApiAuthenticationError, type ApiAuth } from '../lib/apiClient';
import { ParcelAlreadyExistsError, type ParcelRepo } from '../types';
import { claimParcelLinks, forgetParcelLink, readParcelLink } from './links';
import { isParcelLinkId, type ParcelClaimResult } from './linkModel';
import { forgetRecent, recentFor } from './recents';

/**
 * "Keep it after signing in": a note of the parcel link to keep, held for
 * this tab so it survives the round trip to a sign-in provider and back to
 * `/`. Only the link id is noted, and whether signing in was for the delivery
 * email; the key and the name stay with the device's copy of the parcel.
 */
export const PENDING_KEEP_STORAGE_KEY = 'sdt.peek.pendingKeep.v1'; // gitleaks:allow -- sessionStorage name, not a credential
const MAX_AGE_MS = 24 * 60 * 60_000;
// Without usable storage the note lasts as long as the page, which covers signing in with an emailed code.
let memory: string | null = null;
let inMemory = false;
const eventName = 'peek-pending-keep-change';
const changed = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(eventName)); };

function stored(): string | null {
  if (inMemory) return memory;
  try { return window.sessionStorage.getItem(PENDING_KEEP_STORAGE_KEY); } catch { return memory; }
}

/** Notes the parcel to keep once someone is signed in; with `email`, they signed in to be emailed when it arrives. */
export function rememberPendingKeep(id: string, { email = false, now = Date.now() }: { email?: boolean; now?: number } = {}): void {
  if (!isParcelLinkId(id)) return;
  memory = JSON.stringify({ id, at: now, ...(email ? { email: true } : {}) });
  try {
    window.sessionStorage.setItem(PENDING_KEEP_STORAGE_KEY, memory);
    inMemory = false;
  } catch {
    inMemory = true;
  }
  changed();
}

function freshNote(now: number): { id: string; email: boolean } | null {
  try {
    const note = JSON.parse(stored() ?? 'null') as { id?: unknown; at?: unknown; email?: unknown } | null;
    const age = now - Number(note?.at);
    return note && isParcelLinkId(note.id) && age >= 0 && age < MAX_AGE_MS ? { id: note.id, email: note.email === true } : null;
  } catch {
    return null;
  }
}

/** The link id waiting to be kept, if the note is still fresh. */
export function pendingKeep(now = Date.now()): string | null {
  return freshNote(now)?.id ?? null;
}

/** Drops the note; with an id, only when the note is about that link. */
export function clearPendingKeep(id?: string): void {
  if (id !== undefined && pendingKeep() !== id) return;
  memory = null;
  try { window.sessionStorage.removeItem(PENDING_KEEP_STORAGE_KEY); } catch { /* Nothing was stored. */ }
  changed();
}

function subscribe(notify: () => void) {
  window.addEventListener(eventName, notify);
  return () => window.removeEventListener(eventName, notify);
}

/** The link id waiting to be kept, followed as the note is written and dropped. */
export function usePendingKeep(): string | null {
  return useSyncExternalStore(subscribe, () => pendingKeep(), () => null);
}

/** How keeping a parcel ended. `failed` means no answer came; the others are the server's. */
export interface KeepOutcome {
  id: string;
  outcome: ParcelClaimResult['outcome'] | 'failed';
  /** The parcel in the account, for `kept` and `already`. */
  packageId?: string;
  /** The delivery email is on, for someone who signed in to get it. */
  email?: boolean;
  /** The name the device had given it. */
  name: string | null;
}

type KeepListener = (outcome: KeepOutcome) => void;
const listeners = new Set<KeepListener>();
let unheard: KeepOutcome | null = null;

/** Tells the deliveries app how keeping a parcel ended. An outcome nobody heard waits for the next listener. */
export function announceKeepOutcome(outcome: KeepOutcome): void {
  if (!listeners.size) {
    unheard = outcome;
    return;
  }
  for (const listener of [...listeners]) listener(outcome);
}

/** Hears keep outcomes, starting with one announced before anybody listened. Returns the way to stop. */
export function onKeepOutcome(listener: KeepListener): () => void {
  listeners.add(listener);
  if (unheard) {
    const outcome = unheard;
    unheard = null;
    listener(outcome);
  }
  return () => { listeners.delete(listener); };
}

const settled = (outcome: KeepOutcome['outcome']) => outcome === 'kept' || outcome === 'already';

/**
 * Keeps one parcel link in the signed-in account. The device's name becomes
 * the parcel's label, and the device's copy goes once the account has the parcel.
 */
export async function keepParcelLink(id: string, auth: ApiAuth, signal?: AbortSignal): Promise<KeepOutcome> {
  const recent = recentFor(id);
  const [result] = await claimParcelLinks([{ id, key: recent?.key, label: recent?.name }], auth, signal);
  const outcome: KeepOutcome = {
    id,
    outcome: result?.outcome ?? 'unavailable',
    ...(result?.packageId ? { packageId: result.packageId } : {}),
    name: recent?.name ?? null,
  };
  if (settled(outcome.outcome)) forgetRecent(id);
  return outcome;
}

// One claim per note, however often the app renders or remounts meanwhile.
const keeping = new Set<string>();

/**
 * After sign-in: keeps the parcel the visitor asked to keep, once, and
 * announces how it ended. For someone who signed in to be emailed, `emailOn`
 * switches the delivery email on once the parcel is in the account, and the
 * outcome says whether it is. Without an answer the note stays for the next
 * visit of this tab.
 */
export async function keepPendingParcel(auth: ApiAuth, emailOn?: () => Promise<boolean>): Promise<KeepOutcome | null> {
  const note = freshNote(Date.now());
  if (!note || keeping.has(note.id)) return null;
  const { id } = note;
  keeping.add(id);
  try {
    const outcome = await keepParcelLink(id, auth, auth.signal);
    clearPendingKeep(id);
    // An email that could not be switched on stays as it was: the settings have it, and a delivered parcel asks.
    if (note.email && emailOn && settled(outcome.outcome) && await emailOn().catch(() => false)) outcome.email = true;
    announceKeepOutcome(outcome);
    return outcome;
  } catch (error) {
    // A sign-in that ended meanwhile says nothing about the parcel.
    if (auth.signal?.aborted || error instanceof ApiAuthenticationError) return null;
    const outcome: KeepOutcome = { id, outcome: 'failed', name: recentFor(id)?.name ?? null };
    announceKeepOutcome(outcome);
    return outcome;
  } finally {
    keeping.delete(id);
  }
}

/**
 * The demo has no accounts: entering it with a parcel to keep moves that
 * parcel, with its history, into the demo deliveries and forgets the device's copy.
 */
export async function keepPendingInDemo(repo: ParcelRepo): Promise<KeepOutcome | null> {
  const id = pendingKeep();
  if (!id || keeping.has(id)) return null;
  keeping.add(id);
  try {
    const recent = recentFor(id);
    const name = recent?.name ?? null;
    const read = await readParcelLink(id, { key: recent?.key }).catch(() => recent?.snapshot ?? 'unavailable' as const);
    let outcome: KeepOutcome = { id, outcome: 'unavailable', name };
    if (read !== 'unavailable' && read.link.canKeep && read.parcel.trackingNumber) {
      try {
        const kept = repo.adopt
          ? await repo.adopt(read.parcel, name ?? '')
          : await repo.add({ trackingNumber: read.parcel.trackingNumber, label: name ?? '', carrier: read.parcel.carrier });
        outcome = { id, outcome: 'kept', packageId: kept.id, name };
      } catch (error) {
        if (!(error instanceof ParcelAlreadyExistsError)) throw error;
        outcome = { id, outcome: 'already', packageId: error.parcelId, name };
      }
    }
    if (settled(outcome.outcome)) {
      if (recent?.key) await forgetParcelLink(id, recent.key).catch(() => undefined);
      forgetRecent(id);
    }
    clearPendingKeep(id);
    announceKeepOutcome(outcome);
    return outcome;
  } catch {
    const outcome: KeepOutcome = { id, outcome: 'failed', name: recentFor(id)?.name ?? null };
    announceKeepOutcome(outcome);
    return outcome;
  } finally {
    keeping.delete(id);
  }
}
