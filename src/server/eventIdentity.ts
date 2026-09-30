/**
 * Stored event identity when a scan reaches the parcel more than once.
 *
 * A stored event is keyed by `provider_event_id`: the source carrier and a hash
 * of the scan's time, place and wording strings (`providerEventId` in
 * trackingSync.ts). The sync upserts on it, so a scan whose strings change gets
 * a second row, and the push views announce that row again.
 *
 * A new scan may instead take over a stored row: it gets that row's identity,
 * and the upsert updates the row in place (same row id, `created_at` and push
 * receipts), so nothing is copied or announced twice. Such a row's identity no
 * longer hashes its own strings (and a universal row's prefix no longer names
 * the source that worded it), so a repair that finds rows by recomputing
 * identities from their strings misses it.
 *
 * - DPD returns the same scans at the same instants in two shapes. Without the
 *   delivery postcode (or after DPD rejects it) a scan reads "Delivered" with no
 *   place; with it, "Your parcel has been delivered successfully" at "Urdorf,
 *   CH". Its scan takes over the row stored at its instant
 *   (`sameInstantIdentities`).
 * - A universal provider copies a carrier's scans while the carrier's own
 *   lookup is down, sometimes in a zone it misread (Ship24 keeps GOFO's Pacific
 *   offset on Eastern clocks). A universal copy of a stored scan is left out of
 *   the batch, and a carrier's scan takes over the universal copy stored while
 *   it was down (`sharedScans`).
 */
import { isRecord, type JsonObject } from './types';

/**
 * The sources that opt in, each with the stored identity prefixes its scans
 * may take over. `unknown:` rows are a universal provider's copy of the same
 * scans. Never another carrier's prefix.
 *
 * A universal reply is not listed. When DPD takes over a universal row, the
 * row keeps its `unknown:` identity. The next universal reply finds that
 * identity already stored and rewrites the row in place with its own wording,
 * and the next DPD reply takes it back again. The row's wording follows
 * whichever source answered last, but the scan is stored and announced once.
 */
const SAME_INSTANT_SOURCES: Readonly<Record<string, readonly string[]>> = {
  dpd: ['dpd:', 'unknown:'],
};

function identity(row: JsonObject): string {
  return typeof row.provider_event_id === 'string' ? row.provider_event_id : '';
}

function byInstant(rows: readonly JsonObject[]): Map<number, JsonObject[]> {
  const grouped = new Map<number, JsonObject[]>();
  for (const row of rows) {
    const instant = Date.parse(String(row.occurred_at ?? ''));
    if (!Number.isFinite(instant)) continue;
    grouped.set(instant, [...(grouped.get(instant) ?? []), row]);
  }
  return grouped;
}

/**
 * Maps the computed identity of each new scan that should update a stored row
 * in place to that row's identity. Empty unless `sourceCarrierId` opted in.
 *
 * Only a scan from `sourceCarrierId` whose own identity is not stored yet is
 * considered. It takes over a stored row at the exact same instant whose
 * identity has an allowed prefix and is not carried by any event of this
 * batch, and only when that row is the only such candidate and the scan is
 * the only such new scan at the instant. Anything else is ambiguous: nothing
 * is reused and the scan is inserted as before.
 */
export function sameInstantIdentities(
  events: readonly JsonObject[],
  stored: readonly JsonObject[],
  sourceCarrierId: string,
): Map<string, string> {
  const reused = new Map<string, string>();
  const prefixes = SAME_INSTANT_SOURCES[sourceCarrierId];
  if (!prefixes || stored.length === 0) return reused;
  const storedIds = new Set(stored.map(identity));
  const claimed = new Set(events.map(identity));
  const unmatched = byInstant(events.filter((event) => (
    identity(event).startsWith(`${sourceCarrierId}:`) && !storedIds.has(identity(event))
  )));
  const candidates = byInstant(stored.filter((row) => (
    prefixes.some((prefix) => identity(row).startsWith(prefix)) && !claimed.has(identity(row))
  )));
  for (const [instant, scans] of unmatched) {
    const rows = candidates.get(instant) ?? [];
    if (scans.length === 1 && rows.length === 1) reused.set(identity(scans[0]!), identity(rows[0]!));
  }
  return reused;
}

const UNIVERSAL = 'unknown';
const QUARTER_HOUR_MS = 15 * 60 * 1_000;
const MAX_ZONE_SHIFT_MS = 14 * 60 * 60 * 1_000;

function sourceOf(id: string): string {
  const separator = id.indexOf(':');
  return separator > 0 ? id.slice(0, separator) : '';
}

function instantOf(row: JsonObject): number {
  return Date.parse(String(row.occurred_at ?? ''));
}

