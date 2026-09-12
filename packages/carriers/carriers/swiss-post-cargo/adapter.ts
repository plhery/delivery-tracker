import 'server-only';

import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { InputRequiredError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult, CarrierStatus } from '../../core/result';
import { cleanScalar, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord } from '../../core/types';
import { statusFor } from './status';

// Protocol provenance (inspected 2026-08-30): the source map published by the
// official public tracker posts { Identifier } to this anonymous endpoint and
// treats a null Data property as a clean not-found result.
// https://apv.swisspost-cargo.com/static/js/907.9a0b939a.chunk.js.map
const TRACKING_API = 'https://eosapi.swisspost-cargo.com/api/trackandtrace/public';
const TRACKING_PAGE = 'https://apv.swisspost-cargo.com/public/trackandtrace';
const PROVIDER = 'Swiss Post Cargo';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;

export interface SwissPostCargoOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

/**
 * Local time policy, deliberately not `isoTime()`: the endpoint sends ISO-8601
 * with an explicit offset, and the dotted/slashed fallbacks are wall-clock
 * strings in Europe/Zurich. An ISO value without an offset keeps luxon's
 * `setZone` reading rather than being stamped, so an unexpected shape is never
 * silently relabelled as Swiss local time.
 */
function eventTimestamp(value: unknown): { value: string; timestamp: number } | null {
  const raw = cleanScalar(value, 64);
  if (!raw) return null;
  let parsed = DateTime.fromISO(raw, { setZone: true });
  if (!parsed.isValid) {
    for (const format of ['dd.MM.yyyy HH:mm:ss', 'dd.MM.yyyy HH:mm', 'dd/MM/yyyy HH:mm:ss']) {
      parsed = DateTime.fromFormat(raw, format, { zone: 'Europe/Zurich' });
      if (parsed.isValid) break;
    }
  }
  if (!parsed.isValid) return null;
  return {
    value: parsed.toISO({ suppressMilliseconds: true }) ?? raw,
    timestamp: parsed.toMillis(),
  };
}

export function normalizeSwissPostCargoTrackingNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^(?=.*\d)[A-Z0-9]{6,40}$/.test(value)) {
    throw new InputRequiredError(PROVIDER, 'a 6- to 40-character barcode or reference');
  }
  return value;
}

export function swissPostCargoTrackingUrl(raw: string): string {
  return `${TRACKING_PAGE}/${encodeURIComponent(normalizeSwissPostCargoTrackingNumber(raw))}`;
}

export function parseSwissPostCargoResponse(
  payload: unknown,
  rawTrackingNumber: string,
): CarrierResult {
  const trackingNumber = normalizeSwissPostCargoTrackingNumber(rawTrackingNumber);
  if (!isRecord(payload) || !Object.hasOwn(payload, 'Data')) {
    throw new SchemaError(PROVIDER, 'Swiss Post Cargo returned an invalid tracking response');
  }
  if (payload.Data === null) throw new NotFoundError(PROVIDER);
  if (!Array.isArray(payload.Data) || payload.Data.length === 0) {
    throw new SchemaError(PROVIDER, 'Swiss Post Cargo returned an invalid tracking response');
  }
  let shipments = payload.Data.filter(isRecord);
  if (shipments.length === 0) {
    throw new SchemaError(PROVIDER, 'Swiss Post Cargo returned an invalid tracking response');
  }
  const responseType = Number(payload.Type);
  if (responseType !== 1 && responseType !== 2) {
    throw new SchemaError(PROVIDER, 'Swiss Post Cargo returned an invalid tracking response type');
  }
  if (responseType === 1) {
    const identifiers = shipments
      .map((shipment) => cleanScalar(shipment.Identifier, 64).toLocaleUpperCase('en-US'))
      .filter(Boolean);
    if (identifiers.length === 0) {
      throw new SchemaError(PROVIDER, 'Swiss Post Cargo returned no shipment identifier');
    }
    if (!identifiers.includes(trackingNumber)) {
      throw new SchemaError(PROVIDER, 'Swiss Post Cargo returned a different shipment');
    }
    shipments = shipments.filter((shipment) => (
      cleanScalar(shipment.Identifier, 64).toLocaleUpperCase('en-US') === trackingNumber
    ));
  }

  const parsedEvents: Array<{
    event: CarrierEvent;
    status: CarrierStatus;
    timestamp: number;
    index: number;
  }> = [];
  const seen = new Set<string>();
  let index = 0;
  for (const shipment of shipments.slice(0, 100)) {
    if (!Array.isArray(shipment.History)) continue;
    for (const candidate of shipment.History.slice(0, 500)) {
      if (!isRecord(candidate)) continue;
      const time = eventTimestamp(candidate.TimeStamp);
      const description = cleanScalar(candidate.Description);
      if (!time || !description) continue;
      const location = cleanScalar(candidate.City, 120);
      const code = cleanScalar(candidate.Status, 32).toLocaleUpperCase('en-US');
      const identity = JSON.stringify([time.value, location, description, code]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const classified = statusFor(code, description);
      parsedEvents.push({
        event: {
          time: time.value,
          location,
          description,
          stage: classified.stage,
          ...(code ? { provider_code: code } : {}),
        },
        status: classified.status,
        timestamp: time.timestamp,
        index,
      });
      index += 1;
    }
  }
  parsedEvents.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const events = parsedEvents.slice(0, 100);
  if (events.length === 0) {
    throw new SchemaError(PROVIDER, 'Swiss Post Cargo returned no usable tracking events');
  }
  const latest = events[0]!;
  return {
    status: latest.status,
    current_stage: latest.event.stage,
    last_status_text: latest.event.description,
    last_update: latest.event.time,
    expected_delivery: null,
    timezone: 'Europe/Zurich',
    events: events.map(({ event }) => event),
    tracking_url: swissPostCargoTrackingUrl(trackingNumber),
  };
}

export class SwissPostCargoTracker {
  readonly timeoutMs: number;
  readonly #fetcher: typeof fetch | undefined;

  constructor(options: number | SwissPostCargoOptions = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, fetcher } = typeof options === 'number' ? { timeoutMs: options, fetcher: undefined } : options;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('Swiss Post Cargo timeout must be positive');
    }
    this.timeoutMs = timeoutMs;
    this.#fetcher = fetcher;
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizeSwissPostCargoTrackingNumber(rawTrackingNumber);
    const { bytes } = await fetchBounded(TRACKING_API, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-CH,en;q=0.9',
        'Content-Type': 'application/json',
        Origin: 'https://apv.swisspost-cargo.com',
        Referer: `${TRACKING_PAGE}/`,
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
      },
      body: JSON.stringify({ Identifier: trackingNumber }),
    }, {
      provider: 'Swiss Post Cargo tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      ...(this.#fetcher ? { fetcher: this.#fetcher } : {}),
    });
    return parseSwissPostCargoResponse(parseJsonBytes(bytes, PROVIDER), trackingNumber);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new SwissPostCargoTracker({ fetcher: environment.fetcher });
  return {
    id: 'swiss-post-cargo',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
