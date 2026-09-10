import 'server-only';

import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { fetchBounded, parseJsonBytes } from './boundedFetch';
import type { CarrierEvent, CarrierResult } from './carrierResult';
import { isRecord } from './types';
import { event, isNotice, numberOf, result, type UniversalSource as Source } from './universalTrackingResult';
import { PostalNinjaTracker } from './postalNinja';
import { Ship24Tracker } from './ship24';
const SOURCES: Source[] = ['17TRACK', 'ParcelsApp', 'Ship24', 'Postal Ninja'];
const API_URLS = {
  '17TRACK': 'https://t.17track.net/track/restapi',
  ParcelsApp: 'https://parcelsapp.com/api/v2/parcels',
};
interface SourceFailure {
  source: Source;
  reason: string;
  error: unknown;
}

export class UniversalTrackingError extends AggregateError {
  constructor(readonly failures: ReadonlyArray<SourceFailure>) {
    super(failures.map(({ error }) => error), `Automatic carrier lookup could not retrieve tracking history. ${failures.map(
      ({ source, reason }) => `${source}: ${reason}`,
    ).join('; ')}`);
    this.name = 'UniversalTrackingError';
  }
}

export function parse17TrackResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = numberOf(trackingNumber);
  if (!isRecord(payload) || !isRecord(payload.meta) || payload.meta.code !== 200
    || !Array.isArray(payload.shipments)) throw new TypeError('17TRACK lookup unavailable');
  const matches = payload.shipments.filter((s) => isRecord(s) && s.number === number);
  if (matches.length !== 1 || !isRecord(matches[0]) || matches[0].code !== 200
    || !isRecord(matches[0].shipment)) throw new TypeError('17TRACK has no matching shipment history');
  const shipment = matches[0].shipment;
  const tracking = shipment.tracking;
  if (!isRecord(tracking) || !Array.isArray(tracking.providers) || tracking.providers.length > 20) {
    throw new TypeError('17TRACK returned invalid providers');
  }
  const events: CarrierEvent[] = [];
  let count = 0;
  for (const provider of tracking.providers) {
    if (!isRecord(provider) || !Array.isArray(provider.events)) continue;
    for (const raw of provider.events) {
      if (++count > 1000 || !isRecord(raw)) throw new TypeError('17TRACK returned invalid events');
      const parsed = event(raw.time_utc ?? raw.time_iso, raw.description, raw.stage);
      if (parsed) events.push(parsed);
    }
  }
  return result(events, '17TRACK');
}

// ParcelsApp's response omits the number. Bind it to the rendered result's
// tracking-number row, never merely to the input field or the requested URL.
function parcelsIdentity(html: string, number: string): boolean {
  const $ = load(html);
  const rows = $('.tracking-info .parcel .parcel-attributes tr').filter((_, row) =>
    $(row).children('td').first().text().trim() === 'Tracking number');
  return rows.length === 1 && rows.first().children('td').eq(1).text().trim() === number;
}

export function parseParcelsAppResponse(payload: unknown, trackingNumber: string, html: string): CarrierResult {
  if (!parcelsIdentity(html, numberOf(trackingNumber))) throw new TypeError('ParcelsApp shipment identity missing');
  if (!isRecord(payload) || payload.error || !Array.isArray(payload.states) || payload.states.length > 1000) {
    throw new TypeError('ParcelsApp lookup unavailable');
  }
  const events: CarrierEvent[] = [];
  for (const raw of payload.states) {
    if (!isRecord(raw)) throw new TypeError('ParcelsApp returned an invalid event');
    if (raw.require_fields || raw.error) continue;
    const parsed = event(raw.date, raw.status);
    if (parsed) events.push(parsed);
  }
  return result(events, 'ParcelsApp');
}

