/**
 * GLS France: the public consignee endpoint called by moncolis.gls-france.com.
 *
 * One bounded GET per lookup ('direct' step). The response carries the parcel
 * record, its event list, and blocks describing the people involved; `parse()`
 * builds its result from an explicit allowlist of status, timing and
 * operational-location fields, so recipient names, street addresses, contacts,
 * signatures and delivery instructions never leave this module.
 */
import 'server-only';

import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { EXPLICIT_OFFSET_PATTERN, type ParsedTime } from '../../core/time';
import { cleanScalar, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import {
  FAILED_DELAYED_DELIVERY,
  glsFranceStatusCode,
  glsFranceStatusMetadata,
  type GLSFranceStatusMetadata,
} from './status';

export { glsFranceStatus } from './status';

const PROVIDER = 'GLS France';
const TRACKING_API =
  'https://public.infra-prod.prod.cloud.fr.gls-group.com/consignee-ws/api/v1/command/public/codes';
const TRACKING_PAGE = 'https://moncolis.gls-france.com/fr';
const TIMEZONE = 'Europe/Paris';
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 750_000;
const MAX_EVENTS_TO_INSPECT = 500;
const MAX_EVENTS_TO_RETURN = 100;

function locationCode(value: unknown): string {
  const code = cleanScalar(value, 16).toLocaleUpperCase('en-US');
  return /^[A-Z]{2}[A-Z0-9]{2,8}$/.test(code) ? code : '';
}

/**
 * GLS France puts three shapes on the same timestamp fields: an ISO value with
 * or without an offset, a SQL-style `YYYY-MM-DD HH:mm:ss.S` wall clock, and a
 * bare calendar day. No single `core/time` policy covers all three, so this
 * helper stays local: an explicit offset is honored, everything else is read in
 * Europe/Paris, which is the zone the French backend stamps.
 */
function parsedTime(value: unknown): ParsedTime | null {
  const raw = cleanScalar(value, 64);
  // Empty timestamps arrive padded with year 1 instead of being omitted.
  if (!raw || raw.startsWith('0001-')) return null;
  let parsed = raw.includes('T')
    ? DateTime.fromISO(raw, { setZone: EXPLICIT_OFFSET_PATTERN.test(raw), zone: TIMEZONE })
    : DateTime.fromSQL(raw, { zone: TIMEZONE });
  if (!parsed.isValid && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    parsed = DateTime.fromISO(raw, { zone: TIMEZONE });
  }
  if (!parsed.isValid) return null;
  const iso = parsed.toISO({ suppressMilliseconds: true });
  return iso ? { iso, timestamp: parsed.toMillis() } : null;
}

function expectedDelivery(value: unknown): string | null {
  return parsedTime(value)?.iso.slice(0, 10) ?? null;
}

function normalizedCandidate(value: unknown): string {
  const candidate = cleanScalar(value, 32).toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  return /^(?:[A-Z0-9]{8}|\d{11})$/.test(candidate) ? candidate : '';
}

export function normalizeGLSFranceTrackingNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^(?:[A-Z0-9]{8}|\d{11})$/.test(value)) {
    throw new TypeError('GLS France tracking numbers must contain 8 letters or digits, or 11 digits');
  }
  return value;
}

export function glsFranceTrackingUrl(trackingNumber: string): string {
  return `${TRACKING_PAGE}/${encodeURIComponent(normalizeGLSFranceTrackingNumber(trackingNumber))}`;
}

export function glsFranceTrackingApiUrl(trackingNumber: string): string {
  return `${TRACKING_API}/${encodeURIComponent(normalizeGLSFranceTrackingNumber(trackingNumber))}`;
}

