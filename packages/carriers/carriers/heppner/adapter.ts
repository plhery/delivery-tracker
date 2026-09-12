import 'server-only';

/**
 * Heppner recipient tracking.
 *
 * The public recipient page asks for a shipment receipt number plus the
 * delivery postcode, and the portal answers in two hops: a search call that
 * returns a base64 capability binding both values, then a detail call that
 * returns the shipment with its scan list. The capability is verified against
 * the credential we sent before it is used, so a portal that answered for a
 * different shipment cannot redirect the lookup.
 *
 * Privacy: the detail payload also carries shipment parties, references,
 * merchandise descriptions, appointment tokens and depot addresses. `parse()`
 * builds events from an explicit allowlist (time, our own description, stage,
 * event code) and keeps no location at all, because the only location field
 * the endpoint offers is the delivery address.
 */
import { Buffer } from 'node:buffer';
import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { InputRequiredError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult, CarrierStatus } from '../../core/result';
import {
  cleanScalar,
  decodeText,
  fetchBounded,
  parseJsonBytes,
  UpstreamHttpError,
} from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { classifyHeppnerEvent, heppnerCode } from './status';

const SEARCH_ENDPOINT = 'https://myportal.heppner-group.com/api/recipient/search/expedition';
const DETAIL_ENDPOINT = 'https://myportal.heppner-group.com/api/recipient/search/detailexpedition';
const TRACKING_PAGE = 'https://myportal.heppner-group.com/tracking';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENTS_TO_INSPECT = 500;
const MAX_EVENTS_TO_RETURN = 100;

interface HeppnerCredential {
  trackingNumber: string;
  postcode: string;
  countryCode: 'CH' | 'FR';
}

interface ParsedEvent {
  event: CarrierEvent;
  status: CarrierStatus;
  timestamp: number;
  index: number;
}

/**
 * Kept local rather than taken from core/time: the portal always stamps an
 * offset, and this adapter normalizes every scan to UTC instead of preserving
 * the source offset, which `explicitOffsetTime` does.
 */
function eventTime(value: unknown): { iso: string; timestamp: number } | null {
  const raw = cleanScalar(value, 64);
  if (!raw) return null;
  const parsed = DateTime.fromISO(raw, { setZone: true });
  const iso = parsed.toUTC().toISO({ suppressMilliseconds: true });
  return parsed.isValid && iso ? { iso, timestamp: parsed.toMillis() } : null;
}

export function normalizeHeppnerTrackingNumber(raw: string): string {
  const trackingNumber = raw.replace(/\s/g, '');
  if (!/^\d{8}$/.test(trackingNumber)) {
    throw new TypeError('Heppner tracking numbers must contain exactly 8 digits');
  }
  return trackingNumber;
}

export function normalizeHeppnerCredential(
  rawTrackingNumber: string,
  rawPostcode: string,
): HeppnerCredential {
  const trackingNumber = normalizeHeppnerTrackingNumber(rawTrackingNumber);
  const postcode = rawPostcode.trim();
  if (!/^\d{4,5}$/.test(postcode)) {
    throw new TypeError('Heppner requires a four-digit Swiss or five-digit French delivery postcode');
  }
  return {
    trackingNumber,
    postcode,
    countryCode: postcode.length === 4 ? 'CH' : 'FR',
  };
}

export function heppnerSearchUrl(rawTrackingNumber: string, rawPostcode: string): string {
  const credential = normalizeHeppnerCredential(rawTrackingNumber, rawPostcode);
  const url = new URL(SEARCH_ENDPOINT);
  url.search = new URLSearchParams({
    zipCode: credential.postcode,
    receipt: credential.trackingNumber,
    countryCode: credential.countryCode,
  }).toString();
  return url.toString();
}

function expectedCapabilityValue(credential: HeppnerCredential): string {
  return `${credential.trackingNumber}&${credential.postcode}&${credential.countryCode}`;
}

export function parseHeppnerCapability(
  rawCapability: string,
  rawTrackingNumber: string,
  rawPostcode: string,
): string {
  const credential = normalizeHeppnerCredential(rawTrackingNumber, rawPostcode);
  const capability = cleanScalar(rawCapability, 512);
  if (
    !capability
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(capability)
  ) {
    throw new SchemaError('Heppner', 'Heppner returned an invalid tracking capability');
  }
  let decoded = '';
  try {
    decoded = Buffer.from(capability, 'base64').toString('utf8');
  } catch (error) {
    throw new SchemaError('Heppner', 'Heppner returned an invalid tracking capability', { cause: error });
  }
  if (decoded !== expectedCapabilityValue(credential)) {
    throw new SchemaError('Heppner', 'Heppner returned a capability for a different shipment');
  }
  return capability;
}

export function heppnerDetailUrl(capability: string): string {
  const normalized = cleanScalar(capability, 512);
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new SchemaError('Heppner', 'Heppner tracking capability is invalid');
  }
  const url = new URL(DETAIL_ENDPOINT);
  url.searchParams.set('expedition', normalized);
  return url.toString();
}

export function heppnerTrackingPageUrl(capability: string): string {
  const normalized = cleanScalar(capability, 512);
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new SchemaError('Heppner', 'Heppner tracking capability is invalid');
  }
  return `${TRACKING_PAGE}/${encodeURIComponent(normalized)}`;
}

function responseReceipt(value: unknown): string {
  const normalized = cleanScalar(value, 32);
  return /^\d{8}$/.test(normalized) ? normalized : '';
}

