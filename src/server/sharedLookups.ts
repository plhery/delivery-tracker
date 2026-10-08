import 'server-only';
import { normalizeTrackingNumber } from '../lib/carriers';
import { normalizedLookupCountry } from './lookupCountry';
import { isRecord, type JsonObject } from './types';

/**
 * Routing that describes the number rather than the parcel: which provider
 * answers it, cooldowns, the carrier recognised or confirmed for it and what
 * its carriers still need. The parcel keeps its own carrier choice, check
 * streak, freshness watermark and next check.
 */
const NUMBER_ROUTING = ['preferred_provider', 'preferred_number', 'confirmed_carrier', 'confirmed_number',
  'confirmed_tracking_url', 'confirmed_postcode', 'discovered_carrier', 'direct_retry_at', 'last_probe_at',
  'candidate_probes', 'input_needed', 'provider_input_needed', 'probe_cursor', 'discovery_cursor', 'failures',
  'reported_carriers_seen'];
/** When a delivery partner of the number was last asked. */
const NUMBER_DATA = ['delivery_probe', 'swiss_post_probe'];

const text = (value: unknown): string | null => typeof value === 'string' && value ? value : null;
const number = (value: unknown): string => normalizeTrackingNumber(String(value ?? ''));

/**
 * Everything a check of the parcel sends upstream: its carrier, number,
 * inputs, delivery leg and lookup country. Copies with the same identity make
 * the same lookups. None when the parcel's routing still holds the inputs of
 * an earlier configuration, which another copy must never receive.
 */
function lookupIdentity(parcel: JsonObject): string | null {
  const data = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
  const routing = isRecord(data.routing) ? data.routing : {};
  const url = text(parcel.tracking_url);
  const postcode = text(parcel.dpd_postcode);
  if (![null, url].includes(text(routing.confirmed_tracking_url))
    || ![null, postcode].includes(text(routing.confirmed_postcode))) return null;
  const input = isRecord(data.universal_input) ? [text(data.universal_input.number), text(data.universal_input.postcode)] : null;
  return JSON.stringify([String(parcel.carrier ?? ''), number(parcel.tracking_number), url, postcode, input,
    text(data.original_carrier), text(data.active_tracking_carrier), text(data.active_tracking_number),
    data.swiss_post_ready === true, normalizedLookupCountry(data.lookup_country_hint)]);
}

function pick(source: JsonObject, keys: readonly string[]): JsonObject {
  return structuredClone(Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])));
}

/**
 * The lookups of one scheduled run. Several accounts, or a lookup without
 * one, can follow the same number: each copy is checked and saved on its own,
 * but the copies share every carrier and provider answer, keyed by what was
 * sent upstream, and the routing of the copy checked last before the run.
 * Only what the lookup sent and the answers it got are shared, never a
 * parcel's name, notes or other inputs.
 */
export class SharedLookups {
  readonly #answers = new Map<string, Promise<unknown>>();
  readonly #routing = new Map<string, { routing: JsonObject; data: JsonObject }>();

  constructor(parcels: readonly JsonObject[] = []) {
    const copies = new Map<string, JsonObject[]>();
    for (const parcel of parcels) {
      const identity = lookupIdentity(parcel);
      if (identity) copies.set(identity, [...copies.get(identity) ?? [], parcel]);
    }
    for (const [identity, group] of copies) {
      if (group.length < 2) continue;
      const synced = (parcel: JsonObject) => Date.parse(String(parcel.last_synced_at ?? '')) || 0;
      const latest = group.reduce((best, parcel) => synced(parcel) > synced(best) ? parcel : best);
      const data = isRecord(latest.carrier_data) ? latest.carrier_data : {};
      const routing = isRecord(data.routing) && data.routing.version === 1 ? data.routing : {};
      this.#routing.set(identity, { routing: pick(routing, NUMBER_ROUTING), data: pick(data, NUMBER_DATA) });
    }
  }

  /** The lookups of one parcel's check. */
  for(parcel: JsonObject): ParcelLookups {
    const identity = lookupIdentity(parcel);
    const shared = identity ? this.#routing.get(identity) : undefined;
    return new ParcelLookups(this.#answers, shared ? follow(parcel, shared) : parcel);
  }
}

/**
 * The parcel as its check sees it: the number's shared routing in place of
 * its own, its own carrier choice, streak, watermark and next check kept.
 */
function follow(parcel: JsonObject, shared: { routing: JsonObject; data: JsonObject }): JsonObject {
  const data = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
  const own = isRecord(data.routing) && data.routing.version === 1 ? data.routing : {};
  const routing: JsonObject = { ...own, version: 1, configured_carrier: own.configured_carrier ?? parcel.carrier };
  for (const key of NUMBER_ROUTING) delete routing[key];
  const followed: JsonObject = { ...data };
  for (const key of NUMBER_DATA) delete followed[key];
  return { ...parcel, carrier_data: { ...followed, ...structuredClone(shared.data),
    routing: { ...routing, ...structuredClone(shared.routing) } } };
}

export class ParcelLookups {
  /** Answers this check took from another copy's lookup instead of asking again. */
  shared = 0;

  constructor(private readonly answers: Map<string, Promise<unknown>>, readonly parcel: JsonObject) {}

  /** The answer another check of this run already got or awaits for the key: a copy of it, or the same failure. */
  reuse<T>(key: readonly unknown[]): Promise<T> | undefined {
    const answer = this.answers.get(JSON.stringify(key)) as Promise<T> | undefined;
    if (!answer) return undefined;
    this.shared++;
    return answer.then((value) => structuredClone(value));
  }

  /** One upstream call per key and run. */
  async once<T>(key: readonly unknown[], fetch: () => Promise<T>): Promise<T> {
    const reused = this.reuse<T>(key);
    if (reused) return await reused;
    const answer = (async () => await fetch())();
    this.answers.set(JSON.stringify(key), answer);
    // A failure belongs to each check that awaits it, not to the cache.
    answer.catch(() => undefined);
    return structuredClone(await answer);
  }
}

/** What a carrier lookup sends: the carrier, the number and the user's inputs for it. */
export function carrierLookupKey(carrier: string, trackingNumber: string, trackingUrl: string | null, postcode?: string | null): unknown[] {
  return ['carrier', carrier, number(trackingNumber), text(trackingUrl), text(postcode)];
}

/** What a universal provider lookup sends. */
export function universalLookupKey(source: string, trackingNumber: string, postcode: string | null, timezone: string | null): unknown[] {
  return ['universal', source, number(trackingNumber), text(postcode), text(timezone)];
}

/** A carrier's check of whether it knows a number, over HTTP or in a browser. */
export function recognitionKey(kind: 'http' | 'browser', carrier: string, trackingNumber: string): unknown[] {
  return ['recognition', kind, carrier, number(trackingNumber)];
}
