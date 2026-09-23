import 'server-only';

import { load } from 'cheerio';
import type { AdapterFactory } from '../../core/adapter';
import {
  ChallengeError,
  InputRequiredError,
  RateLimitedError,
  SchemaError,
  TransportError,
  UpstreamHttpError,
} from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { explicitOffsetTime } from '../../core/time';
import { clean, cleanScalar, TrawlClient } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { FEDEX_CODE_STAGE, fedexStage, fedexStatus } from './status';

/**
 * FedEx, through the tracking reply the public page reads itself.
 *
 * The page at `fedextrack/?trknbr=` is a shell: every byte of tracking data
 * arrives as `POST https://api.fedex.com/track/v2/shipments`, a
 * browser-gated call. Plain HTTP and the deployed browser service received
 * HTTP 403 on 2026-09-22, while an interactive browser returned full history.
 * The browser service retains verified FedEx contexts for later lookups.
 * API rejection must stay a challenge so routing applies cooldown/fallback.
 * The browser's session is never replayed over plain HTTP.
 *
 * Response shape provenance: the page bundle's package model (`trackingNbr`,
 * `keyStatus`/`keyStatusCD`, `scanEventList` items with
 * `date`/`time`/`gmtOffset`/`scanLocation`/`status`/`statusCD`/`scanDetails`),
 * inspected 2026-09-20.
 */
const TRACKING_BASE = 'https://www.fedex.com/fedextrack/';
const TRACK_API = 'https://api.fedex.com/track/v2/shipments';
const MAX_BYTES = 10_000_000;
const DEFAULT_TIMEOUT_MS = 90_000;
// How long the browser may wait for the page's own tracking call after the page settles.
const SETTLE_TIMEOUT_MS = 15_000;
// Captured replies beyond this many are noise, never the answer.
const MAX_CAPTURED = 20;
const MAX_EVENTS_TO_INSPECT = 500;
const MAX_EVENTS_TO_RETURN = 100;

export function normalizeFedExTrackingNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^\d{12}$/.test(value) && !/^\d{15}$/.test(value)) {
    throw new SchemaError('FedEx', 'FedEx tracking numbers must contain 12 or 15 digits');
  }
  return value;
}

export function fedexTrackingUrl(trackingNumber: string): string {
  const url = new URL(TRACKING_BASE);
  url.searchParams.set('trknbr', normalizeFedExTrackingNumber(trackingNumber));
  return url.toString();
}

/** A scan timestamp. FedEx sends a local wall-clock pair plus its explicit
 * offset, assembled into an offset-carrying ISO string rather than parsed, so
 * no zone is ever guessed; a scan with an unusable pair keeps no time. */
function scanTime(scan: JsonObject): string {
  const date = cleanScalar(scan.date);
  const time = cleanScalar(scan.time);
  const offset = cleanScalar(scan.gmtOffset);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)
    && /^\d{2}:\d{2}(?::\d{2})?$/.test(time)
    && /^[+-]\d{2}:?\d{2}$/.test(offset)) {
    const clock = time.length === 5 ? `${time}:00` : time;
    const parsed = explicitOffsetTime(`${date}T${clock}${offset}`);
    if (parsed) return parsed.iso;
  }
  return '';
}

function scanDescription(scan: JsonObject): string {
  const status = clean(scan.status);
  const details = clean(scan.scanDetails);
  if (details && !status.toLocaleLowerCase('en-US').includes(details.toLocaleLowerCase('en-US'))) {
    return clean(`${status} — ${details}`);
  }
  return status;
}

/** Delivery-date estimate as a calendar day; anything else is not an estimate. */
function expectedDelivery(value: unknown): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(cleanScalar(value, 64));
  return match ? match[1]! : null;
}

/** A delivered-at instant; offset-less or unparsable values are dropped. */
function deliveredAt(value: unknown): string | null {
  return explicitOffsetTime(value)?.iso ?? null;
}

function errorCode(error: unknown): string {
  return isRecord(error) ? cleanScalar(error.code).toLocaleUpperCase('en-US') : '';
}

/** An empty answer proves nothing either way, so it stays a retryable unknown. */
function notLocated(): CarrierResult {
  return {
    status: 'unknown',
    last_status_text: 'FedEx could not locate the shipment',
    last_update: null,
    expected_delivery: null,
    events: [],
  };
}

