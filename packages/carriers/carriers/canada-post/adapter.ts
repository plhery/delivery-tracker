import 'server-only';

import type { AdapterFactory } from '../../core/adapter';
import { SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean, cleanScalar, fetchBounded, parseJsonBytes } from '../../core/transport';
import { explicitOffsetTime, isoTime } from '../../core/time';
import { isRecord, type JsonObject } from '../../core/types';
import { CANADA_POST_STATUS_STAGE, canadaPostStage, canadaPostStatus } from './status';

/**
 * Canada Post, through the tracking application's own JSON endpoint.
 *
 * The lookup form posts nothing: it reads
 * `GET {origin}/track-reperage/rs/track/json/package?refNbrs={number}` with
 * an empty Basic credential and a JSON Accept, and the reply carries the
 * summary, the status and the scans. No session, no captcha and no browser
 * are needed (verified 2026-09-20: the same call answers plain server-side
 * HTTP with a `004` "No PIN History" envelope for an expired number).
 *
 * Response shape provenance: the application's bundle (item `status` enum,
 * `events` with `cd` and `datetime`, `expectedDlvryDateTime`,
 * `actualDlvryDate`, `attemptedDlvryDate`), inspected 2026-09-20. Event
 * display-text and location fields are the documented assumption until a
 * live parcel confirms them.
 */
const API_BASE = 'https://www.canadapost-postescanada.ca/track-reperage/rs/track/json/package';
const PROVIDER = 'Canada Post';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_EVENTS_TO_INSPECT = 500;
const MAX_EVENTS_TO_RETURN = 100;

export function normalizeCanadaPostNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^(?:\d{13,24}|[A-Z]{2}\d{9}CA)$/.test(value)) {
    throw new SchemaError(PROVIDER, 'Canada Post tracking numbers must contain 13 to 24 digits, or match the UPU S10 format');
  }
  return value;
}

export function canadaPostTrackingUrl(trackingNumber: string): string {
  return `https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=${normalizeCanadaPostNumber(trackingNumber)}`;
}

function trackingApiUrl(trackingNumber: string): string {
  const url = new URL(API_BASE);
  url.searchParams.set('refNbrs', normalizeCanadaPostNumber(trackingNumber));
  return url.toString();
}

/** FedEx-style not-found code plus the observed "No PIN History" envelope. */
function itemError(item: JsonObject): string {
  if (!isRecord(item.error)) return '';
  return `${cleanScalar(item.error.cd)} ${clean(item.error.descEn)} ${clean(item.error.desc)}`;
}

function notLocated(): CarrierResult {
  return {
    status: 'unknown',
    last_status_text: 'Canada Post could not locate the shipment',
    last_update: null,
    expected_delivery: null,
    events: [],
  };
}

/**
 * Scan timestamps arrive as a date and a clock time without an offset, in
 * the backend's own rendering. An explicit offset wins; anything else keeps
 * the provider's own text rather than being stamped with a guessed zone.
 */
function eventTime(date: unknown, time: unknown): string {
  const dateText = cleanScalar(date, 64);
  const timeText = cleanScalar(time, 64);
  const combined = clean(`${dateText}T${timeText}`, 64);
  const offset = explicitOffsetTime(combined) ?? explicitOffsetTime(`${dateText} ${timeText}`);
  if (offset) return offset.iso;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateText) ? dateText : null;
  if (day && !timeText) return day;
  if (day && /^\d{2}:\d{2}(:\d{2})?$/.test(timeText)) {
    return isoTime(`${day}T${timeText.length === 5 ? `${timeText}:00` : timeText}`, 'UTC')?.iso
      ?? clean(`${dateText} ${timeText}`, 64);
  }
  return clean(`${dateText} ${timeText}`, 64);
}

/** A delivery estimate reduced to its calendar day. */
function expectedDelivery(value: unknown): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(cleanScalar(value, 64));
  return match ? match[1]! : null;
}

const DESCRIPTION_KEYS = ['descEn', 'eventDescEn', 'description', 'statusDescEn', 'eventDescription', 'desc'];
const LOCATION_KEYS = ['locationEn', 'location', 'cityEn', 'city', 'retailLocation'];

function firstText(record: JsonObject, keys: string[], limit = 500): string {
  for (const key of keys) {
    const value = clean(record[key], limit);
    if (value) return value;
  }
  return '';
}