function records(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function responseIdentifiers(parcel: JsonObject): string[] {
  return [parcel.trackid, parcel.numeroalphaColis, parcel.numeroGp]
    .map(normalizedCandidate)
    .filter(Boolean);
}

interface ParsedEvent {
  event: CarrierEvent;
  timestamp: number;
  sourceIndex: number;
  typeCode: string;
  metadata: GLSFranceStatusMetadata | null;
}

function parseEvent(raw: JsonObject, sourceIndex: number): ParsedEvent | null {
  const eventStatusCode = glsFranceStatusCode(raw.statutEvenement);
  const typeCode = glsFranceStatusCode(raw.typeEvenement);
  const code = eventStatusCode || typeCode;
  const metadata = eventStatusCode === 'DEL' && typeCode === 'LIV'
    ? FAILED_DELAYED_DELIVERY
    : glsFranceStatusMetadata(code);
  const time = parsedTime(raw.datereference) ?? parsedTime(raw.datecreation);
  if (!code && !time) return null;
  const location = locationCode(raw.codelieuEvenement);
  return {
    timestamp: time?.timestamp ?? Number.NEGATIVE_INFINITY,
    sourceIndex,
    typeCode,
    metadata,
    event: {
      ...(time ? { time: time.iso } : {}),
      ...(location ? { location } : {}),
      description: metadata?.description ?? 'GLS France tracking update',
      // An unmapped code carries no stage: the sync classifies and records it.
      ...(metadata ? { stage: metadata.stage } : {}),
      ...(code ? { provider_code: code } : {}),
    },
  };
}

export function parseGLSFranceTrackingResponse(
  payload: unknown,
  trackingNumber: string,
): CarrierResult {
  const requested = normalizeGLSFranceTrackingNumber(trackingNumber);
  if (!isRecord(payload) || !isRecord(payload.colis)) {
    throw new SchemaError(PROVIDER, 'GLS France returned an invalid tracking response');
  }

  const parcel = payload.colis;
  const identifiers = responseIdentifiers(parcel);
  if (identifiers.length === 0) {
    throw new SchemaError(PROVIDER, 'GLS France did not return a shipment identifier');
  }
  if (!identifiers.includes(requested)) {
    throw new SchemaError(PROVIDER, 'GLS France returned a different shipment');
  }

  const seen = new Set<string>();
  const parsedEvents: ParsedEvent[] = [];
  records(payload.evenements).slice(0, MAX_EVENTS_TO_INSPECT).forEach((raw, index) => {
    const parsed = parseEvent(raw, index);
    if (!parsed) return;
    const identity = JSON.stringify([
      parsed.event.time ?? '',
      parsed.event.location ?? '',
      parsed.event.provider_code ?? '',
    ]);
    if (seen.has(identity)) return;
    seen.add(identity);
    parsedEvents.push(parsed);
  });
  parsedEvents.sort((left, right) => (
    right.timestamp - left.timestamp || left.sourceIndex - right.sourceIndex
  ));
  const latestParsedEvent = parsedEvents[0];
  const events = parsedEvents
    .slice(0, MAX_EVENTS_TO_RETURN)
    .map(({ event }) => event);

  const currentCode = glsFranceStatusCode(parcel.statutColis);
  const current = currentCode === 'DEL' && latestParsedEvent?.typeCode === 'LIV'
    ? FAILED_DELAYED_DELIVERY
    : glsFranceStatusMetadata(currentCode);
  const latestEvent = events[0];
  const latestEventStatus = latestParsedEvent?.metadata ?? glsFranceStatusMetadata(latestEvent?.provider_code);
  const fallbackUpdate = parsedTime(parcel.dateActionColis);
  return {
    status: current?.status ?? latestEventStatus?.status ?? 'unknown',
    last_status_text: current?.description
      ?? latestEvent?.description
      ?? 'Tracking information received',
    last_update: latestEvent?.time ?? fallbackUpdate?.iso ?? null,
    expected_delivery: expectedDelivery(parcel.dateTheoriqueLivraison),
    timezone: TIMEZONE,
    events,
  };
}

export interface GLSFranceTrackerOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

export class GLSFranceTracker {
  readonly timeoutMs: number;
  readonly #fetcher: typeof fetch | undefined;

  constructor(options: GLSFranceTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('GLS France timeout must be positive');
    }
    this.#fetcher = options.fetcher;
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const normalized = normalizeGLSFranceTrackingNumber(trackingNumber);
    const { bytes } = await fetchBounded(glsFranceTrackingApiUrl(normalized), {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Origin: 'https://moncolis.gls-france.com',
        Referer: `${TRACKING_PAGE}/`,
        'User-Agent': 'Mozilla/5.0 (compatible; SwissDeliveryTracker/1.0)',
      },
    }, {
      provider: 'GLS France tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      fetcher: this.#fetcher,
    });
    return parseGLSFranceTrackingResponse(parseJsonBytes(bytes, PROVIDER), normalized);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new GLSFranceTracker({ fetcher: environment.fetcher });
  return {
    id: 'gls-fr',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
