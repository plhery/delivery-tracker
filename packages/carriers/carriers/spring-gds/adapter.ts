import 'server-only';

/**
 * PostNL international tracking (carrier id `spring-gds`).
 *
 * The folder keeps the historical `spring-gds` id for parcels and clients that
 * already store it; the carrier is presented as PostNL everywhere else. Spring
 * GDS is PostNL's international subsidiary and its mailingtechnology.com
 * portal shows the same barcode (docs/CARRIERS.md).
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
import type { AdapterFactory } from '../../core/adapter';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { postNLStatus } from './status';

const PROVIDER = 'PostNL';
const TOKEN_URL = 'https://postnl.post/api/v1/auth/token';
const TRACK_URL = 'https://postnl.post/api/v1/tracking-items';
const TOKEN_TIMEOUT_MS = 10_000;
const TRACK_TIMEOUT_MS = 15_000;
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
  return text(value).toLocaleUpperCase('en-US').replace(/[^A-Z0-9]/g, '');
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
  const item = identified.find((candidate) => comparableIdentifier(candidate.item) === requested);
  if (!item) throw new SchemaError(PROVIDER, 'PostNL returned a different shipment');
  if (!Array.isArray(item.events)) {
    throw new SchemaError(PROVIDER, 'PostNL returned invalid tracking history');
  }
  const rawEvents = recordArray(item.events);
  if (rawEvents.length !== item.events.length) {
    throw new SchemaError(PROVIDER, 'PostNL returned an invalid tracking event');
  }
  if (rawEvents.length === 0 && NOT_FOUND_MESSAGE.test(text(item.message))) {
    // The rest of `message` can carry provider prose; only the recognized
    // phrase is used, and none of it reaches the error.
    throw new NotFoundError(PROVIDER);
  }
  const events = rawEvents.map((event): CarrierEvent => {
    const classified = postNLStatus(event.category);
    return {
      time: text(event.datetime_local),
      location: text(event.country_name) || text(event.country_code),
      description: text(event.status_description) || text(event.category),
      ...(classified ? { stage: classified.stage } : {}),
    };
  });
  const latest = rawEvents[0] ?? {};
  const category = text(latest.category);
  const classified = postNLStatus(category);
  // Webshop or business name only; PostNL does not expose the recipient here.
  const senderName = text(item.senderName ?? item.sender ?? item.title).replace(/\s+/g, ' ').trim().slice(0, 200) || null;
  const deliveredAt = classified?.status === 'delivered' ? text(latest.datetime_local) || null : null;
  return {
    status: classified?.status ?? (category ? 'in_transit' : 'unknown'),
    ...(classified ? { current_stage: classified.stage } : {}),
    last_status_text: text(latest.status_description) || category,
    last_update: events[0]?.time || null,
    expected_delivery: null,
    ...(senderName ? { sender_name: senderName } : {}),
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}),
    events,
  };
}

export class PostNLTracker {
  private readonly fetcher: typeof fetch | undefined;

  constructor(options: { fetcher?: typeof fetch } = {}) {
    this.fetcher = options.fetcher;
  }

  /** A fresh visitor token per lookup: it is short-lived and keyless. */
  private async visitorToken(): Promise<string> {
    const { bytes } = await fetchBounded(
      TOKEN_URL,
      { method: 'POST', headers: SITE_HEADERS, body: '{}' },
      {
        provider: 'PostNL authentication',
        timeoutMs: TOKEN_TIMEOUT_MS,
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

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const accessToken = await this.visitorToken();
    const { bytes } = await fetchBounded(
      TRACK_URL,
      {
        method: 'POST',
        headers: { ...SITE_HEADERS, Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ items: [trackingNumber], language_code: 'en' }),
      },
      {
        provider: 'PostNL tracking',
        timeoutMs: TRACK_TIMEOUT_MS,
        retryTransient: true,
        fetcher: this.fetcher,
      },
    );
    return parsePostNLTrackingResponse(parseJsonBytes(bytes, 'PostNL tracking'), trackingNumber);
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
    track: (input) => tracker.fetch(input.number),
  };
};
