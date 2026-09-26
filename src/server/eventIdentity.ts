/**
 * Stored event identity when a source rewords its own scans.
 *
 * A stored event is keyed by `provider_event_id`: the source carrier and a hash
 * of the scan's time, place and wording strings (`providerEventId` in
 * trackingSync.ts). The sync upserts on it, so a scan whose strings change gets
 * a second row, and the push views announce that row again.
 *
 * DPD returns the same scans at the same instants in two shapes. Without the
 * delivery postcode (or after DPD rejects it) a scan reads "Delivered" with no
 * place; with it, "Your parcel has been delivered successfully" at "Urdorf, CH".
 * A source listed below may give such a scan the identity of the row already
 * stored at its instant. The upsert then updates that row in place: same row
 * id, `created_at` and push receipts, so nothing is copied or announced twice.
 * Such a row's identity no longer hashes its own strings (and a universal
 * row's prefix no longer names the source that worded it), so a repair that
 * finds rows by recomputing identities from their strings misses it.
 */
import type { JsonObject } from './types';

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
