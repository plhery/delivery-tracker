/**
 * Relay copies in a handed-over parcel's history.
 *
 * A carrier that hands a parcel over often goes on telling the new carrier's
 * scans in its own words, stamped within a minute of them and often without
 * the seconds: India Post tells La Poste's, DHL and Spring GDS tell Swiss
 * Post's, Chronopost tells DPD's. Both rows are stored and kept, because the
 * same rule would pair two distinct scans now and then. The parcel's timeline
 * serves the copy with `relay_of`, the id of the scan it repeats, and the apps
 * show it under that scan (eventPlaces.ts). Of the two rows, the one that
 * reached the parcel second announces nothing (push.ts).
 *
 * The earlier carrier also publishes some of its own scans late, after the
 * new carrier's later ones are stored (trackingSync.ts asks it again for a day
 * after the handoff). Those announce nothing either.
 */
import { isRecord, type JsonObject } from './types';

/** A copy is stamped within this of the scan it repeats, either way. */
const RELAY_WINDOW_MS = 60_000;

/** The carrier a parcel was handed over from, while another one tracks it; null for a parcel of one carrier. */
function earlierCarrier(row: JsonObject): string | null {
  const data = isRecord(row.carrier_data) ? row.carrier_data : {};
  const earlier = typeof data.original_carrier === 'string' ? data.original_carrier : '';
  const current = typeof data.active_tracking_carrier === 'string' ? data.active_tracking_carrier : String(row.carrier ?? '');
  return earlier && earlier !== current ? earlier : null;
}

/** Who stored a scan: the carrier its identity starts with (`unknown` for a universal provider, `app` for Peek's own rows). */
function source(event: JsonObject): string {
  return typeof event.provider_event_id === 'string' ? event.provider_event_id.split(':')[0]! : '';
}

/**
 * The earlier carrier's scans that repeat a scan of another source, each with
 * the id of the scan it repeats: the same stage, within a minute. The closest
 * pairs are made first and a scan is in one pair at most, so two scans of one
 * minute that the earlier carrier tells once stay two rows.
 */
export function relayCopies(row: JsonObject): Map<string, string> {
  const earlier = earlierCarrier(row);
  const pairs = new Map<string, string>();
  if (!earlier || !Array.isArray(row.tracking_events)) return pairs;
  const scans = row.tracking_events.filter(isRecord)
    .map((event) => ({ id: String(event.id), stage: event.stage, source: source(event), at: Date.parse(String(event.occurred_at)) }))
    .filter((scan) => Number.isFinite(scan.at) && scan.source !== '' && scan.source !== 'app');
  const candidates = scans.filter((copy) => copy.source === earlier).flatMap((copy) => scans
    .filter((scan) => scan.source !== earlier && scan.stage === copy.stage && Math.abs(scan.at - copy.at) <= RELAY_WINDOW_MS)
    .map((scan) => ({ copy, scan, gap: Math.abs(scan.at - copy.at) })));
  candidates.sort((a, b) => a.gap - b.gap || a.copy.at - b.copy.at
    || a.copy.id.localeCompare(b.copy.id) || a.scan.id.localeCompare(b.scan.id));
  const paired = new Set<string>();
  for (const { copy, scan } of candidates) {
    if (pairs.has(copy.id) || paired.has(scan.id)) continue;
    pairs.set(copy.id, scan.id);
    paired.add(scan.id);
  }
  return pairs;
}

/**
 * The rows of relay pairs that reached the parcel after the other one: their
 * news was the parcel's already. Of a pair stored by the same check, the copy.
 * The scans need their `created_at`.
 */
export function relayRepeats(row: JsonObject): Set<string> {
  const stored = new Map((Array.isArray(row.tracking_events) ? row.tracking_events.filter(isRecord) : [])
    .map((event) => [String(event.id), Date.parse(String(event.created_at))]));
  const repeats = new Set<string>();
  for (const [copy, scan] of relayCopies(row)) repeats.add(stored.get(copy)! < stored.get(scan)! ? scan : copy);
  return repeats;
}

/**
 * The earlier carrier's scans that reached the parcel after a later scan was
 * stored: older than news the parcel already had. Scans stored by one check
 * never make each other late. The scans need their `created_at`.
 */
export function lateScans(row: JsonObject): Set<string> {
  const earlier = earlierCarrier(row);
  if (!earlier || !Array.isArray(row.tracking_events)) return new Set();
  const scans = row.tracking_events.filter(isRecord)
    .map((event) => ({
      id: String(event.id), source: source(event),
      at: Date.parse(String(event.occurred_at)), stored: Date.parse(String(event.created_at)),
    }))
    .filter((scan) => Number.isFinite(scan.at) && Number.isFinite(scan.stored) && scan.source !== 'app');
  return new Set(scans.filter((scan) => scan.source === earlier
    && scans.some((other) => other.stored < scan.stored && other.at > scan.at)).map((scan) => scan.id));
}
