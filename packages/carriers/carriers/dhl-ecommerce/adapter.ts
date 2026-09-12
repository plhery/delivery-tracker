/**
 * DHL eCommerce, through the public recipient endpoint the global tracking
 * page calls (`www.dhl.com/utapi`).
 *
 * The endpoint answers every direct server request with an Akamai crypto
 * proof-of-work challenge (HTTP 428) that plain HTTP cannot solve (verified
 * 2026-09-10: cookie replay and visiting the page first both still return
 * 428), and browser clearance is not transferable back to Node. The lookup
 * therefore has a single step: a local Chromium session loads the tracking
 * page, the site solves its own challenge and calls the API in that session,
 * and the response to the exact requested URL is parsed.
 *
 * DHL may answer with a customer-confirmation id instead of the queried
 * alias, so only one eCommerce shipment from that exact request URL is
 * accepted, and the id itself is never retained.
 */
import 'server-only';

import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { ChallengeError, SchemaError, type CarrierErrorOptions } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps, singleFlight } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { clean as cleanText, UpstreamHttpError } from '../../core/transport';
import { scrapeUniversalPage, type UniversalBrowserOptions } from '../../core/transport/browser';
import { isRecord, type JsonObject } from '../../core/types';
import { stageFor, statusFor } from './status';

const PROVIDER = 'DHL eCommerce';
const API = 'https://www.dhl.com/utapi';
/** Statuses DHL answers with while its challenge is unsolved. */
const CHALLENGE_STATUSES = [401, 403, 419, 428];

/**
 * UTAPI strings occasionally carry markup. Tags are dropped without a
 * separator, as this adapter has always done, before the shared cleaner
 * collapses whitespace and caps the length.
 */
function clean(value: unknown, limit = 500): string {
  return typeof value === 'string' ? cleanText(value.replace(/<[^>]*>/g, ''), limit) : '';
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

/**
 * A local policy rather than one from `core/time`: the zone comes from the
 * event's own location, and every event is normalized to UTC because the
 * result declares `timezone: 'UTC'` for a carrier whose legs cross zones.
 */
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

/** Only call for the response to the exact requested UTAPI URL. DHL can return
 * a customer-confirmation id which differs from every queried parcel alias. */
export function parseDHLEcommerceResponse(payload: unknown): CarrierResult {
  if (!isRecord(payload) || !Array.isArray(payload.shipments)) throw new SchemaError(PROVIDER, 'DHL eCommerce returned an invalid tracking response');
  if (payload.shipments.length !== 1 || !isRecord(payload.shipments[0])) {
    throw new SchemaError(PROVIDER, 'DHL eCommerce did not return one unambiguous shipment');
  }
  const shipment = payload.shipments[0];
  if (!clean(shipment.id)) throw new SchemaError(PROVIDER, 'DHL eCommerce returned a shipment without an identifier');
  if (shipment.service !== 'ecommerce') throw new SchemaError(PROVIDER, 'This shipment is not handled by DHL eCommerce');
  if (!isRecord(shipment.status) || !clean(shipment.status.description)) throw new SchemaError(PROVIDER, 'DHL eCommerce returned no tracking status');
  if (!Array.isArray(shipment.events) || shipment.events.length > 500) throw new SchemaError(PROVIDER, 'DHL eCommerce returned invalid tracking events');
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

/**
 * The tracking page answered with a challenge status instead of the tracking
 * application. The name is part of the host's error metadata contract: it
 * reports the upstream status for errors named `DHLEcommerceSessionError`.
 */
export class DHLEcommerceSessionError extends ChallengeError {
  /** Always present here; narrowed from the optional base field. */
  declare readonly status: number;

  constructor(status: number, options?: CarrierErrorOptions) {
    super(PROVIDER, `DHL eCommerce rejected the tracking session with HTTP ${status}`, { ...options, status });
    this.name = 'DHLEcommerceSessionError';
  }
}

function trackingApiUrl(number: string): string {
  const url = new URL(API);
  url.search = new URLSearchParams({ trackingNumber: number, language: 'en', requesterCountryCode: 'CH', source: 'tt' }).toString();
  return url.toString();
}

export interface DHLEcommerceTrackerOptions extends UniversalBrowserOptions {
  budgetMs?: number;
  recorder?: StepRecorder;
}

export class DHLEcommerceTracker {
  private readonly recorder: StepRecorder;
  private readonly serialize = singleFlight();

  constructor(readonly options: DHLEcommerceTrackerOptions = {}) {
    const timeout = options.timeoutMs;
    if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout > 60_000)) {
      throw new TypeError('DHL eCommerce timeout must be between 1 and 60000 ms');
    }
    this.recorder = options.recorder ?? NOOP_RECORDER;
  }

  /** One browser at a time per instance: a batch must not spawn a Chromium per parcel. */
  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const number = normalizeDHLEcommerceNumber(trackingNumber);
    const timeoutMs = this.options.timeoutMs ?? 45_000;
    return this.serialize(() => runSteps<CarrierResult>(
      { carrier: 'dhl-ecommerce', budgetMs: this.options.budgetMs ?? timeoutMs + 15_000, recorder: this.recorder },
      [{ id: 'browser', run: () => this.browser(number, timeoutMs) }],
    ));
  }

  private async browser(number: string, timeoutMs: number): Promise<CarrierResult> {
    try {
      return await scrapeUniversalPage({ executablePath: this.options.executablePath, timeoutMs }, {
        name: PROVIDER, url: dhlEcommerceTrackingUrl(number), responseUrl: trackingApiUrl(number),
      }, parseDHLEcommerceResponse);
    } catch (error) {
      // The challenge can also reach the page itself; name it so the host
      // records the upstream status rather than a bare transport failure.
      if (error instanceof UpstreamHttpError && CHALLENGE_STATUSES.includes(error.status)) {
        throw new DHLEcommerceSessionError(error.status, { cause: error });
      }
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new DHLEcommerceTracker({
    executablePath: environment.browserExecutablePath ?? undefined, recorder: environment.recorder,
  });
  return {
    id: 'dhl-ecommerce',
    steps: ['browser'],
    track: (input) => tracker.fetch(input.number),
  };
};
