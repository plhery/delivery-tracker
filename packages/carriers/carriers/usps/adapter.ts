import 'server-only';

import { DateTime } from 'luxon';
import { load } from 'cheerio';
import type { AdapterFactory } from '../../core/adapter';
import { isValidS10TrackingNumber } from '../../core/detection/s10';
import { ChallengeError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { clean, TrawlClient } from '../../core/transport';
import { uspsStage, uspsStatus } from './status';

/**
 * USPS, through the server-rendered tracking page.
 *
 * The page at `go/TrackConfirmAction?tLabels=` carries the verdict, the
 * status and the history in its own HTML: no tracking XHR exists to capture.
 * The edge refuses every non-browser client with HTTP 403 (verified
 * 2026-09-20). A browser can attempt the interstitial check, but fresh
 * checks on 2026-09-22 still returned a challenge shell. The lookup has a single
 * step: the private browser service loads the page, and the rendered DOM is
 * parsed. Nothing is ever replayed over plain HTTP.
 *
 * Markup provenance: the live page shell (`.track-bar-container`,
 * `#trackingNum`, `.latest-update-banner-wrapper .banner-header`,
 * `.current-tracking-status-wrapper`), inspected 2026-09-20. History rows
 * are read by content pattern rather than class names so a reskin that keeps
 * the words keeps working.
 */
const TRACKING_BASE = 'https://tools.usps.com/go/TrackConfirmAction';
const MAX_BYTES = 10_000_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_EVENTS_TO_RETURN = 100;

export function normalizeUSPSNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  // The S10 suffix identifies the issuing country, not the destination.
  // Incoming international mail keeps that number when USPS takes over.
  if (!/^\d{20}$/.test(value) && !/^\d{22}$/.test(value) && !isValidS10TrackingNumber(value)) {
    throw new SchemaError('USPS', 'USPS tracking numbers must contain 20 or 22 digits, or be a checksum-valid UPU S10 number');
  }
  return value;
}

export function uspsTrackingUrl(trackingNumber: string): string {
  const url = new URL(TRACKING_BASE);
  url.searchParams.set('tLabels', normalizeUSPSNumber(trackingNumber));
  return url.toString();
}

/**
 * Facility-local wall time lives in the event's own state. Multi-zone states
 * resolve to their majority zone; a scan whose state maps to nothing keeps
 * the provider's own text rather than being stamped with a guessed zone.
 */
const STATE_ZONES: Readonly<Record<string, string>> = {
  AL: 'America/Chicago', AK: 'America/Anchorage', AZ: 'America/Phoenix', AR: 'America/Chicago',
  CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York', DE: 'America/New_York',
  DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', HI: 'Pacific/Honolulu',
  ID: 'America/Boise', IL: 'America/Chicago', IN: 'America/New_York', IA: 'America/Chicago',
  KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', ME: 'America/New_York',
  MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', MT: 'America/Denver', NE: 'America/Chicago',
  NV: 'America/Los_Angeles', NH: 'America/New_York', NJ: 'America/New_York', NM: 'America/Denver',
  NY: 'America/New_York', NC: 'America/New_York', ND: 'America/Chicago', OH: 'America/New_York',
  OK: 'America/Chicago', OR: 'America/Los_Angeles', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VT: 'America/New_York', VA: 'America/New_York', WA: 'America/Los_Angeles',
  WV: 'America/New_York', WI: 'America/Chicago', WY: 'America/Denver', PR: 'America/Puerto_Rico',
  GU: 'Pacific/Guam', VI: 'America/St_Thomas', AS: 'Pacific/Pago_Pago', MP: 'Pacific/Saipan',
};

const MONTHS = '(January|February|March|April|May|June|July|August|September|October|November|December)';
const DATE_PATTERN = new RegExp(`${MONTHS}\\s+\\d{1,2},?\\s+\\d{4}`, 'i');
const TIME_PATTERN = /\d{1,2}:\d{2}(?::\d{2})?\s*[ap]\.?m\.?/i;
const STATE_PATTERN = /,\s*([A-Z]{2})\b/;