function wordingOf(row: JsonObject): string {
  return String(row.description ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

function stageOf(row: JsonObject): string {
  return typeof row.stage === 'string' ? row.stage : '';
}

/** The same wording, or one followed by a further sentence (GOFO's support line). */
function sameWording(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  return /[.!?]$/.test(shorter) && longer.startsWith(`${shorter} `);
}

export interface SharedScans {
  /** A carrier scan's computed identity → the universal copy it takes over in place. */
  reused: Map<string, string>;
  /** A universal scan left out of the batch → the stored identity it repeats. */
  skipped: Map<string, string>;
}

/**
 * Keeps one row per scan when a carrier and a universal provider report it.
 *
 * Only scans whose own identity is not stored are matched, against stored rows
 * that no event of this batch carries and `reused` has not taken, never the
 * app's own rows, and never a scan the sync observed without a provider time.
 * A row matches a scan at the exact same instant when it is the only row there
 * with the same wording, or the only row there at all, with the same stage,
 * and the scan the only new scan there. With no row at that instant, a row
 * matches at a whole number of quarter hours up to 14 h away with the same
 * wording: the same scan read in the wrong zone. A row that two scans match is
 * ambiguous and stays unmatched.
 *
 * A carrier's scan takes over the universal row it matches. A universal scan
 * that matches any row is left out, and so is one whose own identity is stored
 * at another instant: a carrier's scan has taken that row over and corrected
 * its time. At the same instant a universal scan still rewrites its own row,
 * so a row DPD took over follows whichever source answered last.
 */
export function sharedScans(
  events: readonly JsonObject[],
  stored: readonly JsonObject[],
  reused: ReadonlyMap<string, string> = new Map(),
): SharedScans {
  const shared: SharedScans = { reused: new Map(), skipped: new Map() };
  if (stored.length === 0) return shared;
  const storedById = new Map(stored.map((row) => [identity(row), row] as const));
  const taken = new Set([...events.map(identity), ...reused.values()]);
  const rows = stored.filter((row) => {
    const source = sourceOf(identity(row));
    return source !== '' && source !== 'app' && !taken.has(identity(row)) && Number.isFinite(instantOf(row));
  });
  const pending: JsonObject[] = [];
  for (const event of events) {
    const id = identity(event);
    const source = sourceOf(id);
    const observed = isRecord(event.raw_data) && event.raw_data.observed_without_provider_timestamp === true;
    if (source === '' || source === 'app' || reused.has(id) || observed || !Number.isFinite(instantOf(event))) continue;
    const own = storedById.get(id);
    if (!own) pending.push(event);
    else if (source === UNIVERSAL && instantOf(own) !== instantOf(event)) shared.skipped.set(id, id);
  }
  const newAt = new Map<number, number>();
  for (const event of pending) newAt.set(instantOf(event), (newAt.get(instantOf(event)) ?? 0) + 1);
  const picks = new Map<string, JsonObject[]>();
  for (const event of pending) {
    const universal = sourceOf(identity(event)) === UNIVERSAL;
    const at = instantOf(event);
    const wording = wordingOf(event);
    const eligible = universal ? rows : rows.filter((row) => sourceOf(identity(row)) === UNIVERSAL);
    const exact = eligible.filter((row) => instantOf(row) === at);
    const worded = exact.filter((row) => sameWording(wordingOf(row), wording));
    const shifted = exact.length ? [] : eligible.filter((row) => {
      const shift = at - instantOf(row);
      return shift % QUARTER_HOUR_MS === 0 && Math.abs(shift) <= MAX_ZONE_SHIFT_MS && sameWording(wordingOf(row), wording);
    });
    const staged = exact.length === 1 && newAt.get(at) === 1 && stageOf(event) !== '' && stageOf(exact[0]!) === stageOf(event);
    const match = worded.length === 1 ? worded[0]
      : worded.length === 0 && staged ? exact[0]
        : shifted.length === 1 ? shifted[0] : undefined;
    if (match) picks.set(identity(match), [...(picks.get(identity(match)) ?? []), event]);
  }
  for (const [rowId, scans] of picks) {
    if (scans.length !== 1) continue;
    const id = identity(scans[0]!);
    if (sourceOf(id) === UNIVERSAL) shared.skipped.set(id, rowId);
    else shared.reused.set(id, rowId);
  }
  return shared;
}

/** The events as persisted: a reused identity replaces the computed one. */
export function withIdentities(
  events: readonly JsonObject[],
  identities: ReadonlyMap<string, string>,
): JsonObject[] {
  return events.map((event) => {
    const reused = identities.get(identity(event));
    return reused ? { ...event, provider_event_id: reused } : event;
  });
}
