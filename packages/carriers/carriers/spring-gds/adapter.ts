import 'server-only';

/**
 * PostNL international tracking (carrier id `spring-gds`).
 *
 * The folder keeps the historical `spring-gds` id for parcels and clients that
 * already store it; the carrier is presented as PostNL everywhere else. Spring
 * GDS is PostNL's international subsidiary and its mailingtechnology.com
 * portal shows the same barcode (see this folder's README).
 *
 * `postnl.post` hands out a short-lived visitor token to anyone who asks, then
 * accepts a batch tracking request with it. Both calls replay once after a
 * transport failure or an HTTP 502/503/504, and an HTTP 429 only when it
 * supplies a short, valid `Retry-After`.
 *
 * The response echoes the requested barcodes, so the item whose `item` equals
 * the requested number is the only one read. PostNL answers an unknown barcode
 * with an ordinary item that has no events and says so in `message`.
 */
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { DateTime } from 'luxon';
import { IndeterminateError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { countryTimeZone, mislabeledWallTime } from '../../core/time';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { postNLStatus } from './status';

const PROVIDER = 'PostNL';
const TOKEN_URL = 'https://postnl.post/api/v1/auth/token';
const TRACK_URL = 'https://postnl.post/api/v1/tracking-items';
const TOKEN_TIMEOUT_MS = 10_000;
const TRACK_TIMEOUT_MS = 15_000;
const LOOKUP_TIMEOUT_MS = 25_000;
const MAX_TOKEN_LENGTH = 16_384;
const NOT_FOUND_MESSAGE = /barcode was not found/i;
const BASE_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (compatible; SwissDeliveryTracker/1.0)',
};
const SITE_HEADERS = {
  ...BASE_HEADERS,
  'Content-Type': 'application/json',
  Origin: 'https://postnl.post',
  Referer: 'https://postnl.post/',
};

function record(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function recordArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function comparableIdentifier(value: unknown): string {
  return text(value).trim().toLocaleUpperCase('en-US');
}

/**
 * `datetime_local` is the scan's local time although PostNL appends "Z": a
 * Swiss scan at 09:15 local arrives as "09:15Z". Each event names its
 * country; unresolved clocks stay separate from scan instants.
 */
function eventTime(event: JsonObject): { time?: string; local_time?: string; provider_time_text?: string } {
  const raw = text(event.datetime_local).trim().slice(0, 64);
  if (!raw) return {};
  // The observed local-clock quirk uses Z. An unexpected nonzero offset
  // cannot be converted to UTC digits and assigned a second country offset.
  const wall = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]00:?00)?$/.test(raw) ? mislabeledWallTime(raw) : null;
  if (!wall) return { provider_time_text: raw };
  const country = text(event.country_code).trim();
  const zone = country ? countryTimeZone(country) : countryTimeZone(text(event.country_name));
  // A country alone cannot distinguish mainland clocks from island clocks.
  if (zone && !['Europe/Madrid', 'Europe/Lisbon'].includes(zone)) {
    const parsed = DateTime.fromISO(wall, { zone });
    // Reject DST gap shifts and repeated clocks rather than choosing an offset.
    if (parsed.isValid && parsed.toISO({ includeOffset: false }) === wall && parsed.getPossibleOffsets().length === 1) {
      const time = parsed.toISO({ suppressMilliseconds: true });
      if (time) return { time };
    }
  }
  return { local_time: wall.replace(/\.000$/, '') };
}

