import { useSyncExternalStore } from 'react';
import { CARRIERS, requirementSatisfied, type CarrierInputRequirement } from './carriers';
import type { CarrierId } from '../types';

/**
 * The postcodes this browser gave carriers for lookups without an account,
 * newest first. They are kept apart from the parcels, so a parcel that is
 * forgotten leaves its postcode for the next one. A signed-in account's
 * postcodes stay with its parcels and are never kept here.
 */
export const POSTCODES_STORAGE_KEY = 'sdt.postcodes.v1'; // gitleaks:allow -- public localStorage name
/** Enough for a home, a workplace and a few others. */
export const MAX_POSTCODES = 5;
const eventName = 'postcodes-change';

/** A postcode given to a carrier for an earlier parcel. */
export interface GivenPostcode {
  carrier: CarrierId;
  postcode?: string | null;
}

/** A postcode as carriers print it: trimmed, in capitals, with single spaces. */
const printed = (postcode: string) => postcode.trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * The postcode to suggest for a carrier's field, from earlier parcels newest
 * first: the last one given to the same carrier, otherwise the last one given
 * to any carrier that this field accepts. Most parcels go to the same address,
 * but a Swiss postcode never fills a field that wants five digits.
 */
export function rememberedPostcode(
  carrier: CarrierId,
  requirement: CarrierInputRequirement,
  given: readonly GivenPostcode[],
): string | undefined {
  const accepted = given.flatMap(({ carrier: to, postcode }) => {
    const value = postcode ? printed(postcode) : '';
    return value && requirementSatisfied(requirement, value) ? [{ to, value }] : [];
  });
  return (accepted.find(({ to }) => to === carrier) ?? accepted[0])?.value;
}

interface Kept { carrier: CarrierId; postcode: string }
const EMPTY: Kept[] = [];
// Storage that cannot be read or written leaves the memory working for as long as the page lives.
let memory: string | null = null;
let storageFailed = false;
let cached: { raw: string | null; list: Kept[] } = { raw: null, list: EMPTY };

function stored(): string | null {
  if (storageFailed) return memory;
  try { return window.localStorage.getItem(POSTCODES_STORAGE_KEY); } catch { return memory; }
}

function isKept(value: unknown): value is Kept {
  if (!value || typeof value !== 'object') return false;
  const { carrier, postcode } = value as Partial<Kept>;
  return typeof carrier === 'string' && Object.hasOwn(CARRIERS, carrier)
    && typeof postcode === 'string' && /^[A-Z0-9][A-Z0-9 -]{1,14}$/.test(postcode);
}

function read(): Kept[] {
  const raw = stored();
  if (raw === cached.raw) return cached.list;
  let list = EMPTY;
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(value)) list = value.filter(isKept).slice(0, MAX_POSTCODES);
  } catch { /* A damaged memory is an empty one. */ }
  cached = { raw, list };
  return list;
}

function write(list: Kept[]) {
  memory = list.length ? JSON.stringify(list.slice(0, MAX_POSTCODES)) : null;
  try {
    if (memory) window.localStorage.setItem(POSTCODES_STORAGE_KEY, memory);
    else window.localStorage.removeItem(POSTCODES_STORAGE_KEY);
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
  window.dispatchEvent(new Event(eventName));
}

function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== POSTCODES_STORAGE_KEY) return;
    // Another tab's memory replaces this page's copy.
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

/** The postcodes this browser gave, newest first. */
export function usePostcodeMemory(): readonly GivenPostcode[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/** Keeps a postcode a lookup without an account was given; giving it again moves it to the front. */
export function rememberPostcode(carrier: CarrierId, postcode: string): void {
  const kept = { carrier, postcode: printed(postcode) };
  if (!isKept(kept)) return;
  write([kept, ...read().filter((entry) => entry.carrier !== carrier || entry.postcode !== kept.postcode)]);
}

/** Forgets a postcode, whichever carriers it was given to. */
export function forgetPostcode(postcode: string): void {
  const list = read();
  const forgotten = printed(postcode);
  if (list.some((entry) => entry.postcode === forgotten)) write(list.filter((entry) => entry.postcode !== forgotten));
}