export function parseParcelsAppHtml(html: string, trackingNumber: string): CarrierResult {
  if (!parcelsIdentity(html, numberOf(trackingNumber))) throw new TypeError('ParcelsApp shipment identity missing');
  const $ = load(html);
  const nodes = $('.tracking-info .parcel .events > .event');
  if (nodes.length > 1000) throw new TypeError('ParcelsApp returned too many events');
  const events: CarrierEvent[] = [];
  nodes.each((_, node) => {
    const row = $(node);
    if (row.find('input, select, form').length) return;
    const description = row.find('.event-content > strong').first().text();
    if (isNotice(description)) return;
    const date = row.find('.event-time > strong').text().trim();
    const time = row.find('.event-time > span').text().trim();
    // The English web app renders the UTC values of its API, verified against
    // the live JSON on 2026-09-08. Do not use the machine's local timezone.
    const stamp = DateTime.fromFormat(`${date} ${time}`, 'dd LLL yyyy HH:mm', { locale: 'en', zone: 'UTC' });
    if (!stamp.isValid) throw new TypeError('ParcelsApp returned an invalid event date');
    const parsed = event(stamp.toISO(), description);
    if (parsed) events.push(parsed);
  });
  return result(events, 'ParcelsApp');
}

function pageUrl(source: '17TRACK' | 'ParcelsApp', number: string): string {
  return source === '17TRACK' ? `https://t.17track.net/en#nums=${number}`
    : `https://parcelsapp.com/en/tracking/${number}`;
}

export class UniversalTracker {
  constructor(readonly options: {
    trawlUrl?: string;
    timeoutMs?: number;
    fetcher?: typeof fetch;
    executablePath?: string;
    browserLookup?: (source: 'Postal Ninja' | 'Ship24', number: string) => Promise<CarrierResult>;
  } = {}) {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new TypeError('Universal tracking timeout must be positive');
    }
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    const configured = this.options.trawlUrl ?? process.env.FLARESOLVERR_URL;
    const endpoint = configured ? new URL(configured) : null;
    if (endpoint) {
      endpoint.pathname = `${endpoint.pathname.replace(/\/(?:v1|scrape)\/?$/, '').replace(/\/$/, '')}/scrape`;
      endpoint.search = ''; endpoint.hash = '';
    }
    const failures: SourceFailure[] = [];
    for (const source of SOURCES) {
      try {
        if (source === 'Postal Ninja' || source === 'Ship24') {
          if (this.options.browserLookup) return await this.options.browserLookup(source, number);
          const tracker = source === 'Postal Ninja' ? new PostalNinjaTracker(this.options) : new Ship24Tracker(this.options);
          return await tracker.fetch(number);
        }
        if (!endpoint) throw new Error('Automatic carrier lookup requires the tracking browser service');
        const url = pageUrl(source, number);
        const { bytes } = await fetchBounded(endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url, skipHttp: true, maxTier: 3, maxTimeout: this.options.timeoutMs ?? 45_000,
            captureResponses: [API_URLS[source]], settleTimeout: 15_000,
          }),
        }, { provider: `${source} tracking browser`, fetcher: this.options.fetcher,
          timeoutMs: (this.options.timeoutMs ?? 45_000) + 5000, maxBytes: 10_000_000 });
        const payload = parseJsonBytes(bytes, `${source} tracking browser`);
        if (!isRecord(payload) || payload.error || payload.statusCode !== 200
          || ![2, 3].includes(Number(payload.tier)) || payload.url !== url || typeof payload.html !== 'string') {
          throw new TypeError('Tracking browser returned an incomplete page');
        }
        const responses = Array.isArray(payload.capturedResponses) ? payload.capturedResponses : [];
        for (const raw of responses.slice(0, 20).reverse()) {
          if (!isRecord(raw) || raw.url !== API_URLS[source] || raw.status !== 200
            || raw.truncated || raw.base64Encoded || typeof raw.body !== 'string') continue;
          try {
            const data: unknown = JSON.parse(raw.body);
            return source === '17TRACK' ? parse17TrackResponse(data, number)
              : parseParcelsAppResponse(data, number, payload.html);
          } catch {
            // Initial polling replies and unrelated/demo numbers are not history.
          }
        }
        if (source === 'ParcelsApp') return parseParcelsAppHtml(payload.html, number);
        throw new TypeError('No matching tracking response');
      } catch (error) {
        // Keep the user-facing summary readable and retain the original provider
        // errors for Sentry's AggregateError diagnostics.
        failures.push({ source, reason: 'history unavailable; try again later or open the tracking website', error });
      }
    }
    throw new UniversalTrackingError(failures);
  }
}
