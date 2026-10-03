import { isFinal } from '../../lib/stages';
import { forgetParcelLink, ParcelLinkError, readParcelLink } from '../links';
import { forgetRecent, rememberParcel, type RecentParcel } from '../recents';

/** How long an answer is fresh enough for the list: a parcel on its way moves, one that arrived rests. */
const FRESH_MS = 5 * 60_000;
const SETTLED_FRESH_MS = 12 * 60 * 60_000;
/** A lookup the carrier has not answered yet is asked about again soon. */
const WAITING_FRESH_MS = 1_500;
/** How soon, and how often, a list asks again about a parcel whose carrier has not answered yet. */
const FIRST_CHECK_MS = 2_000;
const FIRST_CHECK_ROUNDS = 6;
/** When the list last asked about each parcel, so coming back to the door does not ask again. */
const checkedAt = new Map<string, number>();

/** Whether the parcel is still waiting for its first check with the carrier. */
const waiting = (recent: Pick<RecentParcel, 'syncStatus'>) => recent.syncStatus === 'pending' || recent.syncStatus === 'syncing';

/**
 * Brings the device's parcels up to date, quietly: each stale one is read
 * through its link, one after the other. A parcel the server no longer has
 * leaves the list; any trouble ends the round, and the list shows what the
 * device has. An answer keeps its parcel's place in the list.
 *
 * Returns whether a parcel is still waiting for its first check, which is
 * worth another round soon.
 */
export async function refreshDeviceParcels(recents: readonly RecentParcel[], signal: AbortSignal, now: () => number = Date.now): Promise<boolean> {
  let unanswered = false;
  for (const recent of recents) {
    if (signal.aborted || (typeof navigator !== 'undefined' && navigator.onLine === false)) return false;
    const seen = Date.parse(recent.lastSeenAt) || 0;
    const fresh = waiting(recent) ? WAITING_FRESH_MS : recent.stage && isFinal(recent.stage) ? SETTLED_FRESH_MS : FRESH_MS;
    if (now() - Math.max(seen, checkedAt.get(recent.id) ?? 0) < fresh) {
      unanswered ||= waiting(recent);
      continue;
    }
    try {
      const read = await readParcelLink(recent.id, { key: recent.key, signal });
      if (signal.aborted) return false;
      checkedAt.set(recent.id, now());
      if (read === 'unavailable') forgetRecent(recent.id);
      else {
        rememberParcel({ id: recent.id, view: read, now: seen || now() });
        unanswered ||= waiting(read.parcel);
      }
    } catch {
      return false;
    }
  }
  return unanswered;
}

/**
 * Keeps a list of the device's parcels up to date while it is shown: one round
 * now, and a few more, further and further apart, while a parcel looked up a
 * moment ago still waits for its carrier. `parcels` is read at each round.
 * Returns the way to stop.
 */
export function watchDeviceParcels(parcels: () => readonly RecentParcel[]): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const round = async (rounds: number) => {
    const unanswered = await refreshDeviceParcels(parcels(), controller.signal);
    if (unanswered && rounds < FIRST_CHECK_ROUNDS && !controller.signal.aborted) {
      timer = setTimeout(() => void round(rounds + 1), FIRST_CHECK_MS * 1.5 ** rounds);
    }
  };
  void round(0);
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}

/**
 * Forgets the device's parcels: on the server where this device made the
 * lookup and holds its key, then on the device. Returns how many could not be
 * forgotten; those stay listed.
 */
export async function forgetDeviceParcels(recents: readonly RecentParcel[]): Promise<number> {
  let kept = 0;
  for (const recent of recents) {
    try {
      if (recent.key) await forgetParcelLink(recent.id, recent.key);
      forgetRecent(recent.id);
    } catch (error) {
      // A link the server no longer has is forgotten already.
      if (error instanceof ParcelLinkError && error.kind === 'unavailable') forgetRecent(recent.id);
      else kept += 1;
    }
  }
  if (!kept) forgetDeviceChecks();
  return kept;
}

/** Drops what the list remembers about its own checks: a device with nothing on it starts over. */
export function forgetDeviceChecks(): void {
  checkedAt.clear();
}