function eventTime(dateText: string, timeText: string, location: string): { iso: string; timestamp: number } | null {
  const dateMatch = DATE_PATTERN.exec(dateText);
  const timeMatch = TIME_PATTERN.exec(timeText);
  if (!dateMatch || !timeMatch) return null;
  const zone = STATE_ZONES[STATE_PATTERN.exec(location)?.[1] ?? ''];
  if (!zone) return null;
  const date = DateTime.fromFormat(dateMatch[0], 'MMMM d, yyyy', { locale: 'en-US', zone });
  const time = DateTime.fromFormat(timeMatch[0].replace(/\./g, '').toLowerCase(), 'h:mm a', { locale: 'en-US', zone })
    ?? DateTime.fromFormat(timeMatch[0].replace(/\./g, '').toLowerCase(), 'h:mm:ss a', { locale: 'en-US', zone });
  if (!date.isValid || !time.isValid) return null;
  const at = date.set({ hour: time.hour, minute: time.minute, second: time.second });
  const iso = at.toISO({ suppressMilliseconds: true });
  return iso ? { iso, timestamp: at.toMillis() } : null;
}

/** A delivery estimate reduced to its calendar day. */
function expectedDelivery(text: string): string | null {
  const match = /(?:expected|scheduled|anticipated)\s+delivery.*?([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/is.exec(text);
  if (!match) return null;
  const day = DateTime.fromFormat(match[1]!, 'MMMM d, yyyy', { locale: 'en-US', zone: 'utc' });
  return day.isValid ? day.toISODate() : null;
}

function notLocated(): CarrierResult {
  return {
    status: 'unknown',
    last_status_text: 'USPS could not locate the shipment',
    last_update: null,
    expected_delivery: null,
    events: [],
  };
}

interface ParsedRow {
  event: CarrierEvent;
  timestamp: number;
  index: number;
}

/** One history row, read by content pattern: a US date, a clock time, a
 * city/state location, and the longest remaining cell as the description. */
function parseRow(cells: string[], index: number): ParsedRow | null {
  const texts = cells.map((cell) => clean(cell, 500)).filter(Boolean);
  if (texts.length < 2) return null;
  const dateText = texts.find((text) => DATE_PATTERN.test(text)) ?? '';
  const timeText = texts.find((text) => TIME_PATTERN.test(text)) ?? '';
  // The description cell can echo the location; the location cell is the
  // shortest state-bearing one that carries no date.
  const location = texts
    .filter((text) => STATE_PATTERN.test(text) && !DATE_PATTERN.test(text))
    .sort((left, right) => left.length - right.length)[0] ?? '';
  const description = texts
    .filter((text) => text !== dateText && text !== timeText && text !== location)
    .sort((left, right) => right.length - left.length)[0] ?? '';
  if (!description) return null;
  const at = eventTime(dateText, timeText, location);
  const stage = uspsStage(description) ?? undefined;
  const rawTime = clean(dateText === timeText ? dateText : `${dateText} ${timeText}`, 64);
  return {
    event: {
      ...(at ? { time: at.iso } : rawTime ? { time: rawTime } : {}),
      ...(location ? { location: location.slice(0, 250) } : {}),
      // A delivered line may name who signed; the event keeps the fact, not the name.
      description: stage === 'delivered' ? 'Delivered' : description,
      ...(stage ? { stage } : {}),
    },
    timestamp: at?.timestamp ?? Number.NEGATIVE_INFINITY,
    index,
  };
}

/** The server-rendered tracking page. */
export function parseUSPSTrackingHtml(page: string, trackingNumber: string): CarrierResult {
  const number = normalizeUSPSNumber(trackingNumber);
  const $ = load(page);
  $('script, style, noscript').remove();
  if ($('.track-bar-container').length === 0) {
    throw new ChallengeError('USPS', 'USPS challenged the browser tracking session');
  }
  const echoed = clean($('#trackingNum').first().text()).toLocaleUpperCase('en-US');
  if (echoed !== number) {
    throw new SchemaError('USPS', 'USPS did not return the requested parcel');
  }
  // The page reuses .banner-header for an upsell banner; only the verdict
  // wrapper carries the tracking verdict.
  const banner = clean($('.latest-update-banner-wrapper .banner-header').first().text());
  if (/tracking not available/i.test(banner)) return notLocated();
  const statusArea = clean($('.current-tracking-status-wrapper').first().text(), 5_000);
  const rows: ParsedRow[] = [];
  $('.tracking_history_container tr').each((index, row) => {
    const cells = $(row).find('td').map((_, cell) => $(cell).text()).get();
    if (cells.length === 0) return;
    const parsed = parseRow(cells, index);
    if (parsed) rows.push(parsed);
  });
  rows.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const events = rows.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);
  const statusText = statusArea || banner || events[0]?.description || 'Tracking information received';
  const stage = uspsStage(`${statusText} ${banner}`)
    ?? events.map((event) => event.stage).find((value): value is NonNullable<typeof value> => value !== undefined);
  const status = uspsStatus(`${statusText} ${banner}`, events.length > 0);
  const delivered = stage === 'delivered';
  return {
    status,
    ...(stage ? { current_stage: stage } : {}),
    last_status_text: delivered ? 'Delivered' : statusText,
    last_update: events[0]?.time || null,
    expected_delivery: delivered ? null : expectedDelivery(`${statusArea} ${banner}`),
    events,
  };
}

export interface USPSTrackerOptions {
  timeoutMs?: number;
  /** Legacy configuration seam; `trawl` is preferred. */
  trawlUrl?: string;
  /** The browser service, or null when none is configured. */
  trawl?: TrawlClient | null;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
}

export class USPSTracker {
  readonly timeoutMs: number;
  readonly trawlUrl: string;
  readonly #trawl: TrawlClient | null | undefined;
  readonly #fetcher: typeof fetch | undefined;
  readonly #recorder: StepRecorder;

  constructor(options: USPSTrackerOptions = {}) {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new TypeError('USPS timeout must be positive');
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
    const number = normalizeUSPSNumber(trackingNumber);
    // Akamai refuses every non-browser client, so a direct attempt only burns
    // time. There is one step, and it is the browser.
    const trawl = this.#browserService();
    if (!trawl) {
      throw new ChallengeError(
        'USPS',
        'USPS challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
      );
    }
    return runSteps<CarrierResult>({
      carrier: 'usps', budgetMs: this.timeoutMs, recorder: this.#recorder,
    }, [
      { id: 'trawl', run: () => this.#trawlResult(trawl, number) },
    ]);
  }

  /** Read the browser's rendered page without replaying its session. An
   * unresolved challenge remains an error so universal fallback can run. */
  async #trawlResult(trawl: TrawlClient, number: string): Promise<CarrierResult> {
    const page = await trawl.scrape({
      url: uspsTrackingUrl(number),
      skipHttp: true,
      maxTier: 3,
      maxTimeout: this.timeoutMs,
    }, {
      provider: 'TRAWL while fetching USPS',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_BYTES,
      fetcher: this.#fetcher,
    });
    const result = parseUSPSTrackingHtml(page.html, number);
    result.tracking_url = uspsTrackingUrl(number);
    result.tracking_source = 'rendered-page';
    return result;
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new USPSTracker({
    fetcher: environment.fetcher,
    trawl: environment.trawl,
    recorder: environment.recorder,
  });
  return {
    id: 'usps',
    // Akamai refuses every non-browser client, so there is no direct tier.
    steps: ['trawl'],
    track: (input) => tracker.fetch(input.number),
  };
};
