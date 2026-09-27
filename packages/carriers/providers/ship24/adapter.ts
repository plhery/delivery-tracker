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
 * amplified into a second request, and a number the aggregator does not know
 * stays unknown to the page that asks the same API.
 */
import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { carrierTimezone } from '../../core/catalog';
import { brandTimeZones, carrierIdFromName, carrierNameCountryZone } from '../../core/catalog/hints';
import { SchemaError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { StepRecorder } from '../../core/telemetry';
import { scrapeUniversalPage, type UniversalBrowserOptions } from '../../core/transport/browser';
import { countryTimeZone, sharedClockZone } from '../../core/time';
import { isRecord } from '../../core/types';
import { brandCarrierForNumber, universalCarrierHints } from '../shared/hints';
import { localEvent, numberOf, result, type UniversalSource } from '../shared/result';
import { Ship24HttpClient } from './http';

const SOURCE: UniversalSource = 'Ship24';
const MAX_EVENTS = 1000;
const MAX_COURIERS = 20;
/** The direct tier's own share of the lookup budget; the browser keeps the rest. */
const DIRECT_BUDGET_MS = 8_000;

/** A courier name's clock: its catalog carrier's, the country it names, or its brand's shared one. */
function courierZones(name: string, number: string, wall: string): string | null {
  const carrier = carrierIdFromName(name) ?? brandCarrierForNumber(name, number);
  const zone = carrier ? carrierTimezone(carrier) : 'UTC';
  if (zone !== 'UTC') return zone;
  return carrierNameCountryZone(name) ?? sharedClockZone(brandTimeZones(name), wall);
}

/**
 * The zone of a scan whose timestamp names no offset: it is the scanning
 * carrier's wall clock. Read it in the clock every courier the reply names
 * keeps at that moment (La Poste and its Chronopost leg), else the scan
 * location's country, else the zone routing passes for the parcel's carrier.
 * With none of them it stays a wall time, which the timeline cannot place.
 */
function wallZone(couriers: string[], location: unknown, number: string, wall: string, fallback: string | null): string | null {
  const zones = couriers.map((name) => courierZones(name, number, wall));
  const named = zones.length && zones.every((zone): zone is string => zone !== null) ? sharedClockZone(zones, wall) : null;
  if (named) return named;
  const country = typeof location === 'string' ? location.split(',').at(-1) : undefined;
  return countryTimeZone(country) ?? fallback;
}

export function parseShip24Response(payload: unknown, trackingNumber: string, timezone: string | null = null): CarrierResult {
  const number = numberOf(trackingNumber);
  if (!isRecord(payload) || !isRecord(payload.data) || payload.data.tracking_number !== number
    || payload.data.error || !Array.isArray(payload.data.events) || payload.data.events.length > MAX_EVENTS) {
    throw new SchemaError(SOURCE, 'Ship24 has no matching shipment history');
  }
  // The public frontend renders couriers[].translation.name. Keep names only;
  // website/phone fields and alternate numbers are not needed for discovery.
  const couriers = Array.isArray(payload.data.couriers) ? payload.data.couriers.slice(0, MAX_COURIERS) : [];
  const names = universalCarrierHints(couriers.map((courier) =>
    isRecord(courier) && isRecord(courier.translation) ? courier.translation.name : undefined), number);
  const events: CarrierEvent[] = [];
  for (const raw of payload.data.events) {
    if (!isRecord(raw)) throw new SchemaError(SOURCE, 'Ship24 returned an invalid event');
    // datetime can end in Z while still containing the carrier's local time.
    // timestamp carries the real offset (verified against the public web app),
    // except for some carrier legs (Chronopost) that omit it entirely.
    const parsed = localEvent(raw.timestamp, raw.status, raw.dispatch_code_id === 7 ? 'Delivered' : undefined);
    if (!parsed) continue;
    const wall = typeof parsed.local_time === 'string' ? parsed.local_time : null;
    const zone = wall ? wallZone(names.reported_carriers, raw.location, number, wall, timezone) : null;
    const instant = wall && zone ? DateTime.fromISO(wall, { zone }) : null;
    if (instant?.isValid) {
      const timed: CarrierEvent = { ...parsed, time: instant.toUTC().toISO()! };
      delete timed.local_time;
      events.push(timed);
    } else events.push(parsed);
  }
  return { ...result(events, SOURCE), ...names };
}

/**
 * A browser cannot repair a rate limit or a server outage: keep the original
 * status and Retry-After for the router's backoff instead of asking twice.
 * Nor can it find a parcel the API answered 404 for: the page waits for the
 * same reply, so every such fallback only burned the rest of the budget.
 */
function browserCanRecover(error: unknown): boolean {
  return !(error instanceof UpstreamHttpError
    && (error.status === 404 || error.status === 410 || error.status === 429 || error.status >= 500));
}

export interface Ship24Options extends UniversalBrowserOptions {
  /** The signed HTTP client for the direct tier; without one the browser tier runs alone. */
  httpClient?: Ship24HttpClient | null;
  recorder?: StepRecorder;
}

export class Ship24Tracker {
  constructor(readonly options: Ship24Options = {}) {}

  async fetch(trackingNumber: string, budgetMs?: number, timezone: string | null = null): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    const timeoutMs = budgetMs ?? this.options.timeoutMs ?? 45_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new TypeError('Ship24 timeout must be between 1 and 60000 ms');
    const http = this.options.httpClient ?? null;
    return runSteps({ carrier: SOURCE, budgetMs: timeoutMs, recorder: this.options.recorder }, [
      {
        id: 'direct',
        enabled: http !== null,
        run: async ({ remainingMs }) => ({
          ...parseShip24Response(await http!.fetch(number, Math.max(1, Math.min(DIRECT_BUDGET_MS, Math.floor(remainingMs)))), number, timezone),
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
          }, (payload) => parseShip24Response(payload, number, timezone)),
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
    track: (input, context) => tracker.fetch(input.number, context?.budgetMs, input.timezone ?? null),
  };
};
