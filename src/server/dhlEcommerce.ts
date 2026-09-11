import 'server-only';
import { measureScrape } from './scrapeMonitoring';
import { trackingLanguageStage } from './trackingLanguage';

import { DateTime } from 'luxon';
import type { CarrierEvent, CarrierResult, CarrierStatus } from './carrierResult';
import { isRecord, type JsonObject } from './types';
import { scrapeUniversalPage, type UniversalBrowserOptions } from './universalBrowser';

const API = 'https://www.dhl.com/utapi';

function clean(value: unknown, limit = 500): string {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

export function normalizeDHLEcommerceNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^(?=.*\d)[A-Z0-9]{5,40}$/.test(number)) throw new TypeError('DHL eCommerce tracking number is invalid');
  return number;
}

export function dhlEcommerceTrackingUrl(number: string): string {
  return `https://www.dhl.com/ch-en/home/tracking.html?tracking-id=${normalizeDHLEcommerceNumber(number)}&submit=1`;
}

function address(event: JsonObject): JsonObject {
  const location = isRecord(event.location) ? event.location : {};
  return isRecord(location.address) ? location.address : {};
}

// UTAPI returns local wall-clock timestamps, sometimes without countryCode.
// Resolve only unambiguous locations; never treat an unknown local time as UTC.
const COUNTRY_ZONES: Record<string, string> = {
  CH: 'Europe/Zurich', DE: 'Europe/Berlin', FR: 'Europe/Paris', AT: 'Europe/Vienna',
  BE: 'Europe/Brussels', NL: 'Europe/Amsterdam', LU: 'Europe/Luxembourg',
  GB: 'Europe/London', IE: 'Europe/Dublin', IT: 'Europe/Rome', PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague', DK: 'Europe/Copenhagen', SE: 'Europe/Stockholm', NO: 'Europe/Oslo',
  FI: 'Europe/Helsinki', GR: 'Europe/Athens', HU: 'Europe/Budapest', RO: 'Europe/Bucharest',
  SK: 'Europe/Bratislava', SI: 'Europe/Ljubljana', HR: 'Europe/Zagreb',
  JP: 'Asia/Tokyo', CN: 'Asia/Shanghai', HK: 'Asia/Hong_Kong', SG: 'Asia/Singapore',
  IN: 'Asia/Kolkata', KR: 'Asia/Seoul', TW: 'Asia/Taipei', TH: 'Asia/Bangkok',
};
const HUB_ZONES: Record<string, string> = {
  'melrose park, il, us': 'America/Chicago', 'hebron, ky, us': 'America/New_York',
  'lahr': 'Europe/Berlin', 'staufenberg': 'Europe/Berlin',
};

