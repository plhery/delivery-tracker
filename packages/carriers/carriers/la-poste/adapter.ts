import 'server-only';

import type { AdapterFactory } from '../../core/adapter';
import {
  CarrierError,
  SchemaError,
  UpstreamHttpError,
} from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps, type StepSpec } from '../../core/runner';
import type { StepRecorder } from '../../core/telemetry';
import { isoTime } from '../../core/time';
import { clean, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { eventStage, eventStatus } from './status';

// Protocol provenance:
// - `suivi-unifie` is the keyless feed the public tracking page calls: one
//   array entry per requested number, each with a `returnCode`, a `shipment`
//   and its `event` list. It covers Colissimo, tracked mail, Chronopost and
//   Delivengo, which is why those carriers share this adapter.
// - The response is matched on `shipment.idShip`: a feed entry for another
//   number is refused rather than projected.
// - `returnCode` 104 is the positive "unknown shipment"; any other non-zero
//   code is an inconclusive provider failure.
// - Production HTTP 403s carried La Poste's "Site indisponible - Incident en
//   cours" page and immediately following checks succeeded, so a 403 is
//   retried twice inside the original deadline (see README.md).
const TRACKING_API = 'https://www.laposte.fr/ssu/sun/back/suivi-unifie';
const TRACKING_PAGE = 'https://www.laposte.fr/outils/suivre-vos-envois';
const TIMEZONE = 'Europe/Paris';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_EVENTS_TO_RETURN = 100;
/** The provider's "unknown shipment" return code. */
const UNKNOWN_SHIPMENT_CODE = 104;

function number(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null;
  const parsed = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function records(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function eventOrder(event: JsonObject): number {
  return number(event.order) ?? -1;
}

/**
 * Event timestamps already carry their Paris offset, so the provider's own
 * string is retained verbatim; only calendar-impossible values are dropped.
 */
function safeDate(value: unknown): string {
  const raw = clean(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ][0-9:+.Z-]+)?$/i.test(raw)) return '';
  return isoTime(raw, TIMEZONE) ? raw : '';
}

function expectedDate(value: unknown): string | null {
  const text = safeDate(value);
  return /^\d{4}-\d{2}-\d{2}/.exec(text)?.[0] ?? null;
}

/**
 * A provider `returnCode` that is not a success. Code 104 is a positive
 * not-found; anything else only proves the feed could not answer.
 */
export class LaPosteTrackingError extends CarrierError {
  readonly code: number | null;

  constructor(code: number | null) {
    super(
      code === UNKNOWN_SHIPMENT_CODE ? 'not_found' : 'indeterminate',
      'La Poste',
      code === UNKNOWN_SHIPMENT_CODE
        ? 'La Poste could not locate the shipment'
        : 'La Poste tracking is unavailable',
    );
    this.name = 'LaPosteTrackingError';
    this.code = code;
  }
}

export function normalizeLaPosteTrackingNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  const domestic = /^[A-Z0-9]{2}\d{11}$/.test(value);
  const international = /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(value);
  const foreignExpress = /^\d{14}[A-Z]$/.test(value);
  if (!domestic && !international && !foreignExpress) {
    throw new TypeError('La Poste tracking numbers must use a supported 13- or 15-character format');
  }
  return value;
}

export function laPosteTrackingUrl(trackingNumber: string): string {
  const url = new URL(TRACKING_PAGE);
  url.searchParams.set('code', normalizeLaPosteTrackingNumber(trackingNumber));
  return url.toString();
}

export function laPosteTrackingApiUrl(trackingNumber: string): string {
  const normalized = normalizeLaPosteTrackingNumber(trackingNumber);
  const url = new URL(`${TRACKING_API}/${encodeURIComponent(normalized)}`);
  url.searchParams.set('lang', 'fr');
  return url.toString();
}

