import 'server-only';

import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { amazonShippingOrigin, amazonShippingUrl } from '../../core/catalog';
import { isAmazonTrackingNumber } from '../../core/detection';
import { IndeterminateError, InputRequiredError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { cleanScalar, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { classifyStatus, statusKey, type ClassifiedStatus } from './status';

const PROVIDER = 'Amazon Shipping';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_EVENTS_TO_INSPECT = 500;
const MAX_EVENTS_TO_RETURN = 100;

export { amazonShippingStatus } from './status';

interface ParsedDate {
  iso: string;
  timestamp: number;
}

interface ParsedEvent {
  event: CarrierEvent;
  classified: ClassifiedStatus;
  timestamp: number;
  sourceIndex: number;
}

export interface AmazonShippingOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

/** Kept as a named class: the host's eligibility check narrows on it with `instanceof`. */
export class AmazonShippingNotFoundError extends NotFoundError {
  constructor() {
    super(PROVIDER);
    this.name = 'AmazonShippingNotFoundError';
  }
}

/**
 * Amazon recognizes the shipment but will not serve its history any more.
 * A definite answer that still yields no usable tracking data, so it maps to
 * the taxonomy's `indeterminate` kind. The host narrows on this class with
 * `instanceof` to store the history-expired marker and stop scheduling syncs.
 */
export class AmazonShippingHistoryExpiredError extends IndeterminateError {
  constructor() {
    super(PROVIDER, 'Amazon Shipping tracking history has expired');
    this.name = 'AmazonShippingHistoryExpiredError';
  }
}

function eventDescription(raw: JsonObject, classified: ClassifiedStatus): string {
  const summary = isRecord(raw.statusSummary) ? raw.statusSummary : {};
  const key = [summary.localisedStringId, raw.eventCode, raw.subReasonCode]
    .map(statusKey)
    .join(' ');
  if (key.includes('creationconfirmed')) return 'Shipment information received';
  if (key.includes('pickupdone') || key.includes('detailpickedup')) return 'Shipment picked up';
  if (key.includes('arrivedatdeliverycenter')) return 'Arrived at delivery center';
  if (key.includes('arrivedatsortcenter')) return 'Arrived at sorting center';
  if (key.includes('departed')) return 'Departed facility';
  return classified.description;
}

/**
 * Local time policy, deliberately not one of `core/time`'s helpers: the tracker
 * mixes ISO-8601, RFC 2822 and US long-form dates, and when `zone` is null (a
 * `TBA` number, which identifies no country) an offset-free value must be
 * rejected rather than stamped with a guess.
 */
function parseDate(value: unknown, zone: string | null): ParsedDate | null {
  const raw = cleanScalar(value, 100);
  if (!raw) return null;
  const isoHasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  if (!zone && !isoHasZone && !/[+-][0-9]{4}$|GMT|UTC/i.test(raw)) return null;
  const candidates = [
    DateTime.fromISO(raw, { setZone: isoHasZone, zone: zone ?? 'UTC' }),
    DateTime.fromRFC2822(raw, { setZone: true }),
    ...[
      'LLL d, yyyy, h:mm:ss a',
      'LLL d, yyyy, h:mm a',
      'LLLL d, yyyy, h:mm:ss a',
      'LLLL d, yyyy, h:mm a',
    ].map((format) => DateTime.fromFormat(raw, format, {
      locale: 'en-US',
      zone: zone ?? 'UTC',
    })),
  ];
  const parsed = candidates.find((candidate) => candidate.isValid);
  if (!parsed) return null;
  const iso = parsed.toISO({ suppressMilliseconds: true });
  return iso ? { iso, timestamp: parsed.toMillis() } : null;
}

function parseSerializedRecord(value: unknown, field: string): JsonObject {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) {
    throw new SchemaError(PROVIDER, `Amazon Shipping returned an invalid ${field}`);
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) return parsed;
  } catch (error) {
    throw new SchemaError(PROVIDER, `Amazon Shipping returned an invalid ${field}`, { cause: error });
  }
  throw new SchemaError(PROVIDER, `Amazon Shipping returned an invalid ${field}`);
}

function optionalSerializedRecord(value: unknown, field: string): JsonObject | null {
  if (value == null || value === 'null' || value === '') return null;
  return parseSerializedRecord(value, field);
}

