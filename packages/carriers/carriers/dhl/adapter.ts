/**
 * DHL Paket and tracked mail, through the public recipient endpoint behind
 * www.dhl.de (`/int-verfolgen/data`).
 *
 * The lookup establishes a cookie and CSRF session on `/config`, then reads
 * `/search` with the same `verfolgen-CSRF-token` and `verfolgen-wg` headers
 * DHL's own recipient page sends. Cookies stay in memory. A rejected or
 * expired session, and an interrupted read, get one fresh HTTP session inside
 * the `direct` step; only then does the `trawl` step ask the private browser
 * service for a solved session, whose cookies and user agent seed a new HTTP
 * session. Rate limits and server errors stay errors: they are never routed
 * through a browser.
 *
 * DHL's business API credentials are not needed for this public flow.
 */
import 'server-only';

import makeFetchCookie from 'fetch-cookie';
import { Cookie, CookieJar } from 'tough-cookie';
import type { AdapterFactory } from '../../core/adapter';
import {
  ChallengeError, IndeterminateError, InputRequiredError, RateLimitedError, SchemaError,
  type CarrierErrorOptions,
} from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps, singleFlight } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { isoTime } from '../../core/time';
import {
  clean as cleanText, fetchBounded, parseJsonBytes, TrawlClient, UpstreamHttpError, UpstreamNetworkError,
} from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { stageForText, statusForStage } from './status';

const PROVIDER = 'DHL';
const TIMEZONE = 'Europe/Berlin';
const ORIGIN = 'https://www.dhl.de';
const DATA_PATH = '/int-verfolgen/data';
const CONFIG_URL = `${ORIGIN}${DATA_PATH}/config?domain=de&language=en`;
const TRACKING_PAGE = `${ORIGIN}/en/privatkunden/dhl-sendungsverfolgung.html`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const MAX_BYTES = 2_000_000;
/** The exact hosts DHL names when Swiss Post runs the last mile. */
const SWISS_POST_HOSTS = ['post.ch', 'www.post.ch', 'service.post.ch'];

/**
 * DHL status wording occasionally carries markup. Tags are dropped without a
 * separator, as this adapter has always done, before the shared cleaner
 * collapses whitespace and caps the length.
 */
function clean(value: unknown, limit = 500): string {
  return typeof value === 'string' ? cleanText(value.replace(/<[^>]*>/g, ''), limit) : '';
}

export function normalizeDHLTrackingNumber(raw: string): string {
  const value = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^[A-Z0-9]{5,40}$/.test(value)) throw new TypeError('DHL tracking number is invalid');
  return value;
}

export function dhlTrackingUrl(number: string): string {
  const url = new URL(TRACKING_PAGE);
  url.searchParams.set('piececode', normalizeDHLTrackingNumber(number));
  return url.toString();
}

/**
 * DHL timestamps carry their own offset and its delivery window is a calendar
 * day; both are kept verbatim rather than normalized, so `core/time` is used
 * to validate them in the German zone only.
 */
function date(value: unknown): string {
  const raw = clean(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(raw)) return '';
  return isoTime(raw, TIMEZONE) ? raw : '';
}

function millis(value: unknown): number {
  return isoTime(value, TIMEZONE)?.timestamp ?? 0;
}

function noData(): CarrierResult {
  return { status: 'unknown', last_status_text: 'DHL has not published tracking information for this shipment yet', last_update: null, expected_delivery: null, events: [] };
}

