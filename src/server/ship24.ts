import 'server-only';

import type { CarrierEvent, CarrierResult } from './carrierResult';
import { isRecord } from './types';
import { scrapeUniversalPage, type UniversalBrowserOptions } from './universalBrowser';
import { event, numberOf, result } from './universalTrackingResult';

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
    // timestamp carries the real offset (verified against the public web app).
    const parsed = event(raw.timestamp, raw.status, raw.dispatch_code_id === 7 ? 'Delivered' : undefined);
    if (parsed) events.push(parsed);
  }
  return result(events, 'Ship24');
}

export class Ship24Tracker {
  constructor(readonly options: UniversalBrowserOptions = {}) {}

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const number = numberOf(trackingNumber);
    return scrapeUniversalPage(this.options, {
      name: 'Ship24', url: `https://www.ship24.com/tracking?p=${number}`,
      responseUrl: `https://api.ship24.com/api/parcels/${number}?lang=en`,
    }, (payload) => parseShip24Response(payload, number));
  }
}
