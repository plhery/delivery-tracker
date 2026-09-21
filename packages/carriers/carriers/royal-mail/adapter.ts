import 'server-only';

import { DateTime } from 'luxon';
import { load } from 'cheerio';
import type { AdapterFactory } from '../../core/adapter';
import { ChallengeError, IndeterminateError, RateLimitedError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { clean, cleanScalar, TrawlClient } from '../../core/transport';
import { explicitOffsetTime } from '../../core/time';
import { isRecord } from '../../core/types';
import { royalMailStage, royalMailSummaryStage, statusForStage } from './status';

/** Read the response produced by Royal Mail's form and hCaptcha callback. */
const TRACKING_BASE = 'https://www.royalmail.com/track-your-item';
const SUMMARY_API_PREFIX = 'https://api-web.royalmail.com/mailpieces/microsummary/v1/summary/';
const MAX_BYTES = 10_000_000;
const DEFAULT_TIMEOUT_MS = 60_000;
// How long the browser may wait for the page's own summary call after the page settles.
const SETTLE_TIMEOUT_MS = 15_000;
// Captured replies beyond this many are noise, never the answer.
const MAX_CAPTURED = 20;
const MAX_EVENTS_TO_INSPECT = 500;
const MAX_EVENTS_TO_RETURN = 100;
export function normalizeRoyalMailNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^[A-Z]{2}\d{9}GB$/.test(value)) {
    throw new SchemaError('Royal Mail', 'Royal Mail tracking numbers must match the UPU S10 format');
  }
  return value;
}

export function royalMailTrackingUrl(trackingNumber: string): string {
  return `${TRACKING_BASE}#/tracking-results/${normalizeRoyalMailNumber(trackingNumber)}`;
}

export function royalMailSummaryApiUrl(trackingNumber: string): string {
  return `${SUMMARY_API_PREFIX}${normalizeRoyalMailNumber(trackingNumber)}`;
}

/** Preserve offset-free wall time instead of assigning a zone to overseas scans. */
function eventTime(value: unknown): string {
  const raw = cleanScalar(value, 64);
  return explicitOffsetTime(raw)?.iso ?? raw;
}

/** A delivery estimate reduced to its calendar day. */
function expectedDelivery(value: unknown): string | null {
  const raw = cleanScalar(value, 64);
  const day = /^\d{4}-\d{2}-\d{2}/.exec(raw)?.[0];
  return day && DateTime.fromISO(day).isValid ? day : null;
}