/** The single-package tracking reply. */
export function parseCanadaPostTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = normalizeCanadaPostNumber(trackingNumber);
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new SchemaError(PROVIDER, 'Canada Post returned an invalid tracking response');
  }
  const items = payload.filter(isRecord);
  const matches = items.filter((item) => {
    const echoed = [item.pin, item.refNbr1, item.trackingNumber, item.trackingNum]
      .map((value) => cleanScalar(value).replace(/[\s.-]/g, '').toLocaleUpperCase('en-US'));
    return echoed.includes(number);
  });
  if (matches.length !== 1) {
    // An error-only envelope (expired or unknown number) is unlocated, not
    // another parcel: only an echoed number ever binds a result.
    if (matches.length === 0 && items.every((item) => itemError(item))) return notLocated();
    throw new SchemaError(PROVIDER, matches.length === 0
      ? 'Canada Post did not return the requested parcel'
      : 'Canada Post returned several shipments for this number');
  }
  const item = matches[0]!;
  const scans = Array.isArray(item.events) ? item.events.filter(isRecord) : [];
  const statusCode = cleanScalar(item.status);
  if (scans.length === 0 && !statusCode && itemError(item)) return notLocated();
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const raw of scans.slice(0, MAX_EVENTS_TO_INSPECT)) {
    const description = firstText(raw, DESCRIPTION_KEYS);
    if (!description) continue;
    const code = cleanScalar(raw.cd, 64);
    const stage = canadaPostStage(description) ?? undefined;
    const moment = isRecord(raw.datetime) ? raw.datetime : raw;
    const time = eventTime(moment.date, moment.time);
    const location = firstText(raw, LOCATION_KEYS, 250);
    const event: CarrierEvent = {
      ...(time ? { time } : {}),
      ...(location ? { location } : {}),
      // A delivered line may name who signed; the event keeps the fact, not the name.
      description: stage === 'delivered' ? 'Delivered' : description,
      ...(stage ? { stage } : {}),
      ...(code && /^[A-Za-z0-9_-]+$/.test(code) ? { provider_code: code } : {}),
    };
    const identity = JSON.stringify([event.time ?? '', event.location ?? '', event.description]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    events.push(event);
  }
  const trimmed = events.slice(0, MAX_EVENTS_TO_RETURN);
  const summaryText = firstText(item, ['summaryEn', 'statusDescriptionEn', 'statusDescription', 'summary'], 500);
  const statusText = summaryText || trimmed[0]?.description || 'Tracking information received';
  const stage = CANADA_POST_STATUS_STAGE[statusCode] ?? canadaPostStage(statusText) ?? undefined;
  const status = canadaPostStatus(statusCode, statusText, trimmed.length > 0);
  const delivered = stage === 'delivered';
  const estimate = delivered ? null : expectedDelivery(
    isRecord(item.expectedDlvryDateTime)
      ? item.expectedDlvryDateTime.revisedDate ?? item.expectedDlvryDateTime.dlvryDate
      : item.expectedDlvryDate,
  );
  const deliveredAt = delivered
    ? expectedDelivery(item.actualDlvryDate) ?? expectedDelivery(item.attemptedDlvryDate) ?? trimmed[0]?.time ?? null
    : null;
  return {
    status,
    ...(stage ? { current_stage: stage } : {}),
    last_status_text: delivered ? 'Delivered' : statusText,
    last_update: trimmed[0]?.time || null,
    expected_delivery: estimate,
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}),
    events: trimmed,
  };
}

export interface CanadaPostTrackerOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

export class CanadaPostTracker {
  readonly timeoutMs: number;
  readonly #fetcher: typeof fetch | undefined;

  constructor(options: number | CanadaPostTrackerOptions = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, fetcher } = typeof options === 'number'
      ? { timeoutMs: options, fetcher: undefined }
      : options;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('Canada Post timeout must be positive');
    }
    this.timeoutMs = timeoutMs;
    this.#fetcher = fetcher;
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizeCanadaPostNumber(rawTrackingNumber);
    const { bytes } = await fetchBounded(trackingApiUrl(trackingNumber), {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-CA,en;q=0.9',
        Authorization: 'Basic Og==',
        Referer: 'https://www.canadapost-postescanada.ca/track-reperage/en/home',
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
        'X-Requested-With': 'XMLHttpRequest',
      },
    }, {
      provider: 'Canada Post tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      ...(this.#fetcher ? { fetcher: this.#fetcher } : {}),
    });
    const result = parseCanadaPostTrackingResponse(parseJsonBytes(bytes, PROVIDER), trackingNumber);
    result.tracking_url = canadaPostTrackingUrl(trackingNumber);
    result.tracking_source = 'structured-web-response';
    return result;
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new CanadaPostTracker({ fetcher: environment.fetcher });
  return {
    id: 'canada-post',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