/** Parse only public status fields: never persist recipient, address, signature or service data. */
export function parseDHLTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizeDHLTrackingNumber(trackingNumber);
  if (!isRecord(payload)) throw new SchemaError(PROVIDER, 'DHL returned an invalid tracking response');
  if (payload.rateLimited === true || payload.isRateLimited === true) throw new RateLimitedError(PROVIDER);
  if (!Array.isArray(payload.sendungen)) throw new SchemaError(PROVIDER, 'DHL returned an invalid tracking response');
  if (payload.sendungen.length === 0) throw new SchemaError(PROVIDER, 'DHL returned an empty tracking response');
  const matches = payload.sendungen.filter(isRecord).filter((shipment) => {
    const info = isRecord(shipment.sendungsinfo) ? shipment.sendungsinfo : {};
    const details = isRecord(shipment.sendungsdetails) ? shipment.sendungsdetails : {};
    const numbers = isRecord(details.sendungsnummern) ? details.sendungsnummern : {};
    return [shipment.id, info.gesuchteSendungsnummer, numbers.sendungsnummer]
      .some((value) => clean(value, 64).toUpperCase() === requested);
  });
  if (matches.length !== 1) throw new SchemaError(PROVIDER, 'DHL did not return one matching shipment');
  const shipment = matches[0]!;
  if (shipment.plzBenoetigt === true || shipment.versandDatumBenoetigt === true) {
    throw new InputRequiredError(PROVIDER, 'a postcode or shipping date', 'DHL requires additional verification on its tracking website');
  }
  const missing = isRecord(shipment.sendungNichtGefunden) ? shipment.sendungNichtGefunden : {};
  if (missing.keineDhlPaketSendung === true || missing.sendungsnummerNichtSuchbar === true) {
    throw new IndeterminateError(PROVIDER, 'This DHL service needs its own tracking website');
  }
  const details = isRecord(shipment.sendungsdetails) ? shipment.sendungsdetails : {};
  const timeline = isRecord(details.sendungsverlauf) ? details.sendungsverlauf : {};
  if (timeline.events !== undefined && !Array.isArray(timeline.events)) throw new SchemaError(PROVIDER, 'DHL returned invalid tracking events');
  const events: CarrierEvent[] = (Array.isArray(timeline.events) ? timeline.events : []).filter(isRecord).flatMap((event) => {
    const description = clean(event.status);
    if (!description) return [];
    return [{ time: date(event.datum), location: clean(event.ort, 160), description, stage: stageForText(description) }];
  }).sort((left, right) => millis(right.time) - millis(left.time)).slice(0, 100);
  // DHL includes the destination postal operator in the arrival event. Trust
  // exact official hosts only; never follow an arbitrary URL from status text.
  const swissPostHandoff = events.some(({ description }) =>
    [...String(description).matchAll(/https?:\/\/[^\s<>"')]+/gi)].some(([raw]) => {
      try { return SWISS_POST_HOSTS.includes(new URL(raw).hostname.toLowerCase()); }
      catch { return false; }
    }),
  );
  const summary = clean(timeline.status);
  if (!events.length && !summary && details.istZugestellt !== true) {
    if (Object.values(missing).some((flag) => flag === true)) return noData();
    throw new SchemaError(PROVIDER, 'DHL returned no usable tracking status');
  }
  const currentText = summary || events[0]?.description || 'Delivered';
  const fallback = Number(timeline.fortschritt) <= 1 ? 'registered' : String(events[0]?.stage || 'in_transit');
  const stage = details.istZugestellt === true
    ? details.ruecksendung === true ? 'returned' : 'delivered'
    : stageForText(currentText, fallback);
  const delivery = isRecord(details.zustellung) ? details.zustellung : {};
  const expected = date(delivery.zustellzeitfensterVon) || date(delivery.zustellzeitfensterBis);
  return {
    status: statusForStage(stage), current_stage: stage,
    last_status_text: currentText,
    last_update: date(timeline.datumAktuellerStatus) || events[0]?.time || null,
    expected_delivery: ['delivered', 'returned'].includes(stage) ? null : expected.slice(0, 10) || null,
    timezone: TIMEZONE, events,
    ...(swissPostHandoff ? { delivery_carrier: 'swiss-post' as const } : {}),
  };
}

/**
 * DHL answered with a redirect, an unauthorized status or a non-JSON body:
 * the session is no longer accepted and has to be established again, from a
 * browser when plain HTTP keeps being refused.
 */
export class DHLSessionError extends ChallengeError {
  constructor(options?: CarrierErrorOptions) {
    super(PROVIDER, 'DHL rejected the tracking session', options);
    this.name = 'DHLSessionError';
  }
}

/** A rejected session or an interrupted read may be retried; anything else is an answer. */
function renewable(error: unknown): boolean {
  return error instanceof DHLSessionError || error instanceof UpstreamNetworkError;
}

class DHLSession {
  readonly jar = new CookieJar();
  readonly fetcher: typeof fetch;
  private userAgent = USER_AGENT;
  private token = '';
  private wg = '0';

  constructor(readonly timeoutMs: number, fetcher?: typeof fetch) {
    this.fetcher = makeFetchCookie(fetcher ?? fetch, this.jar);
  }

  async seed(cookies: unknown[], userAgent: unknown): Promise<void> {
    this.userAgent = clean(userAgent, 1_024) || USER_AGENT;
    for (const value of cookies) {
      if (!isRecord(value)) continue;
      const domain = clean(value.domain).toLowerCase().replace(/^\./, '');
      if (domain !== 'dhl.de' && !domain.endsWith('.dhl.de')) continue;
      const name = clean(value.name);
      if (!name || typeof value.value !== 'string') continue;
      const path = clean(value.path).startsWith('/') ? clean(value.path) : '/';
      await this.jar.setCookie(new Cookie({
        key: name, value: value.value, domain, path,
        secure: value.secure === true, httpOnly: value.httpOnly === true,
        expires: typeof value.expires === 'number' && value.expires > 0 ? new Date(value.expires * 1_000) : 'Infinity',
      }), `https://${domain}${path}`);
    }
  }

  async fetch(number: string): Promise<CarrierResult> {
    if (!this.token) {
      const config = await this.request(CONFIG_URL);
      if (typeof config.verfolgenCsrfToken !== 'string' || !config.verfolgenCsrfToken) throw new DHLSessionError();
      this.token = config.verfolgenCsrfToken;
      this.wg = typeof config.initialWG === 'number' ? String(config.initialWG) : '0';
    }
    const url = new URL(`${ORIGIN}${DATA_PATH}/search`);
    url.search = new URLSearchParams({ piececode: number, noRedirect: 'true', language: 'en' }).toString();
    return parseDHLTrackingResponse(await this.request(url), number);
  }

