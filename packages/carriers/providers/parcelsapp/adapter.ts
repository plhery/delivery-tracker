import 'server-only';

/**
 * ParcelsApp (parcelsapp.com), a universal aggregator used as the second
 * discovery provider.
 *
 * Transport: the browser service loads the public tracking page and captures
 * the page's own `/api/v2/parcels` response; the page builds protected request
 * fields, and a plain HTML GET returns the application shell rather than
 * established history (verified 2026-09-10). The response omits the tracking
 * number, so every result is bound to the number rendered in the page's own
 * result table. When no API body is readable, the rendered history is parsed
 * instead.
 */
import { load } from 'cheerio';
import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { StepRecorder } from '../../core/telemetry';
import type { TrawlClient } from '../../core/transport';
import { isRecord } from '../../core/types';
import { capturedBodies, loadCapture, type CaptureSpec } from '../shared/capture';
import { event, isNotice, numberOf, result, type UniversalSource } from '../shared/result';

const SOURCE: UniversalSource = 'ParcelsApp';
const API_URL = 'https://parcelsapp.com/api/v2/parcels';
const MAX_EVENTS = 1000;

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
  return result(events, SOURCE);
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
}

export class ParcelsAppTracker {
  constructor(readonly options: ParcelsAppOptions = {}) {}

  async fetch(trackingNumber: string, budgetMs = this.options.timeoutMs ?? 30_000): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    return runSteps({ carrier: SOURCE, budgetMs, recorder: this.options.recorder }, [{
      id: 'trawl',
      run: async ({ remainingMs }) => {
        const capture: CaptureSpec = {
          source: SOURCE, url: `https://parcelsapp.com/en/tracking/${number}`, apiUrl: API_URL,
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
    steps: ['trawl'],
    track: (input, context) => tracker.fetch(input.number, context?.budgetMs),
  };
};
