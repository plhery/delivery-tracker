import 'server-only';

/**
 * Paack recipient tracking.
 *
 * The public page is a Remix application: one bounded GET with the order
 * number and the delivery postcode returns server-rendered HTML whose
 * `window.__remixContext` already holds the loader response for the tracking
 * route. Reading that embedded payload avoids a second, undocumented API call
 * and gives the same data the page itself renders. The order number the
 * response echoes is verified before anything else is read.
 *
 * A wrong number or postcode is answered with a redirect back to the form, or
 * with an explicit "order not found" message; both become a clean not-found.
 *
 * Privacy: the loader payload carries the retailer, the recipient's name,
 * e-mail, phone and address, and per-event `variables` that repeat them.
 * `parse()` copies nothing from those objects: each event is rebuilt from its
 * timestamp, our own description and the mapped stage, and the only order-level
 * fields read are the echoed identifier and the delivery window.
 */
import { load } from 'cheerio';
import type { AdapterFactory } from '../../core/adapter';
import { IndeterminateError, InputRequiredError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult, CarrierStatus } from '../../core/result';
import { decodeText, fetchBounded, UpstreamHttpError } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { classifyPaackEvent } from './status';

const TRACKING_ENDPOINT = 'https://mydeliveries.paack.app/tracking/order';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_EVENTS = 100;
const NOT_FOUND_PATTERN = /order not found|incorrect order number|commande introuvable|pedido no encontrado/i;
const NOT_FOUND_PAGE_PATTERN = /order not found|incorrect order number or postal code|commande introuvable|pedido no encontrado/i;

/**
 * Kept local rather than taken from core/time: the loader mixes epoch seconds,
 * epoch milliseconds and offset-bearing ISO strings in the same field, and the
 * result keeps millisecond precision (`toISOString()`), which the core helpers
 * deliberately suppress.
 */
function normalizedTimestamp(value: unknown): { iso: string; timestamp: number } | null {
  let timestamp: number;
  if (typeof value === 'number' && Number.isFinite(value)) {
    timestamp = value < 10_000_000_000 ? value * 1_000 : value;
  } else if (typeof value === 'string' && value.trim()) {
    timestamp = Date.parse(value.trim());
  } else {
    return null;
  }
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return { iso: date.toISOString(), timestamp: date.getTime() };
}

function normalizedDate(value: unknown): string | null {
  if (typeof value === 'string') {
    const candidate = value.trim();
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(candidate);
    if (match && !Number.isNaN(Date.parse(candidate))) return match[1];
  }
  return normalizedTimestamp(value)?.iso.slice(0, 10) ?? null;
}

function routeData(payload: unknown): JsonObject {
  if (!isRecord(payload)) throw new SchemaError('Paack', 'Paack returned an invalid tracking response');
  if (isRecord(payload.orderTrackData)) return payload;
  const state = payload.state;
  if (!isRecord(state) || !isRecord(state.loaderData)) {
    throw new SchemaError('Paack', 'Paack returned incomplete tracking details');
  }
  const route = state.loaderData['routes/tracking.order'];
  if (!isRecord(route)) throw new SchemaError('Paack', 'Paack returned incomplete tracking details');
  return route;
}