function isNotFoundError(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const key = `${statusKey(value.errorCode)} ${statusKey(value.errorMessage)}`;
  return key.includes('trackingidnotfound') || key.includes('invalidtrackingid');
}

/** City, region and country only; the same object also carries the street and postcode. */
function location(raw: unknown): string {
  if (!isRecord(raw)) return '';
  const values = [raw.city, raw.stateProvince, raw.countryCode]
    .map((value) => cleanScalar(value, 100))
    .filter((value, index, all) => value
      && all.findIndex((candidate) => candidate.toLocaleLowerCase('en-US')
        === value.toLocaleLowerCase('en-US')) === index);
  return values.join(', ').slice(0, 250);
}

function providerCode(value: unknown): string {
  const code = cleanScalar(value, 64);
  return /^[A-Za-z0-9_-]+$/.test(code) ? code : '';
}

function eventRecords(value: JsonObject | null): JsonObject[] {
  const events = value?.eventHistory;
  return Array.isArray(events) ? events.filter(isRecord) : [];
}

function parseEvent(raw: JsonObject, sourceIndex: number, zone: string | null): ParsedEvent | null {
  const summary = isRecord(raw.statusSummary) ? raw.statusSummary : {};
  const classified = classifyStatus(
    summary.localisedStringId,
    raw.eventCode,
    raw.subReasonCode,
  );
  const time = parseDate(raw.eventTime, zone);
  const code = providerCode(raw.eventCode);
  if (!time && !code && classified.status === 'unknown') return null;
  const eventLocation = location(raw.location);
  return {
    classified,
    timestamp: time?.timestamp ?? Number.NEGATIVE_INFINITY,
    sourceIndex,
    event: {
      ...(time ? { time: time.iso } : {}),
      ...(eventLocation ? { location: eventLocation } : {}),
      description: eventDescription(raw, classified),
      stage: classified.stage,
      ...(code ? { provider_code: code } : {}),
    },
  };
}

function metadataValue(metadata: JsonObject, field: string): unknown {
  const value = metadata[field];
  if (!isRecord(value)) return value;
  return value.stringValue ?? value.date ?? value.value;
}

export function normalizeAmazonShippingTrackingNumber(raw: string): string {
  const value = raw.trim().toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!isAmazonTrackingNumber(value)) {
    throw new InputRequiredError(PROVIDER, 'a European country prefix and 10 digits, or TBA and 12 digits',
      'Amazon tracking numbers need a European country prefix and 10 digits, or TBA and 12 digits');
  }
  return value;
}

export function amazonShippingTrackingUrl(rawTrackingNumber: string): string {
  const trackingNumber = normalizeAmazonShippingTrackingNumber(rawTrackingNumber);
  return amazonShippingUrl(trackingNumber);
}

export function amazonShippingTrackingApiUrl(rawTrackingNumber: string): string {
  const trackingNumber = normalizeAmazonShippingTrackingNumber(rawTrackingNumber);
  return `${amazonShippingOrigin(trackingNumber)}/api/tracker/${encodeURIComponent(trackingNumber)}`;
}