/** Projects one `tracking-items` payload. Pure: the offline tests target this. */
export function parsePostNLTrackingResponse(value: unknown, trackingNumber: string): CarrierResult {
  const payload = record(value);
  const rawItems = record(payload.data).items;
  if (!Array.isArray(rawItems)) {
    throw new SchemaError(PROVIDER, 'PostNL returned an invalid tracking response');
  }
  const items = recordArray(rawItems);
  if (items.length !== rawItems.length) {
    throw new SchemaError(PROVIDER, 'PostNL returned an invalid shipment entry');
  }
  if (items.length === 0) throw new SchemaError(PROVIDER, 'PostNL did not return a shipment entry');
  const requested = comparableIdentifier(trackingNumber);
  const identified = items.filter((candidate) => comparableIdentifier(candidate.item));
  if (identified.length === 0) {
    throw new SchemaError(PROVIDER, 'PostNL did not return a shipment identifier');
  }
  const matches = identified.filter((candidate) => comparableIdentifier(candidate.item) === requested);
  if (matches.length !== 1) throw new SchemaError(PROVIDER, 'PostNL returned a different or ambiguous shipment');
  const item = matches[0]!;
  if (!Array.isArray(item.events)) {
    throw new SchemaError(PROVIDER, 'PostNL returned invalid tracking history');
  }
  const rawEvents = recordArray(item.events);
  if (rawEvents.length !== item.events.length) {
    throw new SchemaError(PROVIDER, 'PostNL returned an invalid tracking event');
  }
  if (rawEvents.length > 500) throw new SchemaError(PROVIDER, 'PostNL returned excessive tracking history');
  if (rawEvents.length === 0 && NOT_FOUND_MESSAGE.test(text(item.message))) {
    // The rest of `message` can carry provider prose; only the recognized
    // phrase is used, and none of it reaches the error.
    throw new NotFoundError(PROVIDER);
  }
  if (rawEvents.length === 0) throw new IndeterminateError(PROVIDER);
  const events = rawEvents.slice(0, 100).map((event): CarrierEvent => {
    const classified = postNLStatus(event.category, event.status_description);
    return {
      ...eventTime(event),
      location: (text(event.country_name) || text(event.country_code)).slice(0, 200),
      description: (text(event.status_description) || text(event.category)).slice(0, 500),
      ...(classified ? { stage: classified.stage } : {}),
    };
  });
  const latest = rawEvents[0] ?? {};
  const category = text(latest.category);
  const classified = postNLStatus(category, latest.status_description);
  // Webshop or business name only; PostNL does not expose the recipient here.
  const senderName = text(item.senderName ?? item.sender ?? item.title).replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const deliveredAt = classified?.status === 'delivered' ? events[0]?.time : null;
  const destination = text(item.destination_code).trim().toUpperCase();
  return {
    status: classified?.status ?? 'unknown',
    ...(classified ? { current_stage: classified.stage } : {}),
    last_status_text: (text(latest.status_description) || category).slice(0, 500),
    last_update: events[0]?.time || null,
    ...(events[0]?.local_time ? { last_update_local: events[0].local_time } : {}),
    expected_delivery: null,
    ...(senderName ? { sender_name: senderName } : {}),
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}),
    ...(/^[A-Z]{2}$/.test(destination) ? { destination_country: destination } : {}),
    events,
  };
}

export class PostNLTracker {
  private readonly fetcher: typeof fetch | undefined;

  constructor(options: { fetcher?: typeof fetch } = {}) {
    this.fetcher = options.fetcher;
  }

  /** A fresh visitor token per lookup: it is short-lived and keyless. */
  private async visitorToken(signal: AbortSignal): Promise<string> {
    const { bytes } = await fetchBounded(
      TOKEN_URL,
      { method: 'POST', headers: SITE_HEADERS, body: '{}', signal },
      {
        provider: 'PostNL authentication',
        timeoutMs: TOKEN_TIMEOUT_MS,
        maxBytes: 50_000,
        retryTransient: true,
        fetcher: this.fetcher,
      },
    );
    const accessToken = text(record(parseJsonBytes(bytes, 'PostNL authentication')).access_token);
    if (!accessToken || accessToken.length > MAX_TOKEN_LENGTH) {
      throw new SchemaError(PROVIDER, 'PostNL returned an invalid visitor token');
    }
    return accessToken;
  }

  async fetch(trackingNumber: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const budget = context.budgetMs ?? LOOKUP_TIMEOUT_MS;
    if (!Number.isFinite(budget) || budget <= 0) throw new TypeError('PostNL timeout must be positive');
    context.signal?.throwIfAborted();
    const signal = AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.floor(budget))), ...(context.signal ? [context.signal] : [])]);
    try {
      const accessToken = await this.visitorToken(signal);
      const { bytes } = await fetchBounded(
        TRACK_URL,
        {
          method: 'POST',
          headers: { ...SITE_HEADERS, Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ items: [trackingNumber], language_code: 'en' }),
          signal,
        },
        {
          provider: 'PostNL tracking',
          timeoutMs: TRACK_TIMEOUT_MS,
          maxBytes: 1_000_000,
          retryTransient: true,
          fetcher: this.fetcher,
        },
      );
      signal.throwIfAborted();
      return parsePostNLTrackingResponse(parseJsonBytes(bytes, 'PostNL tracking'), trackingNumber);
    } catch (error) {
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
        throw new TransportError(PROVIDER, 'PostNL tracking endpoint is unavailable', { cause: error });
      }
      throw error;
    }
  }
}

/** Kept for the host's legacy dispatch chain until it is deleted. */
export async function fetchPostNL(trackingNumber: string): Promise<CarrierResult> {
  return new PostNLTracker().fetch(trackingNumber);
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PostNLTracker({ fetcher: environment.fetcher });
  return {
    id: 'spring-gds',
    // The visitor token and the lookup are one step: both are keyless HTTP on
    // the same host, and each replays once inside the step.
    steps: ['direct'],
    track: (input, context) => tracker.fetch(input.number, context),
  };
};