function errorText(payload: unknown): string {
  if (!isRecord(payload)) return '';
  return [payload.error, payload.message, payload.statusText]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

function remixContext(html: string): unknown {
  const $ = load(html);
  let serialized = '';
  $('script').each((_, element) => {
    if (serialized) return;
    const script = $(element).html() ?? '';
    const marker = 'window.__remixContext';
    const markerIndex = script.indexOf(marker);
    if (markerIndex < 0) return;
    const equalsIndex = script.indexOf('=', markerIndex + marker.length);
    if (equalsIndex < 0) return;
    serialized = script.slice(equalsIndex + 1).trim().replace(/;\s*$/, '');
  });
  if (!serialized) throw new SchemaError('Paack', 'Paack did not return tracking details');
  try {
    return JSON.parse(serialized);
  } catch (error) {
    throw new SchemaError('Paack', 'Paack returned an invalid tracking response', { cause: error });
  }
}

export function normalizePaackTrackingNumber(raw: string): string {
  const value = raw.trim().toLocaleUpperCase('en-US').replace(/\s/g, '');
  if (!/^(?=.*\d)[A-Z0-9]{4,40}$/.test(value)) {
    throw new TypeError(
      'Paack tracking numbers must contain 4 to 40 ASCII letters and digits, including at least one digit',
    );
  }
  return value;
}

export function normalizePaackPostcode(raw: string): string {
  const value = raw.trim().toLocaleUpperCase('en-US');
  if (!/^(?=.{3,10}$)(?=.*\d)[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/.test(value)) {
    throw new TypeError(
      'Paack tracking requires a 3- to 10-character alphanumeric delivery postcode',
    );
  }
  return value.replace(/\s+/g, '');
}

export function paackTrackingUrl(rawTrackingNumber: string, rawPostcode: string): string {
  const trackingNumber = normalizePaackTrackingNumber(rawTrackingNumber);
  const postcode = normalizePaackPostcode(rawPostcode);
  const url = new URL(TRACKING_ENDPOINT);
  url.searchParams.set('tracking_number', trackingNumber);
  url.searchParams.set('postal_code', postcode);
  return url.toString();
}

export function parsePaackTrackingResponse(
  payload: unknown,
  rawTrackingNumber: string,
): CarrierResult {
  const trackingNumber = normalizePaackTrackingNumber(rawTrackingNumber);
  if (NOT_FOUND_PATTERN.test(errorText(payload))) throw new NotFoundError('Paack');
  const route = routeData(payload);
  if (NOT_FOUND_PATTERN.test(errorText(route))) throw new NotFoundError('Paack');

  const order = route.orderTrackData;
  if (!isRecord(order)) throw new SchemaError('Paack', 'Paack returned incomplete tracking details');
  const responseNumber = typeof order.external_id === 'string'
    ? normalizePaackTrackingNumber(order.external_id)
    : '';
  if (!responseNumber) throw new SchemaError('Paack', 'Paack returned an invalid shipment number');
  if (responseNumber !== trackingNumber) {
    throw new SchemaError('Paack', 'Paack returned a different shipment');
  }

  const rawEvents = Array.isArray(route.eventList) ? route.eventList : [];
  const parsedEvents: Array<{
    event: CarrierEvent;
    status: CarrierStatus;
    timestamp: number;
    sourceIndex: number;
  }> = [];
  rawEvents.slice(0, 500).forEach((rawEvent, sourceIndex) => {
    if (!isRecord(rawEvent) || rawEvent.timeline === false) return;
    const classified = classifyPaackEvent(rawEvent);
    const time = normalizedTimestamp(rawEvent.timestamp ?? rawEvent.time);
    if (!time) return;
    parsedEvents.push({
      event: {
        time: time.iso,
        description: classified.description,
        stage: classified.stage,
      },
      status: classified.status,
      timestamp: time.timestamp,
      sourceIndex,
    });
  });
  parsedEvents.sort((left, right) => (
    right.timestamp - left.timestamp || left.sourceIndex - right.sourceIndex
  ));
  const events = parsedEvents.slice(0, MAX_EVENTS).map(({ event }) => event);
  const activeEvent = isRecord(route.activeEvent) ? route.activeEvent : null;
  const active = activeEvent ? classifyPaackEvent(activeEvent) : null;
  const latest = parsedEvents.find((event) => event.status !== 'unknown');
  const current = active && active.status !== 'unknown'
    ? active
    : latest && {
      status: latest.status,
      stage: latest.event.stage ?? 'in_transit',
      description: latest.event.description ?? 'Shipment update',
    };
  if (!current) throw new SchemaError('Paack', 'Paack returned incomplete tracking details');
  const activeTime = activeEvent
    ? normalizedTimestamp(activeEvent.timestamp ?? activeEvent.time)
    : null;

  const expected = isRecord(order.expected_delivery_ts)
    ? normalizedDate(order.expected_delivery_ts.end ?? order.expected_delivery_ts.start)
    : null;
  return {
    status: current.status,
    current_stage: current.stage,
    last_status_text: current.description,
    last_update: activeTime?.iso ?? events[0]?.time ?? null,
    expected_delivery: ['delivered', 'exception'].includes(current.status) ? null : expected,
    timezone: 'Europe/Paris',
    events,
  };
}

export function parsePaackTrackingHtml(html: string, rawTrackingNumber: string): CarrierResult {
  // An empty body proves nothing about the shipment, so it stays indeterminate.
  if (!html.trim()) throw new IndeterminateError('Paack', 'Paack returned an empty tracking response');
  if (NOT_FOUND_PAGE_PATTERN.test(html)) throw new NotFoundError('Paack');
  return parsePaackTrackingResponse(remixContext(html), rawTrackingNumber);
}

export interface PaackTrackerOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

export class PaackTracker {
  readonly timeoutMs: number;
  readonly fetcher?: typeof fetch;

  constructor(options: PaackTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Paack timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string, rawPostcode: string): Promise<CarrierResult> {
    const trackingNumber = normalizePaackTrackingNumber(rawTrackingNumber);
    const postcode = normalizePaackPostcode(rawPostcode);
    const { response, bytes } = await fetchBounded(paackTrackingUrl(trackingNumber, postcode), {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
      },
    }, {
      provider: 'Paack tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      redirect: 'manual',
      fetcher: this.fetcher,
      allowHttpError: true,
    });

    if (response.status === 404 || (response.status >= 300 && response.status < 400)) {
      throw new NotFoundError('Paack');
    }
    if (!response.ok) throw new UpstreamHttpError('Paack tracking', response.status);
    return parsePaackTrackingHtml(decodeText(bytes), trackingNumber);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PaackTracker({ fetcher: environment.fetcher });
  return {
    id: 'paack',
    steps: ['direct'],
    track: async (input) => {
      const postcode = input.postcode?.trim() ?? '';
      if (!postcode) throw new InputRequiredError('Paack', 'the delivery postcode');
      return tracker.fetch(input.number, postcode);
    },
  };
};
