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
import type { AdapterFactory } from '../../core/adapter';
import { carrierErrorKind, ChallengeError, IndeterminateError, InputRequiredError, SchemaError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { StepRecorder } from '../../core/telemetry';
import type { TrawlClient } from '../../core/transport';
import { isRecord } from '../../core/types';
import { capturedBodies, loadCapture, type CaptureSpec } from '../shared/capture';
import { event, isNotice, numberOf, result, type UniversalSource } from '../shared/result';
import { PARCELSAPP_API, ParcelsAppHttpClient } from './http';

const SOURCE: UniversalSource = 'ParcelsApp';
const MAX_EVENTS = 1000;
const DIRECT_BUDGET_MS = 10_000;

// ParcelsApp's response omits the number. Bind it to the rendered result's
// tracking-number row, never merely to the input field or the requested URL.
function parcelsIdentity(html: string, number: string): boolean {
  const $ = load(html);
  const rows = $('.tracking-info .parcel .parcel-attributes tr').filter((_, row) =>
    $(row).children('td').first().text().trim() === 'Tracking number');
  return rows.length === 1 && rows.first().children('td').eq(1).text().trim() === number;
}

export function parseParcelsAppResponse(payload: unknown, trackingNumber: string, html: string): CarrierResult {
  if (!parcelsIdentity(html, numberOf(trackingNumber))) throw new SchemaError(SOURCE, 'ParcelsApp shipment identity missing');
  return parseHistory(payload);
}

function parseHistory(payload: unknown): CarrierResult {
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
    const parsed = event(raw.date, raw.status);
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
  // A second lookup cannot repair missing input, rate limiting or an outage.
  if (error instanceof UpstreamHttpError && (error.status === 429 || error.status >= 500)) return false;
  const kind = carrierErrorKind(error);
  return kind === null || kind === 'challenge' || kind === 'transport' || kind === 'schema';
}

export function parseParcelsAppHtml(html: string, trackingNumber: string): CarrierResult {
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
    // The English web app renders the UTC values of its API, verified against
    // the live JSON on 2026-09-08. Do not use the machine's local timezone.
    const stamp = DateTime.fromFormat(`${date} ${time}`, 'dd LLL yyyy HH:mm', { locale: 'en', zone: 'UTC' });
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

  async fetch(trackingNumber: string, budgetMs = this.options.timeoutMs ?? 30_000, postcode?: string | null): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    if (!Number.isFinite(budgetMs) || budgetMs < 1) throw new TypeError('ParcelsApp timeout must be positive');
    return runSteps({ carrier: SOURCE, budgetMs, recorder: this.options.recorder }, [{
      id: 'direct',
      enabled: this.http !== null,
      run: async ({ remainingMs }) => {
        const payload = await this.http!.fetch(number, Math.max(1, Math.min(DIRECT_BUDGET_MS, Math.floor(remainingMs))), postcode);
        // This endpoint returns one shipment per POST, synchronously, with no
        // shared session or polling handle. Bind only this response to that
        // request. Never give numberless browser captures this exemption.
        if (isRecord(payload) && payload.correctId && payload.correctId !== number) {
          throw new SchemaError(SOURCE, 'ParcelsApp returned an unverified tracking alias');
        }
        return { ...parseHistory(payload), tracking_source: 'structured-web-response' };
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
            return parseParcelsAppResponse(JSON.parse(body), number, page.html);
          } catch {
            // Polling replies, unrelated numbers and demo shipments are not history.
          }
        }
        // The rendered page carries the same history when no body was readable.
        return parseParcelsAppHtml(page.html, number);
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
    steps: ['direct', 'trawl'],
    track: (input, context) => tracker.fetch(input.number, context?.budgetMs, input.postcode),
  };
};