  private async request(url: string | URL): Promise<JsonObject> {
    const { response, bytes } = await fetchBounded(url, { headers: {
      Accept: 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': this.userAgent, Referer: TRACKING_PAGE,
      'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
      ...(this.token ? { 'verfolgen-CSRF-token': this.token, 'verfolgen-wg': this.wg } : {}),
    } }, {
      provider: PROVIDER, timeoutMs: this.timeoutMs, maxBytes: MAX_BYTES,
      fetcher: this.fetcher, redirect: 'manual', allowHttpError: true,
    });
    if ([301, 302, 303, 307, 308, 401, 403, 419].includes(response.status)) throw new DHLSessionError();
    if (!response.ok) throw new UpstreamHttpError(PROVIDER, response.status);
    if (!response.headers.get('content-type')?.includes('application/json')) throw new DHLSessionError();
    const value = parseJsonBytes(bytes, PROVIDER);
    if (!isRecord(value)) throw new SchemaError(PROVIDER, 'DHL returned an invalid tracking response');
    const token = response.headers.get('verfolgen-CSRF-token');
    if (token) this.token = token;
    return value;
  }
}

export interface DHLTrackerOptions {
  /** Budget for one browser solve; also the ceiling for the whole lookup. */
  timeoutMs?: number;
  /** Budget for a single HTTP request of the direct session. */
  directTimeoutMs?: number;
  budgetMs?: number;
  /** The host's browser service. Preferred over `trawlUrl`. */
  trawl?: TrawlClient | null;
  /** Browser service URL, for the host's default constructor and for tests. */
  trawlUrl?: string;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
}

export class DHLTracker {
  readonly timeoutMs: number;
  readonly directTimeoutMs: number;
  readonly budgetMs: number;
  readonly trawlUrl: string;
  private readonly trawl: TrawlClient | null;
  private readonly fetcher?: typeof fetch;
  private readonly recorder: StepRecorder;
  private readonly serialize = singleFlight();
  private session: DHLSession | null = null;

  constructor(options: DHLTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.directTimeoutMs = options.directTimeoutMs ?? 15_000;
    // Two direct sessions (config plus search each) and a browser solve
    // followed by the session it seeds, with room for the transport itself.
    this.budgetMs = options.budgetMs ?? this.timeoutMs + 4 * this.directTimeoutMs + 30_000;
    this.trawl = options.trawl ?? null;
    this.trawlUrl = (options.trawlUrl ?? process.env.FLARESOLVERR_URL ?? '').trim();
    this.fetcher = options.fetcher;
    this.recorder = options.recorder ?? NOOP_RECORDER;
  }

  /** Lookups share one session, so two parcels never renew it at the same time. */
  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const number = normalizeDHLTrackingNumber(trackingNumber);
    return this.serialize(() => this.lookup(number));
  }

  private async lookup(number: string): Promise<CarrierResult> {
    try {
      return await runSteps<CarrierResult>({ carrier: 'dhl', budgetMs: this.budgetMs, recorder: this.recorder }, [
        { id: 'direct', run: () => this.direct(number) },
        { id: 'trawl', enabled: this.trawl !== null || this.trawlUrl !== '', recovers: renewable, run: () => this.browser(number) },
      ]);
    } catch (error) {
      // A session that ended the lookup is never reused by the next one.
      if (renewable(error)) this.session = null;
      throw error;
    }
  }

  /** The direct session, renewing a stale one or an interrupted read once. */
  private async direct(number: string): Promise<CarrierResult> {
    const cached = this.session !== null;
    this.session ??= new DHLSession(this.directTimeoutMs, this.fetcher);
    try {
      return await this.session.fetch(number);
    } catch (error) {
      // A fresh session that was rejected outright needs a browser, not a
      // second identical attempt; a cached one may simply have expired.
      if (!renewable(error) || (!cached && !(error instanceof UpstreamNetworkError))) throw error;
      this.session = new DHLSession(this.directTimeoutMs, this.fetcher);
      return await this.session.fetch(number);
    }
  }

  /** A solved browser session, replayed over HTTP with its cookies and user agent. */
  private async browser(number: string): Promise<CarrierResult> {
    this.session = null;
    const trawl = this.trawl ?? new TrawlClient(this.trawlUrl, this.fetcher);
    const solved = await trawl.scrape(
      { url: dhlTrackingUrl(number), skipHttp: true, maxTier: 3, maxTimeout: this.timeoutMs },
      { provider: `TRAWL while fetching ${PROVIDER}`, timeoutMs: this.timeoutMs, maxBytes: 10_000_000, fetcher: this.fetcher },
    );
    const session = new DHLSession(this.directTimeoutMs, this.fetcher);
    await session.seed(solved.cookies, solved.userAgent);
    const result = await session.fetch(number);
    this.session = session;
    return result;
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new DHLTracker({
    fetcher: environment.fetcher, trawl: environment.trawl, trawlUrl: '', recorder: environment.recorder,
  });
  return {
    id: 'dhl',
    steps: ['direct', 'trawl'],
    track: (input) => tracker.fetch(input.number),
  };
};