/** The structured answer of the tracking page's own API call. */
export function parseFedExTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = normalizeFedExTrackingNumber(trackingNumber);
  if (!isRecord(payload) || !isRecord(payload.output)) {
    throw new SchemaError('FedEx', 'FedEx returned an invalid tracking response');
  }
  const output = payload.output;
  const packages = Array.isArray(output.packages) ? output.packages.filter(isRecord) : null;
  if (!packages) throw new SchemaError('FedEx', 'FedEx returned an invalid tracking response');
  if (packages.length === 0) {
    const codes = Array.isArray(output.errorList) ? output.errorList.map(errorCode).join(' ') : '';
    if (/AUTHENTICAT|AUTHORIZATION/.test(codes)) {
      throw new InputRequiredError('FedEx', 'recipient verification',
        'FedEx requires recipient verification for this shipment');
    }
    return notLocated();
  }
  const matches = packages.filter((item) =>
    cleanScalar(item.trackingNbr).replace(/[\s.-]/g, '').toLocaleUpperCase('en-US') === number);
  if (matches.length !== 1) {
    throw new SchemaError('FedEx', matches.length === 0
      ? 'FedEx did not return the requested parcel'
      : 'FedEx returned several shipments for this number');
  }
  const shipment = matches[0]!;
  const scans = Array.isArray(shipment.scanEventList) ? shipment.scanEventList.filter(isRecord) : [];
  const errors = Array.isArray(shipment.errorList) ? shipment.errorList.filter(isRecord) : [];
  const keyStatus = clean(shipment.keyStatus);
  const keyStatusCD = cleanScalar(shipment.keyStatusCD);
  const statusDetails = clean(shipment.statusWithDetails);
  if (scans.length === 0 && !keyStatus && !keyStatusCD) {
    const codes = errors.map(errorCode).join(' ');
    if (/TRACKINGNUMBER|NOTFOUND|NOT FOUND|NO TRACKING/.test(codes)) return notLocated();
    if (/AUTHENTICAT|AUTHORIZATION/.test(codes)) {
      throw new InputRequiredError('FedEx', 'recipient verification',
        'FedEx requires recipient verification for this shipment');
    }
    throw new SchemaError('FedEx', 'FedEx returned no usable tracking status');
  }
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const raw of scans.slice(0, MAX_EVENTS_TO_INSPECT)) {
    const description = scanDescription(raw);
    if (!description) continue;
    const statusCD = cleanScalar(raw.statusCD).toLocaleUpperCase('en-US');
    const stage = FEDEX_CODE_STAGE[statusCD]
      ?? fedexStage(`${clean(raw.status)} ${clean(raw.scanDetails)}`)
      ?? undefined;
    const time = scanTime(raw);
    const location = clean(raw.scanLocation);
    // A delivered scan names its signatory; the event keeps the fact, not the name.
    const event: CarrierEvent = {
      ...(time ? { time } : {}),
      ...(location ? { location } : {}),
      description: stage === 'delivered' ? 'Delivered' : description,
      ...(stage ? { stage } : {}),
    };
    const identity = JSON.stringify([event.time ?? '', event.location ?? '', event.description]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    events.push(event);
  }
  events.sort((left, right) => String(right.time ?? '').localeCompare(String(left.time ?? '')));
  const trimmed = events.slice(0, MAX_EVENTS_TO_RETURN);
  const statusText = keyStatus || trimmed[0]?.description || 'Tracking information received';
  const stage = FEDEX_CODE_STAGE[keyStatusCD.toUpperCase()]
    ?? fedexStage(`${keyStatus} ${statusDetails}`) ?? undefined;
  const status = fedexStatus(keyStatusCD, `${keyStatus} ${statusDetails}`, trimmed.length > 0);
  const delivered = stage === 'delivered';
  const estimate = delivered ? null : expectedDelivery(shipment.estDeliveryDt);
  return {
    status,
    ...(stage ? { current_stage: stage } : {}),
    last_status_text: delivered ? 'Delivered' : statusText,
    last_update: trimmed[0]?.time || null,
    expected_delivery: estimate,
    ...(delivered && deliveredAt(shipment.actDeliveryDt)
      ? { delivered_at: deliveredAt(shipment.actDeliveryDt) } : {}),
    events: trimmed,
  };
}

/**
 * The page the browser rendered, read only to tell a bot challenge from an
 * inconclusive load. The page renders its "can't find that tracking number"
 * notice both for unknown numbers and for tracking calls the edge refused,
 * so rendered text never decides not-found: only the structured reply does.
 */
export function parseFedExTrackingHtml(page: string): 'challenged' | 'inconclusive' {
  const $ = load(page);
  $('script, style, noscript').remove();
  const visible = clean($('body').text(), 20_000);
  if (/access denied|system down|just a moment|attention required|are you a robot|verify you are human|before you proceed/i.test(visible)) {
    return 'challenged';
  }
  return 'inconclusive';
}

export interface FedExTrackerOptions {
  timeoutMs?: number;
  /** Legacy configuration seam; `trawl` is preferred. */
  trawlUrl?: string;
  /** The browser service, or null when none is configured. */
  trawl?: TrawlClient | null;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
}

