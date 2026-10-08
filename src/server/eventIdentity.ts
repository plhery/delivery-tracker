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
 * - The scraper opts sources into same-instant matching and declares whether
 *   their provider codes or other scan evidence must agree. A unique matching
 *   scan takes over the stored row at its instant (`sameInstantIdentities`).
 *   A policy that names the zone its source once read every wall clock in
 *   lets a scan whose wall clock now carries its own offset take over the row
 *   stored under the old label (India Post's scans abroad).
 * - A universal provider copies a carrier's scans while the carrier's own
 *   lookup is down, sometimes in a zone it misread (Ship24 keeps GOFO's Pacific
 *   offset on Eastern clocks), sometimes in its own wording as well (ParcelsApp
 *   put Paack's scans two hours early). A universal copy of a stored scan is
 *   left out of the batch, and a carrier's scan takes over the universal copy
 *   stored while it was down (`sharedScans`).
 */
import { DateTime } from 'luxon';
import { sameInstantIdentityPolicy, type SameInstantIdentityPolicy, type SameInstantScan } from 'universal-parcel-scraper/app';
import { isRecord, type JsonObject } from './types';

function providerCode(row: JsonObject): string {
  const code = row.provider_code ?? (isRecord(row.raw_data) ? row.raw_data.provider_code : undefined);
  return typeof code === 'string' ? code : '';
}

function scanEvidence(row: JsonObject): SameInstantScan {
  return {
    stage: typeof row.stage === 'string' ? row.stage : '',
    description: typeof row.description === 'string' ? row.description : '',
    location: typeof row.location === 'string' ? row.location : '',
    providerCode: providerCode(row),
  };
}

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
 * batch. The scan and stored row must match uniquely in both directions.
 * A required provider code can distinguish scans sharing an instant. Sources
 * without required codes or a per-scan evidence matcher still require exactly
 * one new scan and one candidate there. Ambiguous scans are inserted as before.
 *
 * A policy's `relabelledFrom` zone adds a second pass for the scans and rows
 * left, matched by `relabelled`.
 */
export function sameInstantIdentities(
  events: readonly JsonObject[],
  stored: readonly JsonObject[],
  sourceCarrierId: string,
): Map<string, string> {
  const reused = new Map<string, string>();
  const policy = sameInstantIdentityPolicy(sourceCarrierId, { supportsScanMatching: true });
  if (!policy || stored.length === 0) return reused;
  const prefixes = policy.storedSources.map((source) => `${source}:`);
  const storedIds = new Set(stored.map(identity));
  const claimed = new Set(events.map(identity));
  const unmatched = byInstant(events.filter((event) => (
    identity(event).startsWith(`${sourceCarrierId}:`) && !storedIds.has(identity(event)) && !observedOnly(event)
  )));
  const candidates = byInstant(stored.filter((row) => (
    prefixes.some((prefix) => identity(row).startsWith(prefix)) && !claimed.has(identity(row)) && !observedOnly(row)
  )));
  const matchEach = policy.requireProviderCode || (policy.matchEachScan === true && policy.matches !== undefined);
  for (const [instant, scans] of unmatched) {
    const rows = candidates.get(instant) ?? [];
    if (!matchEach && (scans.length !== 1 || rows.length !== 1)) continue;
    const matches = (scan: JsonObject, row: JsonObject) => {
      const code = providerCode(scan);
      if (policy.requireProviderCode && (!code || code.toLowerCase() === 'unknown' || code !== providerCode(row))) return false;
      return !policy.matches || policy.matches(scanEvidence(scan), scanEvidence(row));
    };
    for (const scan of scans) {
      const matching = rows.filter((row) => matches(scan, row));
      if (matching.length !== 1) continue;
      const saved = matching[0]!;
      if (scans.filter((other) => matches(other, saved)).length !== 1) continue;
      reused.set(identity(scan), identity(saved));
    }
  }
  const zone = relabelledFrom(policy);
  if (!zone) return reused;
  const taken = new Set(reused.values());
  const scans = [...unmatched.values()].flat().filter((scan) => !reused.has(identity(scan)));
  const rows = [...candidates.values()].flat().filter((row) => !taken.has(identity(row)));
  for (const scan of scans) {
    const matching = rows.filter((row) => relabelled(zone, scan, row));
    if (matching.length !== 1) continue;
    const saved = matching[0]!;
    if (scans.filter((other) => relabelled(zone, other, saved)).length !== 1) continue;
    reused.set(identity(scan), identity(saved));
  }
  return reused;
}

/** The zone a policy's source once read every wall clock in. Policies from scraper releases before the field name none. */
function relabelledFrom(policy: SameInstantIdentityPolicy): string | null {
  const zone = (policy as { relabelledFrom?: unknown }).relabelledFrom;
  return typeof zone === 'string' && DateTime.now().setZone(zone).isValid ? zone : null;
}

const WALL_CLOCK = "yyyy-LL-dd'T'HH:mm:ss";
const NUMERIC_OFFSET = /[+-]\d{2}:?\d{2}$/;

function timeOf(row: JsonObject): string {
  const time = row.time ?? (isRecord(row.raw_data) ? row.raw_data.time : undefined);
  return typeof time === 'string' ? time : '';
}

/** The wall clock a row's time shows under an offset of its own: not UTC's label, nor the zone's. */
function ownWallClock(zone: string, row: JsonObject): string | null {
  const time = timeOf(row);
  if (!NUMERIC_OFFSET.test(time)) return null;
  const shown = DateTime.fromISO(time, { setZone: true });
  if (!shown.isValid || shown.offset === shown.setZone(zone).offset) return null;
  return shown.toFormat(WALL_CLOCK);
}

/** The wall clock the zone shows at a row's instant, for a row labelled in it. */
function zoneWallClock(zone: string, row: JsonObject): string | null {
  const instant = instantOf(row);
  if (!Number.isFinite(instant) || ownWallClock(zone, row) !== null) return null;
  return DateTime.fromMillis(instant, { zone }).toFormat(WALL_CLOCK);
}

/**
 * One scan read on two clocks: one row shows a wall clock under an offset of
 * its own, the other carries the same wall clock under the zone's label. The
 * provider code must agree, and the location too; wording may differ.
 */
function relabelled(zone: string, scan: JsonObject, row: JsonObject): boolean {
  const code = providerCode(scan);
  if (!code || code.toLowerCase() === 'unknown' || code !== providerCode(row)) return false;
  if (String(scan.location ?? '').trim() !== String(row.location ?? '').trim()) return false;
  const shown = ownWallClock(zone, scan);
  const saved = ownWallClock(zone, row);
  return (shown !== null && shown === zoneWallClock(zone, row)) || (saved !== null && saved === zoneWallClock(zone, scan));
}

const UNIVERSAL = 'unknown';
const QUARTER_HOUR_MS = 15 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const MAX_ZONE_SHIFT_MS = 14 * HOUR_MS;

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

/** A stage change the sync stamped with the time it saw it, not a provider scan. */
function observedOnly(row: JsonObject): boolean {
  return row.observed_without_provider_timestamp === true
    || (isRecord(row.raw_data) && row.raw_data.observed_without_provider_timestamp === true);
}

/** The same wording, or one followed by a further sentence (GOFO's support line). */
function sameWording(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  return /[.!?]$/.test(shorter) && longer.startsWith(`${shorter} `);
}

/** Stages that can name one scan: the same, or one source left it unclassified. */
function stagesAgree(left: string, right: string): boolean {
  return left === right || [left, right].some((stage) => stage === '' || stage === 'pending');
}

export interface SharedScans {
  /** A carrier scan's computed identity → the universal copy it takes over in place. */
  reused: Map<string, string>;
  /** A universal scan left out of the batch → the stored identity it repeats. */
  skipped: Map<string, string>;
  /** The scans of `reused` and `skipped` whose row stands at another instant: one source's clock is off. */
  shifted: Set<string>;
}

/**
 * Keeps one row per scan when a carrier and a universal provider report it.
 *
 * Only scans whose own identity is not stored are matched, against stored rows
 * that no event of this batch carries and `reused` has not taken, never the
 * app's own rows, and never a scan the sync observed without a provider time.
 * A row matches a scan at the exact same instant when it is the only row there
 * with the same wording, or the only row there at all, with the same stage,
 * and the scan the only new scan there. With no row at that instant, a row a
 * whole number of quarter hours up to 14 h away, at an instant no scan of the
 * batch shows, matches with the same wording: the same scan read in the wrong
 * zone. Failing that, a carrier's row for a universal scan, or a universal row
 * for a carrier's scan, at least an hour away matches in any wording when the
 * stages agree or one is pending and the time has seconds other than zero: a
 * provider whose clock is off by a zone's offset from UTC. Times to the minute
 * fall whole quarter hours apart too often by chance, and carriers stamp some
 * scans 15 or 30 minutes after another to the second (Swiss Post sorts a
 * parcel a quarter hour after customs clear it). A row that two scans match is
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
  const shared: SharedScans = { reused: new Map(), skipped: new Map(), shifted: new Set() };
  if (stored.length === 0) return shared;
  const storedById = new Map(stored.map((row) => [identity(row), row] as const));
  const taken = new Set([...events.map(identity), ...reused.values()]);
  const rows = stored.filter((row) => {
    const source = sourceOf(identity(row));
    return source !== '' && source !== 'app' && !taken.has(identity(row)) && !observedOnly(row)
      && Number.isFinite(instantOf(row));
  });
  const pending: JsonObject[] = [];
  for (const event of events) {
    const id = identity(event);
    const source = sourceOf(id);
    if (source === '' || source === 'app' || reused.has(id) || observedOnly(event) || !Number.isFinite(instantOf(event))) continue;
    const own = storedById.get(id);
    if (!own) pending.push(event);
    else if (source === UNIVERSAL && instantOf(own) !== instantOf(event)) {
      shared.skipped.set(id, id);
      shared.shifted.add(id);
    }
  }
  const newAt = new Map<number, number>();
  for (const event of pending) newAt.set(instantOf(event), (newAt.get(instantOf(event)) ?? 0) + 1);
  const occupied = new Set(rows.map(instantOf));
  // A row the batch shows at its own instant is that scan's, not a shifted copy's.
  const shown = new Set(events.map(instantOf));
  const picks = new Map<string, JsonObject[]>();
  for (const event of pending) {
    const universal = sourceOf(identity(event)) === UNIVERSAL;
    const at = instantOf(event);
    const wording = wordingOf(event);
    const eligible = universal ? rows : rows.filter((row) => sourceOf(identity(row)) === UNIVERSAL);
    const exact = eligible.filter((row) => instantOf(row) === at);
    const worded = exact.filter((row) => sameWording(wordingOf(row), wording));
    const zoned = occupied.has(at) ? [] : eligible.filter((row) => {
      const shift = at - instantOf(row);
      return shift % QUARTER_HOUR_MS === 0 && Math.abs(shift) <= MAX_ZONE_SHIFT_MS && !shown.has(instantOf(row));
    });
    const shifted = zoned.filter((row) => sameWording(wordingOf(row), wording));
    const reclocked = Math.floor(at / 1_000) % 60 === 0 ? [] : zoned.filter((row) => (
      (sourceOf(identity(row)) === UNIVERSAL) !== universal && Math.abs(at - instantOf(row)) >= HOUR_MS
      && stagesAgree(stageOf(row), stageOf(event))
    ));
    const staged = exact.length === 1 && newAt.get(at) === 1 && stageOf(event) !== '' && stageOf(exact[0]!) === stageOf(event);
    const match = worded.length === 1 ? worded[0]
      : worded.length === 0 && staged ? exact[0]
        : shifted.length === 1 ? shifted[0]
          : shifted.length === 0 && reclocked.length === 1 ? reclocked[0] : undefined;
    if (match) picks.set(identity(match), [...(picks.get(identity(match)) ?? []), event]);
  }
  for (const [rowId, scans] of picks) {
    if (scans.length !== 1) continue;
    const id = identity(scans[0]!);
    if (sourceOf(id) === UNIVERSAL) shared.skipped.set(id, rowId);
    else shared.reused.set(id, rowId);
    if (instantOf(scans[0]!) !== instantOf(storedById.get(rowId)!)) shared.shifted.add(id);
  }
  return shared;
}

/**
 * A newest-event time (the routing watermark, a result's summary time) that
 * universal copies read in the wrong zone may have set hours late. A skipped
 * copy counts at its stored twin's instant, and a stored copy a carrier's scan
 * takes over at that scan's instant. The time drops to the newest instant left
 * only when it is later than that and no later than the newest instant a copy
 * claimed, so the copies explain the excess (the router caps a future-dated
 * copy at the time of the check); a time they do not explain stands. The batch
 * always counts, `stored` rows only with `withStored`, and `also` adds instants
 * the batch rows do not carry.
 */
export function withoutCopyDrift(
  time: number,
  events: readonly JsonObject[],
  stored: readonly JsonObject[],
  matches: { reused: ReadonlyMap<string, string>; skipped: ReadonlyMap<string, string> },
  options: { withStored?: boolean; also?: readonly number[] } = {},
): number {
  if (!Number.isFinite(time)) return time;
  const storedById = new Map(stored.map((row) => [identity(row), row] as const));
  const claimed: number[] = [];
  const retimed = new Map<string, number>();
  const kept: number[] = [...(options.also ?? [])];
  for (const event of events) {
    if (observedOnly(event)) continue;
    const takenOver = storedById.get(matches.reused.get(identity(event)) ?? '');
    if (takenOver) {
      claimed.push(instantOf(takenOver));
      retimed.set(identity(takenOver), instantOf(event));
    }
    const twin = storedById.get(matches.skipped.get(identity(event)) ?? '');
    if (twin) claimed.push(instantOf(event));
    kept.push(instantOf(twin ?? event));
  }
  if (options.withStored) for (const row of stored) kept.push(retimed.get(identity(row)) ?? instantOf(row));
  const newest = Math.max(...kept.filter(Number.isFinite));
  const claimedNewest = Math.max(...claimed.filter(Number.isFinite));
  return Number.isFinite(newest) && time > newest && time <= claimedNewest ? newest : time;
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