function eventTime(event: JsonObject): string | null {
  const raw = clean(event.timestamp, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return null;
  const place = address(event);
  const locality = clean(place.addressLocality, 160);
  const country = clean(place.countryCode).toUpperCase();
  const zone = /(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? 'UTC'
    : COUNTRY_ZONES[country] ?? COUNTRY_ZONES[locality] ?? HUB_ZONES[locality.toLowerCase()];
  if (!zone) return null;
  const parsed = DateTime.fromISO(raw, { zone, setZone: true });
  return parsed.isValid ? parsed.toUTC().toISO() : null;
}

function stageFor(event: JsonObject): string {
  const text = clean(event.description).toLowerCase();
  if (/return(?:ed|ing)? to (?:the )?sender/.test(text)) return 'returned';
  if (/not delivered|unable to deliver|delivery attempt|delivery failed/.test(text)) return 'failed_attempt';
  // Sender-side drop-off scans (ha-dhl-nl#15) must never read as recipient
  // pickup: the parcel is entering the network, not awaiting collection.
  if (/picked.?up at (?:a )?parcel ?shop|drop(?:ped)? ?off at|handed in at/.test(text)) return 'accepted';
  if (/ready for (?:pickup|collection)|available for (?:pickup|collection)/.test(text)) return 'ready_for_pickup';
  if (/out for delivery/.test(text)) return 'out_for_delivery';
  if (/customs.*(?:cleared|released)|clearance completed/.test(text)) return 'in_transit';
  if (/customs|clearance/.test(text)) return 'customs';
  if (/label created|manifest data received|en route to dhl ecommerce or awaiting processing|electronic|information received/.test(text)) return 'registered';
  if (/package received at dhl|picked up|accepted/.test(text)) return 'accepted';
  if (/^(?:close bag|scanned into sack\/container)$/.test(text)) return 'in_transit';
  // A terminal provider code outranks an intuitive translated label.
  if (event.statusCode === 'delivered') return 'delivered';
  const translated = trackingLanguageStage(String(event.description ?? ''));
  if (translated) return translated;
  switch (event.statusCode) {
    case 'transit': return 'in_transit';
    case 'pre-transit': return 'registered';
    case 'failure': return 'failed_attempt';
    default: return 'pending';
  }
}

function statusFor(stage: string): CarrierStatus {
  if (stage === 'delivered') return 'delivered';
  if (stage === 'out_for_delivery' || stage === 'ready_for_pickup') return 'out_for_delivery';
  if (['exception', 'failed_attempt', 'returned'].includes(stage)) return 'exception';
  if (stage === 'registered' || stage === 'pending') return 'pending';
  return 'in_transit';
}

/** Only call for the response to the exact requested UTAPI URL. DHL can return
 * a customer-confirmation id which differs from every queried parcel alias. */
export function parseDHLEcommerceResponse(payload: unknown): CarrierResult {
  if (!isRecord(payload) || !Array.isArray(payload.shipments)) throw new TypeError('DHL eCommerce returned an invalid tracking response');
  if (payload.shipments.length !== 1 || !isRecord(payload.shipments[0])) {
    throw new RangeError('DHL eCommerce did not return one unambiguous shipment');
  }
  const shipment = payload.shipments[0];
  if (!clean(shipment.id)) throw new TypeError('DHL eCommerce returned a shipment without an identifier');
  if (shipment.service !== 'ecommerce') throw new RangeError('This shipment is not handled by DHL eCommerce');
  if (!isRecord(shipment.status) || !clean(shipment.status.description)) throw new TypeError('DHL eCommerce returned no tracking status');
  if (!Array.isArray(shipment.events) || shipment.events.length > 500) throw new TypeError('DHL eCommerce returned invalid tracking events');
  const events: CarrierEvent[] = shipment.events.filter(isRecord).flatMap((event) => {
    const time = eventTime(event);
    const description = clean(event.description);
    if (!time || !description) return [];
    const place = address(event);
    const stage = stageFor(event);
    return [{ time, description: stage === 'delivered' ? 'Delivered' : description,
      location: [...new Set([clean(place.addressLocality, 160), clean(place.countryCode, 2)].filter(Boolean))].join(', '),
      stage }];
  }).sort((a, b) => b.time!.localeCompare(a.time!)).slice(0, 100);
  const stage = shipment.returnFlag === true && shipment.status.statusCode === 'delivered'
    ? 'returned' : stageFor(shipment.status);
  const expected = clean(shipment.estimatedTimeOfDelivery, 64).slice(0, 10);
  const sender = clean(
    isRecord(shipment.sender) ? shipment.sender.name : shipment.senderName, 200,
  ) || null;
  const deliveredAt = stage === 'delivered' ? eventTime(shipment.status) : null;
  return {
    status: statusFor(stage), current_stage: stage,
    last_status_text: stage === 'delivered' ? 'Delivered' : clean(shipment.status.description),
    last_update: eventTime(shipment.status),
    expected_delivery: !['delivered', 'returned'].includes(stage) && /^\d{4}-\d{2}-\d{2}$/.test(expected)
      && DateTime.fromISO(expected).isValid ? expected : null,
    timezone: 'UTC', events,
    ...(sender ? { sender_name: sender } : {}),
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}),
  };
}

function trackingApiUrl(number: string): string {
  const url = new URL(API);
  url.search = new URLSearchParams({ trackingNumber: number, language: 'en', requesterCountryCode: 'CH', source: 'tt' }).toString();
  return url.toString();
}

export class DHLEcommerceTracker {
  private tail: Promise<void> = Promise.resolve();

  constructor(readonly options: UniversalBrowserOptions = {}) {
    const timeout = options.timeoutMs;
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout > 60_000)) {
      throw new TypeError('DHL eCommerce timeout must be between 1 and 60000 ms');
    }
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const number = normalizeDHLEcommerceNumber(trackingNumber);
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    // The utapi endpoint answers every direct server request with an Akamai
    // crypto proof-of-work challenge (HTTP 428), which plain HTTP cannot solve
    // (verified 2026-09-10: cookie replay and page-visit-first both still 428).
    // Go straight to local Chromium, where the site solves the challenge and
    // retries the exact API URL in the same session.
    try {
      const timeoutMs = this.options.timeoutMs ?? 45_000;
      return await measureScrape('dhl-ecommerce', 'browser', () => scrapeUniversalPage({ ...this.options, timeoutMs }, {
        name: 'DHL eCommerce', url: dhlEcommerceTrackingUrl(number), responseUrl: trackingApiUrl(number),
      }, parseDHLEcommerceResponse));
    } finally { release(); }
  }
}