export function parseLaPosteTrackingResponse(
  payload: unknown,
  trackingNumber: string,
): CarrierResult {
  const requested = normalizeLaPosteTrackingNumber(trackingNumber);
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new SchemaError('La Poste', 'La Poste returned an invalid tracking response');
  }

  const responses = payload.filter(isRecord);
  if (responses.length === 0) {
    throw new SchemaError('La Poste', 'La Poste returned an invalid tracking response');
  }
  const response = responses.find((candidate) => {
    const shipment = isRecord(candidate.shipment) ? candidate.shipment : {};
    return clean(shipment.idShip, 64).toLocaleUpperCase('en-US') === requested;
  });
  if (!response) {
    const providerError = responses.find((candidate) => ![0, 200].includes(number(candidate.returnCode) ?? -1));
    if (providerError) {
      throw new LaPosteTrackingError(number(providerError.returnCode));
    }
    throw new SchemaError('La Poste', 'La Poste returned a different shipment');
  }

  const returnCode = number(response.returnCode);
  if (returnCode === null || ![0, 200].includes(returnCode)) {
    throw new LaPosteTrackingError(returnCode);
  }
  const shipment = isRecord(response.shipment) ? response.shipment : {};
  const rawEvents = records(shipment.event).sort((left, right) => {
    const orderDifference = eventOrder(right) - eventOrder(left);
    if (orderDifference !== 0) return orderDifference;
    return safeDate(right.date).localeCompare(safeDate(left.date));
  });
  // Projection allowlist: nothing but status wording, time, coarse location and
  // the provider's own codes leaves this function. Recipient blocks, addresses
  // and proof-of-delivery fields in the payload are never read.
  const events: CarrierEvent[] = rawEvents.slice(0, MAX_EVENTS_TO_RETURN).flatMap((event) => {
    const description = clean(event.label);
    const time = safeDate(event.date);
    if (!description && !time) return [];
    const group = clean(event.group, 40).toLocaleUpperCase('en-US');
    const code = clean(event.code, 40).toLocaleUpperCase('en-US');
    return [{
      time,
      location: clean(event.country, 80),
      description: description || 'Tracking update',
      stage: eventStage(group, code, description),
      ...(group || code ? { provider_code: [group, code].filter(Boolean).join('/') } : {}),
    }];
  });

  const latestRaw = rawEvents[0] ?? {};
  const latest = events[0];
  const timeline = records(shipment.timeline)
    .filter((step) => step.status === true)
    .sort((left, right) => (number(right.id) ?? -1) - (number(left.id) ?? -1));
  const currentState = isRecord(shipment.currentState) ? shipment.currentState : {};
  const fallbackLabel = clean(currentState.shortLabel) || clean(timeline[0]?.shortLabel);
  const latestLabel = latest?.description || fallbackLabel || clean(response.returnMessage);
  const latestGroup = clean(latestRaw.group, 40);
  const latestCode = clean(latestRaw.code, 40);
  return {
    status: eventStatus(latestGroup, latestCode, latestLabel, events.length > 0),
    last_status_text: latestLabel || 'Tracking information received',
    last_update: latest?.time || safeDate(timeline[0]?.date) || null,
    expected_delivery: shipment.isFinal === true ? null : expectedDate(shipment.estimDate),
    timezone: TIMEZONE,
    events,
  };
}

export interface LaPosteTrackerOptions {
  timeoutMs?: number;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
}

export class LaPosteTracker {
  readonly timeoutMs: number;
  private readonly fetcher?: typeof fetch;
  private readonly recorder?: StepRecorder;

  constructor(options: LaPosteTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('La Poste timeout must be positive');
    }
    this.fetcher = options.fetcher;
    this.recorder = options.recorder;
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const normalized = normalizeLaPosteTrackingNumber(trackingNumber);
    const deadline = performance.now() + this.timeoutMs;
    const request = async (remainingMs: number): Promise<CarrierResult> => {
      const { bytes } = await fetchBounded(laPosteTrackingApiUrl(normalized), {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'fr-FR,fr;q=0.9',
          Referer: laPosteTrackingUrl(normalized),
          'User-Agent': 'Mozilla/5.0 (compatible; SwissDeliveryTracker/1.0)',
        },
      }, {
        provider: 'La Poste tracking',
        timeoutMs: Math.max(1, Math.floor(remainingMs)),
        maxBytes: MAX_RESPONSE_BYTES,
        fetcher: this.fetcher,
      });
      return parseLaPosteTrackingResponse(parseJsonBytes(bytes, 'La Poste'), normalized);
    };
    // Production 403s contained La Poste's "Site indisponible - Incident en
    // cours" page and subsequent checks succeeded. Give this transient
    // rejection two immediate retries before universal fallback, sharing the
    // original deadline; do not retry other HTTP or parsing failures. Once the
    // deadline is spent the retry is refused, so the caller still sees the
    // provider's own rejection rather than a budget error.
    const retriable = (error: unknown): boolean => error instanceof UpstreamHttpError
      && error.status === 403
      && deadline - performance.now() >= 1;
    const retry: StepSpec<CarrierResult> = {
      id: 'retry',
      recovers: retriable,
      run: ({ remainingMs }) => request(remainingMs),
    };
    return await runSteps<CarrierResult>({
      carrier: 'la-poste', budgetMs: this.timeoutMs, recorder: this.recorder,
    }, [
      { id: 'direct', run: ({ remainingMs }) => request(remainingMs) },
      retry,
      { ...retry },
    ]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new LaPosteTracker({
    fetcher: environment.fetcher,
    recorder: environment.recorder,
  });
  return {
    id: 'la-poste',
    // One keyless request, then up to two immediate retries of the same
    // request after a transient HTTP 403, inside the original deadline.
    steps: ['direct', 'retry'],
    track: (input) => tracker.fetch(input.number),
  };
};
