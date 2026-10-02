import type { ApiAuth } from '../../lib/apiClient';
import { ParcelAlreadyExistsError, type ParcelRepo } from '../../types';
import { claimParcelLinks, forgetParcelLink, readParcelLink } from '../links';
import { forgetRecent, type RecentParcel } from '../recents';

/**
 * "Bring these parcels too?": the other parcels this device looked up before
 * someone signed in. Each is offered once; what was declined stays on the
 * device, and is not asked about again.
 */
export const BRING_ALONG_STORAGE_KEY = 'sdt.peek.bringAlong.v1'; // gitleaks:allow -- public localStorage name
// Without usable storage the answer lasts as long as the page.
let memory: string[] | null = null;

/** The link ids this device was already asked about. */
export function offeredParcels(): ReadonlySet<string> {
  if (memory) return new Set(memory);
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(BRING_ALONG_STORAGE_KEY) ?? '[]');
    if (Array.isArray(value)) return new Set(value.filter((id): id is string => typeof id === 'string'));
  } catch { /* A damaged or unreadable list is an empty one. */ }
  return new Set();
}

export function markOffered(ids: readonly string[]): void {
  // Only the device's latest parcels can still be there to ask about.
  const offered = [...new Set([...offeredParcels(), ...ids])].slice(-60);
  try {
    window.localStorage.setItem(BRING_ALONG_STORAGE_KEY, JSON.stringify(offered));
    memory = null;
  } catch {
    memory = offered;
  }
}

/** The device's parcels someone signed in can take along: looked up here, so the device holds their key. */
export function bringable(recents: readonly RecentParcel[], pendingId: string | null): RecentParcel[] {
  const offered = offeredParcels();
  return recents.filter((recent) => !!recent.key && recent.id !== pendingId && !offered.has(recent.id));
}

/**
 * Keeps several of the device's parcels in the account with one request. A
 * parcel the account now has leaves the device; the count is how many joined
 * or were there already.
 */
export async function bringAlong(parcels: readonly RecentParcel[], auth: ApiAuth): Promise<number> {
  const results = await claimParcelLinks(parcels.map(({ id, key, name }) => ({ id, key, label: name })), auth, auth.signal);
  let brought = 0;
  for (const result of results) {
    if (result.outcome !== 'kept' && result.outcome !== 'already') continue;
    forgetRecent(result.id);
    brought += 1;
  }
  return brought;
}

/** The demo's counterpart: each parcel moves into the demo deliveries with its history, and its link is forgotten. */
export async function bringAlongInDemo(parcels: readonly RecentParcel[], repo: ParcelRepo): Promise<number> {
  let brought = 0;
  for (const recent of parcels) {
    const read = await readParcelLink(recent.id, { key: recent.key }).catch(() => recent.snapshot);
    if (read === 'unavailable' || !read.parcel.trackingNumber) continue;
    try {
      if (repo.adopt) await repo.adopt(read.parcel, recent.name ?? '');
      else await repo.add({ trackingNumber: read.parcel.trackingNumber, label: recent.name ?? '', carrier: read.parcel.carrier });
    } catch (error) {
      if (!(error instanceof ParcelAlreadyExistsError)) throw error;
    }
    if (recent.key) await forgetParcelLink(recent.id, recent.key).catch(() => undefined);
    forgetRecent(recent.id);
    brought += 1;
  }
  return brought;
}
