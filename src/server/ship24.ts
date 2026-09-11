import 'server-only';
import { measureScrape, recoverScrape } from './scrapeMonitoring';

import type { CarrierEvent, CarrierResult } from './carrierResult';
import { isRecord } from './types';
import { scrapeUniversalPage, type UniversalBrowserOptions } from './universalBrowser';
import { localEvent, numberOf, result } from './universalTrackingResult';
import { universalCarrierHints } from './universalCarrierHints';
import { UpstreamHttpError } from './boundedFetch';
import { ship24Http, type Ship24HttpClient } from './ship24Http';

export function parseShip24Response(payload: unknown, trackingNumber: string): CarrierResult {
  const number = numberOf(trackingNumber);
  if (!isRecord(payload) || !isRecord(payload.data) || payload.data.tracking_number !== number
    || payload.data.error || !Array.isArray(payload.data.events) || payload.data.events.length > 1000) {
    throw new TypeError('Ship24 has no matching shipment history');
  }
  const events: CarrierEvent[] = [];
  for (const raw of payload.data.events) {
    if (!isRecord(raw)) throw new TypeError('Ship24 returned an invalid event');
    // datetime can end in Z while still containing the carrier's local time.
    // timestamp carries the real offset (verified against the public web app),
    // except for some carrier legs (Chronopost, observed 2026-09-11) that omit it
    // entirely. Keep those scans as local wall time rather than losing the shipment.
    const parsed = localEvent(raw.timestamp, raw.status, raw.dispatch_code_id === 7 ? 'Delivered' : undefined);
    if (parsed) events.push(parsed);
  }
  // The public frontend renders couriers[].translation.name. Keep names only;
  // website/phone fields and alternate numbers are not needed for discovery.
  const couriers = Array.isArray(payload.data.couriers) ? payload.data.couriers.slice(0, 20) : [];
  return { ...result(events, 'Ship24'), ...universalCarrierHints(couriers.map((courier) =>
    isRecord(courier) && isRecord(courier.translation) ? courier.translation.name : undefined)) };
}

export class Ship24Tracker {
  constructor(readonly options: UniversalBrowserOptions & { httpClient?: Ship24HttpClient } = {}) {}

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    const timeoutMs = this.options.timeoutMs ?? 45_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new TypeError('Ship24 timeout must be between 1 and 60000 ms');
    const deadline = Date.now() + Math.floor(timeoutMs);
    const http = this.options.httpClient ?? ship24Http;
    try {
      return await measureScrape('Ship24', 'direct', async () => ({
        ...parseShip24Response(await http.fetch(number, Math.min(8_000, timeoutMs)), number),
        tracking_source: 'structured-web-response',
      }));
    } catch (error) {
      // A browser cannot repair a rate limit or server outage. Preserve the
      // original status/Retry-After for the router's existing backoff policy.
      if (error instanceof UpstreamHttpError && (error.status === 429 || error.status >= 500)) throw error;
      if (Date.now() >= deadline) throw error;
      return recoverScrape('Ship24', 'browser', error, async () => {
        const recovered = await scrapeUniversalPage({ ...this.options, timeoutMs: deadline - Date.now() }, {
          name: 'Ship24', url: `https://www.ship24.com/tracking?p=${number}`,
          responseUrl: `https://api.ship24.com/api/parcels/${number}?lang=en`,
        }, (payload) => parseShip24Response(payload, number));
        return { ...recovered, tracking_source: 'browser-session-response' };
      });
    }
  }
}
