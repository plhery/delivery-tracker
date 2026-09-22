import 'server-only';

/**
 * ParcelsApp (parcelsapp.com), a universal aggregator used as the second
 * discovery provider.
 *
 * Transport: a scoped anonymous POST reproduces the public frontend checksum
 * and submits the stored delivery postcode. Browser capture remains recovery
 * for protocol challenges. Numberless direct replies belong to their single
 * POST; captured replies still require the rendered result's identity.
 */
import { load } from 'cheerio';
import { DateTime } from 'luxon';
import timers from 'node:timers/promises';
import type { AdapterFactory } from '../../core/adapter';
import { carrierTimezone } from '../../core/catalog';
import { carrierIdFromName } from '../../core/catalog/hints';
import { carrierErrorKind, ChallengeError, IndeterminateError, InputRequiredError, SchemaError, UpstreamHttpError, UpstreamNetworkError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { StepRecorder } from '../../core/telemetry';
import { countryTimeZone, mislabeledLocalTime } from '../../core/time';
import type { TrawlClient } from '../../core/transport';
import { isRecord } from '../../core/types';
import { capturedBodies, loadCapture, type CaptureSpec } from '../shared/capture';
import { event, isNotice, numberOf, result, type UniversalSource } from '../shared/result';
import { PARCELSAPP_API, ParcelsAppHttpClient } from './http';

const SOURCE: UniversalSource = 'ParcelsApp';
const MAX_EVENTS = 1000;
export const PARCELSAPP_BUDGET_MS = 45_000;
const DIRECT_BUDGET_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

// ParcelsApp's response omits the number. Bind it to the rendered result's
// tracking-number row, never merely to the input field or the requested URL.
function parcelsIdentity(html: string, number: string): boolean {
  const $ = load(html);
  const rows = $('.tracking-info .parcel .parcel-attributes tr').filter((_, row) =>
    $(row).children('td').first().text().trim() === 'Tracking number');
  return rows.length === 1 && rows.first().children('td').eq(1).text().trim() === number;
}

export function parseParcelsAppResponse(payload: unknown, trackingNumber: string, html: string, timezone: string | null = null): CarrierResult {
  if (!parcelsIdentity(html, numberOf(trackingNumber))) throw new SchemaError(SOURCE, 'ParcelsApp shipment identity missing');
  return parseHistory(payload, timezone);
}

/**
 * ParcelsApp's `date` is the scan's local clock, labeled as UTC or shifted
 * into an offset of its own: a DPD scan at 14:05+02:00 arrives as
 * "14:05+00:00", a Swiss Post delivery at 11:30 local as "13:30+02:00"
 * (both shapes checked 2026-09-22). Its UTC digits are re-read in
 * the zone of the scan's carrier, else its location's country, else the zone
 * of the carrier the parcel is filed under. Without one it stays as labeled.
 */
function scanZone(payload: Record<string, unknown>, state: Record<string, unknown>, fallback: string | null): string | null {
  const carriers = Array.isArray(payload.carriers) ? payload.carriers : [];
  const name = typeof state.carrier === 'number' ? carriers[state.carrier] : undefined;
  const carrier = typeof name === 'string' ? carrierIdFromName(name) : undefined;
  const zone = carrier ? carrierTimezone(carrier) : 'UTC';
  if (zone !== 'UTC') return zone;
  const country = typeof state.location === 'string' ? state.location.split(',').at(-1) : undefined;
  return countryTimeZone(country) ?? fallback;
}

function parseHistory(payload: unknown, timezone: string | null = null): CarrierResult {
  if (isRecord(payload) && payload.error === 'RELOAD') throw new ChallengeError(SOURCE);
  if (isRecord(payload) && (payload.error === 'NO_DATA' || payload.error === 'NO_TRACKER')) {
    throw new IndeterminateError(SOURCE, 'ParcelsApp has no usable shipment history');
  }
  if (!isRecord(payload) || payload.error || !Array.isArray(payload.states) || payload.states.length > MAX_EVENTS) {
    throw new SchemaError(SOURCE, 'ParcelsApp lookup unavailable');
  }
  const events: CarrierEvent[] = [];
  for (const raw of payload.states) {
    if (!isRecord(raw)) throw new SchemaError(SOURCE, 'ParcelsApp returned an invalid event');
    if (raw.require_fields || raw.error) continue;
    const zone = scanZone(payload, raw, timezone);
    const parsed = event((zone ? mislabeledLocalTime(raw.date, zone)?.iso : undefined) ?? raw.date, raw.status);
    if (parsed) events.push(parsed);
  }
  if (!events.length) {
    const fields = payload.states.flatMap((raw: unknown) => isRecord(raw) && Array.isArray(raw.require_fields) ? raw.require_fields : []);
    if (fields.some((field: unknown) => isRecord(field) && field.name === 'zipcode')) {
      throw new InputRequiredError(SOURCE, 'postcode', 'ParcelsApp requires a valid delivery postcode or further recipient information');
    }
    throw new IndeterminateError(SOURCE, 'No usable tracking events');
  }
  return result(events, SOURCE);
}

function browserCanRecover(error: unknown): boolean {
  // A slow uncached lookup needs more time on the same API. It has already
  // had one direct retry; a new browser lookup would repeat the work again.
  if (error instanceof UpstreamNetworkError) return false;
  // A second lookup cannot repair missing input, rate limiting or an outage.
  if (error instanceof UpstreamHttpError && (error.status === 429 || error.status >= 500)) return false;
  const kind = carrierErrorKind(error);
  return kind === null || kind === 'challenge' || kind === 'transport' || kind === 'schema';
}

export function parseParcelsAppHtml(html: string, trackingNumber: string, timezone: string | null = null): CarrierResult {
  if (!parcelsIdentity(html, numberOf(trackingNumber))) throw new SchemaError(SOURCE, 'ParcelsApp shipment identity missing');
  const $ = load(html);
  const nodes = $('.tracking-info .parcel .events > .event');
  if (nodes.length > MAX_EVENTS) throw new SchemaError(SOURCE, 'ParcelsApp returned too many events');
  const events: CarrierEvent[] = [];
  nodes.each((_, node) => {
    const row = $(node);
    if (row.find('input, select, form').length) return;
    const description = row.find('.event-content > strong').first().text();
    if (isNotice(description)) return;
    const date = row.find('.event-time > strong').text().trim();
    const time = row.find('.event-time > span').text().trim();
    // Notice rows ("No information about your package...") render a date with
    // an empty time. Skip them instead of failing the whole history.
    if (!time) return;
    // The English web app renders the UTC digits of its API (verified against
    // the live JSON on 2026-09-08), which are the scan's local clock. The page
    // names no carrier per scan: only the parcel's own carrier zone applies.
    const stamp = DateTime.fromFormat(`${date} ${time}`, 'dd LLL yyyy HH:mm', { locale: 'en', zone: timezone ?? 'UTC' });
    if (!stamp.isValid) throw new SchemaError(SOURCE, 'ParcelsApp returned an invalid event date');
    const parsed = event(stamp.toISO(), description);
    if (parsed) events.push(parsed);
  });
  return result(events, SOURCE);
}

export interface ParcelsAppOptions {
  trawl?: TrawlClient | null;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
  timeoutMs?: number;
  /** Null runs only the existing browser capture tier. */
  httpClient?: ParcelsAppHttpClient | null;
}

export class ParcelsAppTracker {
  private readonly http: ParcelsAppHttpClient | null;

  constructor(readonly options: ParcelsAppOptions = {}) {
    this.http = options.httpClient === undefined ? new ParcelsAppHttpClient(options.fetcher) : options.httpClient;
  }

  async fetch(trackingNumber: string, budgetMs = this.options.timeoutMs ?? PARCELSAPP_BUDGET_MS, postcode?: string | null, timezone: string | null = null): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    if (!Number.isFinite(budgetMs) || budgetMs < 1) throw new TypeError('ParcelsApp timeout must be positive');
    const deadline = performance.now() + budgetMs;
    const request = async (remainingMs: number): Promise<CarrierResult> => {
      const payload = await this.http!.fetch(number, Math.max(1, Math.min(DIRECT_BUDGET_MS, Math.floor(remainingMs))), postcode);
      // This endpoint returns one shipment per POST, synchronously, with no
      // shared session or polling handle. Each retry keeps its own request
      // binding. Numberless browser captures never get this exemption.
      if (isRecord(payload) && payload.correctId && payload.correctId !== number) {
        throw new SchemaError(SOURCE, 'ParcelsApp returned an unverified tracking alias');
      }
      return { ...parseHistory(payload, timezone), tracking_source: 'structured-web-response' };
    };
    return runSteps({ carrier: SOURCE, budgetMs, recorder: this.options.recorder }, [{
      id: 'direct',
      enabled: this.http !== null,
      run: ({ remainingMs }) => request(remainingMs),
    }, {
      id: 'retry',
      enabled: this.http !== null,
      // Uncached carrier aggregation can outlive a timed-out HTTP request.
      // Retry that replayable read once; responses such as NO_DATA, input
      // gates, aliases, challenges and HTTP errors do not qualify.
      recovers: (error) => error instanceof UpstreamNetworkError && deadline - performance.now() > RETRY_DELAY_MS + 1,
      run: async ({ signal }) => {
        await timers.setTimeout(RETRY_DELAY_MS, undefined, { signal });
        signal.throwIfAborted();
        return request(deadline - performance.now());
      },
    }, {
      id: 'trawl',
      enabled: this.options.trawl != null || this.http === null,
      recovers: browserCanRecover,
      run: async ({ remainingMs }) => {
        const capture: CaptureSpec = {
          source: SOURCE, url: `https://parcelsapp.com/en/tracking/${number}`, apiUrl: PARCELSAPP_API,
          budgetMs: remainingMs, fetcher: this.options.fetcher,
        };
        const page = await loadCapture(this.options.trawl ?? null, capture);
        for (const body of capturedBodies(page, capture)) {
          try {
            return parseParcelsAppResponse(JSON.parse(body), number, page.html, timezone);
          } catch {
            // Polling replies, unrelated numbers and demo shipments are not history.
          }
        }
        // The rendered page carries the same history when no body was readable.
        return parseParcelsAppHtml(page.html, number, timezone);
      },
    }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new ParcelsAppTracker({
    trawl: environment.trawl, fetcher: environment.fetcher, recorder: environment.recorder,
  });
  return {
    id: SOURCE,
    steps: ['direct', 'retry', 'trawl'],
    track: (input, context) => tracker.fetch(input.number, context?.budgetMs, input.postcode, input.timezone ?? null),
  };
};
