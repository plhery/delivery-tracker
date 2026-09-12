import 'server-only';

/**
 * Ship24 (ship24.com), a universal aggregator and the first discovery
 * provider.
 *
 * Two tiers: `direct` is one signed anonymous JSON POST per lookup (see
 * http.ts), `browser` loads the public tracking page in a local Chromium
 * session and reads the same API response from it. The browser tier only runs
 * when the direct tier failed for a reason a browser can repair: a rate limit
 * or a server outage is reported as it is, so the router's backoff is not
 * amplified into a second request.
 */
import type { AdapterFactory } from '../../core/adapter';
import { SchemaError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { StepRecorder } from '../../core/telemetry';
import { scrapeUniversalPage, type UniversalBrowserOptions } from '../../core/transport/browser';
import { isRecord } from '../../core/types';
import { universalCarrierHints } from '../shared/hints';
import { localEvent, numberOf, result, type UniversalSource } from '../shared/result';
import { Ship24HttpClient } from './http';

const SOURCE: UniversalSource = 'Ship24';
const MAX_EVENTS = 1000;
const MAX_COURIERS = 20;
/** The direct tier's own share of the lookup budget; the browser keeps the rest. */
const DIRECT_BUDGET_MS = 8_000;

export function parseShip24Response(payload: unknown, trackingNumber: string): CarrierResult {
  const number = numberOf(trackingNumber);
  if (!isRecord(payload) || !isRecord(payload.data) || payload.data.tracking_number !== number
    || payload.data.error || !Array.isArray(payload.data.events) || payload.data.events.length > MAX_EVENTS) {
    throw new SchemaError(SOURCE, 'Ship24 has no matching shipment history');
  }
  const events: CarrierEvent[] = [];
  for (const raw of payload.data.events) {
    if (!isRecord(raw)) throw new SchemaError(SOURCE, 'Ship24 returned an invalid event');
    // datetime can end in Z while still containing the carrier's local time.
    // timestamp carries the real offset (verified against the public web app),
    // except for some carrier legs (Chronopost, observed 2026-09-11) that omit it
    // entirely. Keep those scans as local wall time rather than losing the shipment.
    const parsed = localEvent(raw.timestamp, raw.status, raw.dispatch_code_id === 7 ? 'Delivered' : undefined);
    if (parsed) events.push(parsed);
  }
  // The public frontend renders couriers[].translation.name. Keep names only;
  // website/phone fields and alternate numbers are not needed for discovery.
  const couriers = Array.isArray(payload.data.couriers) ? payload.data.couriers.slice(0, MAX_COURIERS) : [];
  return { ...result(events, SOURCE), ...universalCarrierHints(couriers.map((courier) =>
    isRecord(courier) && isRecord(courier.translation) ? courier.translation.name : undefined)) };
}

/**
 * A browser cannot repair a rate limit or a server outage: keep the original
 * status and Retry-After for the router's backoff instead of asking twice.
 */
function browserCanRecover(error: unknown): boolean {
  return !(error instanceof UpstreamHttpError && (error.status === 429 || error.status >= 500));
}

export interface Ship24Options extends UniversalBrowserOptions {
  /** The signed HTTP client for the direct tier; without one the browser tier runs alone. */
  httpClient?: Ship24HttpClient | null;
  recorder?: StepRecorder;
}

export class Ship24Tracker {
  constructor(readonly options: Ship24Options = {}) {}

  async fetch(trackingNumber: string, budgetMs?: number): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    const timeoutMs = budgetMs ?? this.options.timeoutMs ?? 45_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new TypeError('Ship24 timeout must be between 1 and 60000 ms');
    const http = this.options.httpClient ?? null;
    return runSteps({ carrier: SOURCE, budgetMs: timeoutMs, recorder: this.options.recorder }, [
      {
        id: 'direct',
        enabled: http !== null,
        run: async ({ remainingMs }) => ({
          ...parseShip24Response(await http!.fetch(number, Math.max(1, Math.min(DIRECT_BUDGET_MS, Math.floor(remainingMs)))), number),
          tracking_source: 'structured-web-response',
        }),
      },
      {
        id: 'browser',
        recovers: browserCanRecover,
        run: async ({ remainingMs }) => ({
          ...await scrapeUniversalPage({ executablePath: this.options.executablePath, timeoutMs: Math.max(1, Math.floor(remainingMs)) }, {
            name: SOURCE, url: `https://www.ship24.com/tracking?p=${number}`,
            responseUrl: `https://api.ship24.com/api/parcels/${number}?lang=en`,
          }, (payload) => parseShip24Response(payload, number)),
          tracking_source: 'browser-session-response',
        }),
      },
    ]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new Ship24Tracker({
    httpClient: new Ship24HttpClient(environment.fetcher),
    executablePath: environment.browserExecutablePath ?? undefined,
    recorder: environment.recorder,
  });
  return {
    id: SOURCE,
    steps: ['direct', 'browser'],
    track: (input, context) => tracker.fetch(input.number, context?.budgetMs),
  };
};