export function parseAmazonShippingTrackingResponse(payload: unknown, zone: string | null = 'Europe/Paris', trackingNumber?: string): CarrierResult {
  if (!isRecord(payload)) {
    throw new SchemaError(PROVIDER, 'Amazon Shipping returned an invalid tracking response');
  }
  const progress = parseSerializedRecord(payload.progressTracker, 'progress tracker');
  const errors = Array.isArray(progress.errors) ? progress.errors : [];
  if (errors.some(isNotFoundError)) throw new AmazonShippingNotFoundError();

  // The endpoint is shipment-scoped but does not normally echo identity. Reject a
  // contradictory ID when supplied; never accept a generic page or status alone.
  const identitySummary = isRecord(progress.summary) ? progress.summary : {};
  const identityMetadata = isRecord(identitySummary.metadata) ? identitySummary.metadata : {};
  for (const identity of [payload.trackingId, payload.trackingID, progress.trackingId, metadataValue(identityMetadata, 'trackingId')]) {
    if (trackingNumber && identity != null && String(identity).toUpperCase() !== trackingNumber) {
      throw new SchemaError(PROVIDER, 'Amazon Shipping returned a different tracking number');
    }
  }
  if (!['SWA', 'MCF'].includes(String(progress.trackerSource))) throw new AmazonShippingNotFoundError();
  if (errors.length && errors.every((error) => isRecord(error) && error.errorCode === 'SHIPMENT_OLDER_THAN_SUPPORTED_AGE')) {
    throw new AmazonShippingHistoryExpiredError();
  }
  if (errors.length) throw new SchemaError(PROVIDER, 'Amazon Shipping returned tracking errors');
  const history = optionalSerializedRecord(payload.eventHistory, 'event history');
  const seen = new Set<string>();
  const parsedEvents: ParsedEvent[] = [];
  eventRecords(history).slice(0, MAX_EVENTS_TO_INSPECT).forEach((raw, index) => {
    const parsed = parseEvent(raw, index, zone);
    if (!parsed) return;
    const identity = JSON.stringify([
      parsed.event.time ?? '',
      parsed.event.location ?? '',
      parsed.event.provider_code ?? '',
      parsed.event.description ?? '',
    ]);
    if (seen.has(identity)) return;
    seen.add(identity);
    parsedEvents.push(parsed);
  });
  parsedEvents.sort((left, right) => (
    right.timestamp - left.timestamp || right.sourceIndex - left.sourceIndex
  ));
  const events = parsedEvents.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);

  const summary = isRecord(progress.summary) ? progress.summary : {};
  const metadata = isRecord(summary.metadata) ? summary.metadata : {};
  const tags = Array.isArray(summary.containerStatusTags)
    ? summary.containerStatusTags.join(' ')
    : '';
  const current = classifyStatus(
    metadataValue(metadata, 'trackingStatus'),
    summary.status,
    tags,
  );
  const latestKnown = parsedEvents.find((item) => item.classified.status !== 'unknown');
  const active = current.status !== 'unknown' ? current : latestKnown?.classified;
  if (!active) {
    throw new SchemaError(PROVIDER, 'Amazon Shipping returned incomplete tracking details');
  }

  const fallbackUpdate = [
    'deliveryDate',
    'pickupEventDate',
    'creationDate',
  ].map((field) => parseDate(metadataValue(metadata, field), zone)).find(Boolean) ?? null;
  const expected = parseDate(
    progress.expectedDeliveryDate
      ?? metadataValue(metadata, 'expectedDeliveryDate')
      ?? metadataValue(metadata, 'promisedDeliveryDate'), zone,
  );
  return {
    status: active.status,
    current_stage: active.stage,
    last_status_text: active.description,
    last_update: events[0]?.time ?? fallbackUpdate?.iso ?? null,
    expected_delivery: expected?.iso.slice(0, 10) ?? null,
    ...(zone ? { timezone: zone } : {}),
    events,
  };
}

export function amazonShippingTimezone(number: string): string | null {
  if (number.startsWith('TBA')) return null; // A US number cannot establish a local timezone.
  const zones: Record<string, string> = {
    UK: 'Europe/London', GB: 'Europe/London', IE: 'Europe/Dublin', PT: 'Europe/Lisbon',
    FI: 'Europe/Helsinki', EE: 'Europe/Tallinn', LV: 'Europe/Riga', LT: 'Europe/Vilnius',
    GR: 'Europe/Athens', CY: 'Asia/Nicosia', RO: 'Europe/Bucharest', BG: 'Europe/Sofia',
    IS: 'Atlantic/Reykjavik', TR: 'Europe/Istanbul',
  };
  return zones[number.slice(0, 2)] ?? 'Europe/Paris';
}

export class AmazonShippingTracker {
  readonly timeoutMs: number;
  readonly #fetcher: typeof fetch | undefined;

  constructor(options: number | AmazonShippingOptions = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, fetcher } = typeof options === 'number'
      ? { timeoutMs: options, fetcher: undefined }
      : options;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError('Amazon Shipping timeout must be positive');
    }
    this.timeoutMs = timeoutMs;
    this.#fetcher = fetcher;
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizeAmazonShippingTrackingNumber(rawTrackingNumber);
    const { bytes } = await fetchBounded(amazonShippingTrackingApiUrl(trackingNumber), {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: amazonShippingTrackingUrl(trackingNumber),
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
      },
    }, {
      provider: 'Amazon Shipping tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      ...(this.#fetcher ? { fetcher: this.#fetcher } : {}),
    });
    return parseAmazonShippingTrackingResponse(parseJsonBytes(bytes, PROVIDER), amazonShippingTimezone(trackingNumber), trackingNumber);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new AmazonShippingTracker({ fetcher: environment.fetcher });
  return {
    id: 'amazon-shipping',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