/** Only the field vocabulary consumed by the public tracking application. */
export function parseRoyalMailTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = normalizeRoyalMailNumber(trackingNumber);
  if (!isRecord(payload)) throw new SchemaError('Royal Mail', 'Royal Mail returned an invalid tracking response');
  const errors = Array.isArray(payload.errors) ? payload.errors.filter(isRecord) : [];
  if (errors.some(error => error.errorCode === 'E0015' || error.code === 'E0015')) {
    throw new ChallengeError('Royal Mail', 'Royal Mail denied the tracking session');
  }
  if (String(payload.httpCode) === '429') throw new RateLimitedError('Royal Mail');
  if (errors.length) throw new IndeterminateError('Royal Mail', 'Royal Mail could not confirm the tracking status');
  const mailpiece = payload.mailPieces;
  // The microsummary endpoint returns one object, not the array used by the
  // recent-items endpoint. Never treat a gateway 404 or schema drift as not-found.
  if (!isRecord(mailpiece) || !isRecord(mailpiece.summary)) {
    throw new SchemaError('Royal Mail', 'Royal Mail returned an invalid tracking response');
  }
  if (cleanScalar(mailpiece.mailPieceId).toUpperCase() !== number) {
    throw new SchemaError('Royal Mail', 'Royal Mail did not return the requested parcel');
  }
  const summary = mailpiece.summary;
  const summaryText = cleanScalar(summary.statusDescription);
  if (mailpiece.events !== undefined && !Array.isArray(mailpiece.events)) {
    throw new SchemaError('Royal Mail', 'Royal Mail returned invalid tracking events');
  }
  const scans = Array.isArray(mailpiece.events) ? mailpiece.events : [];
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const raw of scans.slice(0, MAX_EVENTS_TO_INSPECT)) {
    if (!isRecord(raw)) continue;
    const description = cleanScalar(raw.eventName);
    if (!description) continue;
    const stage = royalMailStage(description) ?? undefined;
    const time = eventTime(raw.eventDateTime);
    const location = cleanScalar(raw.locationName, 250);
    const code = cleanScalar(raw.eventCode, 64);
    const event: CarrierEvent = {
      ...(time ? { time } : {}),
      ...(location ? { location } : {}),
      description: stage === 'delivered' ? 'Delivered' : description,
      ...(stage ? { stage } : {}),
      ...(/^[A-Za-z0-9_-]+$/.test(code) ? { provider_code: code } : {}),
    };
    const identity = JSON.stringify([time, location, event.description]);
    if (seen.has(identity)) continue;
    seen.add(identity);
    events.push(event);
  }
  // Royal Mail also sorts the history; upstream order is not guaranteed.
  events.sort((a, b) => {
    const left = Date.parse(a.time ?? '');
    const right = Date.parse(b.time ?? '');
    return Number.isFinite(left) && Number.isFinite(right) ? right - left : 0;
  });
  const trimmed = events.slice(0, MAX_EVENTS_TO_RETURN);
  const summaryCategory = cleanScalar(summary.statusCategory);
  const statusText = summaryText || summaryCategory || trimmed[0]?.description;
  if (!statusText) throw new SchemaError('Royal Mail', 'Royal Mail returned no usable tracking status');
  const stage = royalMailSummaryStage(summaryCategory, statusText) ?? undefined;
  const delivered = stage === 'delivered';
  return {
    status: stage ? statusForStage(stage) : 'unknown',
    ...(stage ? { current_stage: stage } : {}),
    last_status_text: delivered ? 'Delivered' : statusText,
    last_update: eventTime(summary.lastEventDateTime) || trimmed[0]?.time || null,
    expected_delivery: delivered || !isRecord(mailpiece.estimatedDelivery)
      ? null : expectedDelivery(mailpiece.estimatedDelivery.date),
    events: trimmed,
  };
}

/**
 * The page the browser rendered, read only to tell a bot challenge from an
 * inconclusive load. Rendered text never decides not-found: only the
 * structured reply does.
 */
export function parseRoyalMailTrackingHtml(page: string): 'challenged' | 'inconclusive' {
  const $ = load(page);
  $('script, style, noscript').remove();
  const visible = clean($('body').text(), 20_000);
  if (/access denied|just a moment|attention required|are you a robot|verify you are human|before you proceed|unusual traffic/i.test(visible)) {
    return 'challenged';
  }
  return 'inconclusive';
}

export interface RoyalMailTrackerOptions {
  timeoutMs?: number;
  /** Legacy configuration seam; `trawl` is preferred. */
  trawlUrl?: string;
  /** The browser service, or null when none is configured. */
  trawl?: TrawlClient | null;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
}

export class RoyalMailTracker {
  readonly timeoutMs: number;
  readonly trawlUrl: string;
  readonly #trawl: TrawlClient | null | undefined;
  readonly #fetcher: typeof fetch | undefined;
  readonly #recorder: StepRecorder;