function rawEvents(shipment: JsonObject): JsonObject[] {
  return Array.isArray(shipment.events) ? shipment.events.filter(isRecord) : [];
}

function parseEvents(shipment: JsonObject): ParsedEvent[] {
  const parsedEvents: ParsedEvent[] = [];
  const seen = new Set<string>();
  rawEvents(shipment).slice(0, MAX_EVENTS_TO_INSPECT).forEach((rawEvent, index) => {
    const providerCode = heppnerCode(rawEvent.code) || heppnerCode(rawEvent.event);
    const time = eventTime(rawEvent.event_date) ?? eventTime(rawEvent.date);
    if (!time) return;
    const classified = classifyHeppnerEvent(rawEvent.step, rawEvent.state, providerCode);
    const identity = `${time.iso}\u0000${providerCode}\u0000${classified.stage}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    parsedEvents.push({
      event: {
        time: time.iso,
        location: '',
        description: classified.description,
        stage: classified.stage,
        ...(providerCode ? { provider_code: providerCode } : {}),
      },
      status: classified.status,
      timestamp: time.timestamp,
      index,
    });
  });
  parsedEvents.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  return parsedEvents.slice(0, MAX_EVENTS_TO_RETURN);
}

export function parseHeppnerTrackingResponse(
  payload: unknown,
  rawTrackingNumber: string,
): CarrierResult {
  const trackingNumber = normalizeHeppnerTrackingNumber(rawTrackingNumber);
  if (!Array.isArray(payload)) {
    throw new SchemaError('Heppner', 'Heppner returned an invalid tracking response');
  }
  if (payload.length === 0) throw new NotFoundError('Heppner');
  const shipments = payload.filter(isRecord);
  if (shipments.length !== payload.length) {
    throw new SchemaError('Heppner', 'Heppner returned an invalid shipment entry');
  }
  const matching = shipments.find((shipment) => responseReceipt(shipment.receipt) === trackingNumber);
  if (!matching) {
    const hasIdentifier = shipments.some((shipment) => responseReceipt(shipment.receipt));
    if (hasIdentifier) throw new SchemaError('Heppner', 'Heppner returned a different shipment');
    throw new SchemaError('Heppner', 'Heppner did not return a shipment identifier');
  }

  const parsed = parseEvents(matching);
  if (parsed.length === 0) throw new SchemaError('Heppner', 'Heppner did not return tracking history');
  const latest = parsed[0]!;
  const latestKnown = parsed.find((item) => item.status !== 'unknown');
  return {
    status: latest.status !== 'unknown' ? latest.status : latestKnown?.status ?? 'unknown',
    current_stage: latest.status !== 'unknown'
      ? latest.event.stage ?? 'in_transit'
      : latestKnown?.event.stage ?? 'in_transit',
    last_status_text: latest.event.description ?? 'Tracking information received',
    last_update: latest.event.time ?? null,
    expected_delivery: null,
    timezone: 'Europe/Paris',
    events: parsed.map(({ event }) => event),
  };
}

function requestHeaders(
  accept: string,
  origin = 'https://www.heppner-group.com',
): Record<string, string> {
  return {
    Accept: accept,
    'Accept-Language': 'fr-FR,fr;q=0.9',
    Origin: origin,
    Referer: 'https://www.heppner-group.com/destinataire-suivez-votre-marchandise/',
    'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
  };
}

export interface HeppnerTrackerOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

export class HeppnerTracker {
  readonly timeoutMs: number;
  readonly fetcher?: typeof fetch;

  constructor(options: HeppnerTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Heppner timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string, rawPostcode: string): Promise<CarrierResult> {
    const credential = normalizeHeppnerCredential(rawTrackingNumber, rawPostcode);
    const search = await fetchBounded(
      heppnerSearchUrl(credential.trackingNumber, credential.postcode),
      { headers: requestHeaders('text/plain,*/*;q=0.8') },
      {
        provider: 'Heppner shipment search',
        timeoutMs: this.timeoutMs,
        maxBytes: 2_048,
        fetcher: this.fetcher,
        allowHttpError: true,
      },
    );
    if (search.response.status === 404) throw new NotFoundError('Heppner');
    if (!search.response.ok) {
      throw new UpstreamHttpError('Heppner shipment search', search.response.status);
    }
    const capability = parseHeppnerCapability(
      decodeText(search.bytes),
      credential.trackingNumber,
      credential.postcode,
    );

    const detail = await fetchBounded(heppnerDetailUrl(capability), {
      headers: {
        ...requestHeaders('application/json', 'https://myportal.heppner-group.com'),
        Referer: heppnerTrackingPageUrl(capability),
      },
    }, {
      provider: 'Heppner tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      fetcher: this.fetcher,
      allowHttpError: true,
    });
    if (detail.response.status === 404) throw new NotFoundError('Heppner');
    if (!detail.response.ok) {
      throw new UpstreamHttpError('Heppner tracking', detail.response.status);
    }
    return parseHeppnerTrackingResponse(
      parseJsonBytes(detail.bytes, 'Heppner'),
      credential.trackingNumber,
    );
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new HeppnerTracker({ fetcher: environment.fetcher });
  return {
    id: 'heppner',
    steps: ['direct'],
    track: async (input) => {
      const postcode = input.postcode?.trim() ?? '';
      if (!postcode) throw new InputRequiredError('Heppner', 'the delivery postcode');
      return tracker.fetch(input.number, postcode);
    },
  };
};