export class FedExTracker {
  readonly timeoutMs: number;
  readonly trawlUrl: string;
  readonly #trawl: TrawlClient | null | undefined;
  readonly #fetcher: typeof fetch | undefined;
  readonly #recorder: StepRecorder;

  constructor(options: FedExTrackerOptions = {}) {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new TypeError('FedEx timeout must be positive');
    }
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.trawlUrl = (options.trawlUrl ?? process.env.FLARESOLVERR_URL ?? '').trim();
    this.#trawl = options.trawl;
    this.#fetcher = options.fetcher;
    this.#recorder = options.recorder ?? NOOP_RECORDER;
  }

  /** The injected browser service, or one built from the configured URL. */
  #browserService(): TrawlClient | null {
    if (this.#trawl !== undefined) return this.#trawl;
    return this.trawlUrl ? new TrawlClient(this.trawlUrl, this.#fetcher) : null;
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const number = normalizeFedExTrackingNumber(trackingNumber);
    // Plain HTTP probes were rejected; the dedicated route uses the browser.
    const trawl = this.#browserService();
    if (!trawl) {
      throw new ChallengeError(
        'FedEx',
        'FedEx challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
      );
    }
    return runSteps<CarrierResult>({
      carrier: 'fedex', budgetMs: this.timeoutMs, recorder: this.#recorder,
    }, [
      { id: 'trawl', run: () => this.#trawlResult(trawl, number) },
    ]);
  }

  /**
   * A real browser loads the page and makes the tracking call itself; the
   * service hands that reply back. The browser's session is never replayed
   * over plain HTTP: the edge accepts the call only from the session it
   * validated. The page the browser rendered only tells a challenge apart.
   */
  async #trawlResult(trawl: TrawlClient, number: string): Promise<CarrierResult> {
    const page = await trawl.scrape({
      url: fedexTrackingUrl(number),
      skipHttp: true,
      maxTier: 3,
      maxTimeout: this.timeoutMs,
      captureResponses: [TRACK_API],
      settleTimeout: SETTLE_TIMEOUT_MS,
    }, {
      provider: 'TRAWL while fetching FedEx',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_BYTES,
      fetcher: this.#fetcher,
    });
    let captureError: unknown;
    // Newest first: a later reply is the page's final answer.
    for (const entry of page.capturedResponses.slice(-MAX_CAPTURED).reverse()) {
      if (entry.url !== TRACK_API) continue;
      // The page shell can load normally while its tracking API is rejected.
      // Preserve that failure instead of reporting a missing capture or falling
      // back to an older successful reply from the same page.
      if (entry.status === 401 || entry.status === 403) {
        throw new ChallengeError('FedEx', 'FedEx rejected the browser tracking request', { status: entry.status });
      }
      if (entry.status === 429) {
        const header = entry.headers['retry-after'] ?? entry.headers['Retry-After'];
        const delay = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000
          : header ? Date.parse(header) - Date.now() : NaN;
        throw new RateLimitedError('FedEx', Number.isFinite(delay) ? Math.max(0, delay) : undefined);
      }
      if (entry.status >= 500) throw new UpstreamHttpError('FedEx', entry.status);
      if (entry.status >= 400) {
        throw new TransportError('FedEx', `FedEx tracking API returned HTTP ${entry.status}`, { status: entry.status });
      }
      if (entry.status !== 200 || entry.truncated || entry.body === null) continue;
      try {
        return this.#structuredResult(number, JSON.parse(entry.body));
      } catch (error) {
        if (error instanceof InputRequiredError) throw error;
        // An unreadable or unrelated reply; the rendered page may still name a challenge.
        captureError ??= error instanceof SyntaxError
          ? new SchemaError('FedEx', 'FedEx returned unreadable tracking JSON', { cause: error }) : error;
      }
    }
    if (parseFedExTrackingHtml(page.html) === 'challenged') {
      throw new ChallengeError('FedEx', 'FedEx challenged the browser tracking session', { cause: captureError });
    }
    if (captureError) throw captureError;
    throw new TransportError('FedEx', 'TRAWL did not capture the FedEx tracking response', { cause: captureError });
  }

  #structuredResult(number: string, payload: unknown): CarrierResult {
    const result = parseFedExTrackingResponse(payload, number);
    result.tracking_url = fedexTrackingUrl(number);
    result.tracking_source = 'structured-web-response';
    return result;
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new FedExTracker({
    fetcher: environment.fetcher,
    trawl: environment.trawl,
    recorder: environment.recorder,
  });
  return {
    id: 'fedex',
    // Browser-backed direct tracking; universal recovery belongs to the caller.
    steps: ['trawl'],
    track: (input) => tracker.fetch(input.number),
  };
};