  constructor(options: RoyalMailTrackerOptions = {}) {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new TypeError('Royal Mail timeout must be positive');
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
    const number = normalizeRoyalMailNumber(trackingNumber);
    // Akamai refuses every non-browser client, so a direct attempt only burns
    // time. There is one step, and it is the browser.
    const trawl = this.#browserService();
    if (!trawl) {
      throw new ChallengeError(
        'Royal Mail',
        'Royal Mail challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
      );
    }
    return runSteps<CarrierResult>({
      carrier: 'royal-mail', budgetMs: this.timeoutMs, recorder: this.#recorder,
    }, [
      { id: 'trawl', run: () => this.#trawlResult(trawl, number) },
    ]);
  }

  /**
   * A real browser loads the page and makes the summary call itself; the
   * service hands that reply back. The browser's session is never replayed
   * over plain HTTP: the edge accepts the call only from the session it
   * validated. The page the browser rendered only tells a challenge apart.
   */
  async #trawlResult(trawl: TrawlClient, number: string): Promise<CarrierResult> {
    const summaryUrl = royalMailSummaryApiUrl(number);
    const page = await trawl.scrape({
      url: royalMailTrackingUrl(number),
      skipHttp: true,
      maxTier: 3,
      maxTimeout: this.timeoutMs,
      captureResponses: [summaryUrl],
      settleTimeout: SETTLE_TIMEOUT_MS,
    }, {
      provider: 'TRAWL while fetching Royal Mail',
      // A browser may validate its cached main document with 304 while the
      // freshly submitted tracking request still returns a normal JSON reply.
      requireSolved: false,
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_BYTES,
      fetcher: this.#fetcher,
    });
    if (![2, 3].includes(page.tier) || ![200, 304].includes(page.statusCode)) {
      throw new TransportError('Royal Mail', 'The browser service did not load the Royal Mail tracking page');
    }
    let captureError: unknown;
    // Newest first: a later reply is the page's final answer. The entry URL
    // itself carries the number, so only the exact requested call is read.
    for (const entry of page.capturedResponses.slice(0, MAX_CAPTURED).reverse()) {
      if (entry.url !== summaryUrl) continue;
      if (entry.status === 429) {
        const retry = entry.headers['retry-after'];
        const retryMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1_000 : undefined;
        throw new RateLimitedError('Royal Mail', retryMs);
      }
      if ([401, 403].includes(entry.status)) throw new ChallengeError('Royal Mail');
      if (entry.status === 404 && entry.body && !entry.truncated && !entry.base64Encoded && !entry.error) {
        let payload: unknown;
        try { payload = JSON.parse(entry.body); } catch { /* Keep the HTTP failure below. */ }
        if (isRecord(payload) && Array.isArray(payload.errors)
          && payload.errors.some(error => isRecord(error) && error.errorCode === 'E1142')) {
          throw new IndeterminateError('Royal Mail', 'Royal Mail could not confirm the tracking status');
        }
      }
      if (entry.status >= 400) throw new UpstreamHttpError('Royal Mail', entry.status);
      if (entry.status !== 200 || entry.truncated || entry.base64Encoded || entry.error || entry.body === null) continue;
      try {
        return this.#structuredResult(number, JSON.parse(entry.body));
      } catch (error) {
        // An unreadable or unrelated reply; the rendered page may still name a challenge.
        if (!(error instanceof SyntaxError)) throw error;
        captureError = error;
      }
    }
    if (parseRoyalMailTrackingHtml(page.html) === 'challenged') {
      throw new ChallengeError('Royal Mail', 'Royal Mail challenged the browser tracking session', { cause: captureError });
    }
    throw new TransportError('Royal Mail', 'TRAWL did not capture the Royal Mail tracking response', { cause: captureError });
  }

  #structuredResult(number: string, payload: unknown): CarrierResult {
    const result = parseRoyalMailTrackingResponse(payload, number);
    result.tracking_url = royalMailTrackingUrl(number);
    result.tracking_source = 'structured-web-response';
    return result;
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new RoyalMailTracker({
    fetcher: environment.fetcher,
    trawl: environment.trawl,
    recorder: environment.recorder,
  });
  return {
    id: 'royal-mail',
    // Akamai refuses every non-browser client, so there is no direct tier.
    steps: ['trawl'],
    track: (input) => tracker.fetch(input.number),
  };
};
