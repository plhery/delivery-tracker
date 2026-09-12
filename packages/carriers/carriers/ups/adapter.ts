import 'server-only';

import { load } from 'cheerio';
import makeFetchCookie from 'fetch-cookie';
import { Cookie, CookieJar } from 'tough-cookie';
import type { AdapterFactory } from '../../core/adapter';
import { ChallengeError, IndeterminateError, SchemaError, TransportError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps, singleFlight } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { calendarDay } from '../../core/time';
import { clean, cleanScalar, decodeText, fetchBounded, parseJsonBytes, TrawlClient } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { UPS_PROGRESS_STATUS, upsStatus } from './status';

const TRACKING_BASE = 'https://www.ups.com/track';
const STATUS_API = 'https://webapis.ups.com/track/api/Track/GetStatus?loc=en_US';
const MAX_BYTES = 10_000_000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0';
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_DIRECT_TIMEOUT_MS = 20_000;
// Provider strings are short; the rendered page's whole text is not, and the
// identity check reads all of it, so it passes its own limit to `clean`.
const PAGE_TEXT_LIMIT = 2_000_000;

export function upsTrackingUrl(trackingNumber: string): string {
  const url = new URL(TRACKING_BASE);
  url.searchParams.set('loc', 'en_US');
  url.searchParams.set('tracknum', trackingNumber);
  url.searchParams.set('requester', 'ST/trackdetails');
  return url.toString();
}

/**
 * Akamai rejected the session (HTTP 401/403/419/429, or a page that carries no
 * XSRF token). It stays a distinct class because the adapter reacts to it: the
 * cached session is refreshed once, then dropped, before the browser tier runs.
 */
export class UPSSessionRejected extends ChallengeError {
  constructor(message: string) {
    super('UPS', message);
    this.name = 'UPSSessionRejected';
  }
}

class UPSHttpSession {
  readonly jar = new CookieJar();
  readonly #fetcher: typeof fetch;
  #userAgent = USER_AGENT;

  constructor(readonly timeoutMs: number, fetcher?: typeof fetch) {
    // Resolve the global lazily so a test seam installed after construction
    // still sees the request.
    this.#fetcher = makeFetchCookie(fetcher ?? ((input, init) => fetch(input, init)), this.jar);
  }

  async fetchPage(url: string): Promise<string> {
    const result = await this.request(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        DNT: '1',
        Pragma: 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-GPC': '1',
        'Upgrade-Insecure-Requests': '1',
        'User-Agent': this.#userAgent,
      },
    }, 'UPS tracking page');
    return decodeText(result);
  }

  async fetchStatus(trackingNumber: string): Promise<JsonObject> {
    const token = await this.xsrfToken();
    if (!token) throw new UPSSessionRejected('The UPS session has no XSRF token');
    const clientUrl = upsTrackingUrl(trackingNumber);
    const bytes = await this.request(STATUS_API, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
        DNT: '1',
        Origin: 'https://www.ups.com',
        Referer: clientUrl,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'Sec-GPC': '1',
        'User-Agent': this.#userAgent,
        'X-XSRF-TOKEN': token,
      },
      body: JSON.stringify({
        Locale: 'en_US',
        TrackingNumber: [trackingNumber.toLocaleLowerCase('en-US')],
        isBarcodeScanned: false,
        Requester: 'st/trackdetails',
        ClientUrl: clientUrl,
        returnToValue: '',
        AssociatedBcdnNumber: null,
      }),
    }, 'UPS status API');
    const payload = parseJsonBytes(bytes, 'UPS');
    if (!isRecord(payload)) throw new UPSSessionRejected('UPS returned an invalid tracking response');
    return payload;
  }

  async seedBrowserCookies(cookies: unknown[], userAgent: unknown): Promise<void> {
    const browserUserAgent = clean(userAgent, 1_024);
    if (browserUserAgent) this.#userAgent = browserUserAgent;
    await this.jar.removeAllCookies();
    for (const value of cookies) {
      if (!isRecord(value)) continue;
      const name = clean(value.name);
      const cookieValue = String(value.value ?? '');
      const domain = clean(value.domain).toLocaleLowerCase('en-US');
      if (!name || !validCookieDomain(domain)) continue;
      const path = clean(value.path).startsWith('/') ? clean(value.path) : '/';
      const rawExpires = Number(value.expires);
      const expires = Number.isFinite(rawExpires) && rawExpires > 0
        ? new Date(rawExpires * 1_000)
        : 'Infinity';
      const cookie = new Cookie({
        key: name,
        value: cookieValue,
        domain,
        path,
        secure: Boolean(value.secure),
        httpOnly: Boolean(value.httpOnly),
        expires,
      });
      await this.jar.setCookie(cookie, `https://${domain.replace(/^\./, '')}${path}`);
    }
  }

  async xsrfToken(): Promise<string> {
    const cookies = await this.jar.getCookies(STATUS_API);
    const value = cookies.find((cookie) => cookie.key === 'X-XSRF-TOKEN-ST')?.value ?? '';
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  private async request(
    url: string,
    init: RequestInit,
    description: string,
  ): Promise<Uint8Array> {
    const result = await fetchBounded(url, init, {
      provider: description,
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_BYTES,
      redirect: 'follow',
      fetcher: this.#fetcher,
      allowHttpError: true,
    });
    if ([401, 403, 419, 429].includes(result.response.status)) {
      throw new UPSSessionRejected(`${description} returned HTTP ${result.response.status}`);
    }
    // Any other rejected status proves nothing about the shipment, so the
    // browser tier is still allowed to answer it.
    if (!result.response.ok) {
      throw new IndeterminateError('UPS', `${description} returned HTTP ${result.response.status}`);
    }
    return result.bytes;
  }
}

function validCookieDomain(domain: string): boolean {
  const bare = domain.replace(/^\./, '');
  return bare === 'ups.com' || bare.endsWith('.ups.com');
}

function withoutIcons(value: string): string {
  return clean(value.replace(/\b(?:check_circle|content_copy|expand_more|check)\b/g, ' '));
}

function notLocated(): CarrierResult {
  return {
    status: 'unknown',
    last_status_text: 'UPS could not locate the shipment',
    last_update: null,
    expected_delivery: null,
    events: [],
  };
}

/**
 * The rendered tracking page, used when no structured answer can be had. It
 * carries the current status and the delivery location block, never a history.
 */
export function parseUPSTrackingHtml(page: string, trackingNumber: string): CarrierResult {
  const $ = load(page);
  $('script, style, noscript').remove();
  const expected = trackingNumber.toUpperCase();
  const visible = clean($('body').text(), PAGE_TEXT_LIMIT).toUpperCase();
  const metaNumbers = $('meta[name]').map((_, element) => {
    const name = clean($(element).attr('name')).toLocaleLowerCase('en-US');
    return ['stapp-tracknum', 'appvars.trk_tracknum'].includes(name)
      ? clean($(element).attr('content')).toUpperCase()
      : '';
  }).get();
  if (!visible.includes(expected) && !metaNumbers.includes(expected)) {
    throw new SchemaError('UPS', 'UPS did not return the requested parcel');
  }
  if (/could not locate|invalid tracking|not valid tracking/i.test(visible)) return notLocated();
  let statusText = withoutIcons(clean($('#stApp_nameKey').last().text()));
  const progress = withoutIcons(clean($('#stApp_shpmtProgress').last().text()));
  const currentStatus = upsStatus(`${statusText} ${progress}`);
  if (!statusText) statusText = progress || 'Tracking information received';
  let location = clean($('#stApp_deliveredToAddress').last().text());
  if (!location) {
    location = clean(`${$('#stApp_txtAddress').last().text()} ${$('#stApp_txtCountry').last().text()}`);
  }
  const events: CarrierEvent[] = currentStatus === 'unknown'
    ? []
    : [{ time: '', location, description: statusText }];
  return {
    status: currentStatus,
    last_status_text: statusText,
    last_update: null,
    expected_delivery: null,
    events,
  };
}

/**
 * An activity timestamp. UPS sends the same scan twice: a UTC pair
 * (`gmtDate` / `gmtTime`) and a local pair with a `gmtOffset`. Both are
 * assembled into an offset-carrying ISO string rather than parsed, so no zone
 * is ever guessed; a scan with neither keeps the provider's own text.
 */
function activityTime(activity: JsonObject): string {
  const gmtDate = cleanScalar(activity.gmtDate);
  const gmtTime = cleanScalar(activity.gmtTime);
  if (/^\d{8}$/.test(gmtDate) && /^\d{2}:\d{2}:\d{2}$/.test(gmtTime)) {
    return `${gmtDate.slice(0, 4)}-${gmtDate.slice(4, 6)}-${gmtDate.slice(6, 8)}T${gmtTime}+00:00`;
  }
  const localDate = cleanScalar(activity.date);
  const localTime = cleanScalar(activity.time).replace(/\.M\./gi, 'M');
  const offset = cleanScalar(activity.gmtOffset);
  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(localDate);
  const timeMatch = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(localTime);
  if (dateMatch && timeMatch && /^[+-]\d{2}:\d{2}$/.test(offset)) {
    let hour = Number(timeMatch[1]);
    if (timeMatch[3]!.toUpperCase() === 'PM' && hour !== 12) hour += 12;
    if (timeMatch[3]!.toUpperCase() === 'AM' && hour === 12) hour = 0;
    return `${dateMatch[3]}-${dateMatch[1]}-${dateMatch[2]}T${String(hour).padStart(2, '0')}:${timeMatch[2]}:00${offset}`;
  }
  return clean(`${localDate} ${localTime}`);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const DAY_MS = 86_400_000;

/**
 * The scheduled delivery date. UPS sends a month key and a day number but no
 * year, so the year is the one that puts the date within the last week or in
 * the future.
 */
function expectedDelivery(detail: JsonObject, today: Date): string | null {
  if (!isRecord(detail.scheduledDeliveryDateDetail)) return null;
  const value = detail.scheduledDeliveryDateDetail;
  const month = MONTHS[cleanScalar(value.monthCMSKey).split('.').at(-1)?.toLocaleLowerCase('en-US') ?? ''];
  const day = Number(cleanScalar(value.dayNum));
  if (!month || !Number.isInteger(day) || day < 1 || day > 31) return null;
  const year = today.getUTCFullYear();
  const candidate = calendarDay(year, month, day);
  if (!candidate) return null;
  const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Date.parse(candidate) < utcToday - 7 * DAY_MS ? calendarDay(year + 1, month, day) : candidate;
}

/** The structured answer of the tracking page's own status API. */
export function parseUPSTrackingResponse(
  payload: unknown,
  trackingNumber: string,
  today = new Date(),
): CarrierResult {
  if (!isRecord(payload)) throw new SchemaError('UPS');
  if (String(payload.statusCode ?? '') !== '200') {
    throw new IndeterminateError('UPS', clean(payload.statusText) || 'UPS tracking is unavailable');
  }
  if (!Array.isArray(payload.trackDetails) || payload.trackDetails.length === 0) return notLocated();
  const expected = trackingNumber.toUpperCase();
  const detail = payload.trackDetails.find((item) => isRecord(item)
    && cleanScalar(item.trackingNumber ?? item.requestedTrackingNumber).toUpperCase() === expected)
    ?? payload.trackDetails[0];
  if (!isRecord(detail)) throw new SchemaError('UPS');
  const returned = cleanScalar(detail.trackingNumber ?? detail.requestedTrackingNumber);
  if (returned && returned.toUpperCase() !== expected) {
    throw new SchemaError('UPS', 'UPS did not return the requested parcel');
  }
  const errorText = clean(detail.errorText);
  if (detail.errorCode || errorText) {
    return { ...notLocated(), last_status_text: errorText || 'UPS could not locate the shipment' };
  }
  const events: CarrierEvent[] = [];
  if (Array.isArray(detail.shipmentProgressActivities)) {
    for (const raw of detail.shipmentProgressActivities) {
      if (!isRecord(raw)) continue;
      const milestone = isRecord(raw.milestoneName) ? clean(raw.milestoneName.name) : '';
      let description = clean(raw.activityScan) || milestone;
      const additional = clean(raw.activityAdditionalDescription);
      if (additional && !description.toLocaleLowerCase('en-US').includes(additional.toLocaleLowerCase('en-US'))) {
        description = clean(`${description} — ${additional}`);
      }
      if (!description) continue;
      events.push({
        time: activityTime(raw),
        location: clean(raw.location),
        description,
      });
    }
  }
  const currentName = isRecord(detail.currentMilestone) ? clean(detail.currentMilestone.name) : '';
  const statusText = events[0]?.description
    || clean(detail.packageStatus ?? detail.simplifiedText)
    || currentName
    || 'Tracking information received';
  const progress = clean(detail.progressBarType).toLocaleLowerCase('en-US');
  return {
    status: UPS_PROGRESS_STATUS[progress] ?? upsStatus(
      [detail.packageStatus, detail.simplifiedText, currentName, statusText].map((value) => clean(value)).join(' '),
      events.length > 0,
    ),
    last_status_text: statusText,
    last_update: events[0]?.time || null,
    expected_delivery: expectedDelivery(detail, today),
    events,
  };
}

export interface UPSTrackerOptions {
  timeoutMs?: number;
  directTimeoutMs?: number;
  /** Legacy configuration seam; `trawl` is preferred. */
  trawlUrl?: string;
  /** The browser service, or null when none is configured. */
  trawl?: TrawlClient | null;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
}

export class UPSTracker {
  readonly timeoutMs: number;
  readonly directTimeoutMs: number;
  readonly trawlUrl: string;
  readonly #trawl: TrawlClient | null | undefined;
  readonly #fetcher: typeof fetch | undefined;
  readonly #recorder: StepRecorder;
  readonly #serialize = singleFlight();
  #session: UPSHttpSession | null = null;

  constructor(options: UPSTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.directTimeoutMs = Math.max(1_000, Math.min(
      this.timeoutMs,
      options.directTimeoutMs ?? DEFAULT_DIRECT_TIMEOUT_MS,
    ));
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
    // One lookup at a time: the cached session's cookies and XSRF token are
    // shared state and must never be refreshed by two lookups at once.
    return this.#serialize(async () => {
      const number = trackingNumber.toUpperCase();
      if (!/^1Z[A-Z0-9]{16}$/.test(number)) {
        throw new SchemaError('UPS', 'UPS tracking numbers must start with 1Z and contain 18 characters');
      }
      return this.#lookup(number);
    });
  }

  async #lookup(number: string): Promise<CarrierResult> {
    const trawl = this.#browserService();
    // The direct page, kept so it can still be read when no browser service
    // exists and the structured call was refused.
    const page: { html: string | null } = { html: null };
    return runSteps<CarrierResult>({
      carrier: 'ups', budgetMs: this.timeoutMs, recorder: this.#recorder,
    }, [
      {
        id: 'direct',
        run: async () => {
          try {
            return await this.#directResult(number, page);
          } catch (error) {
            if (trawl) throw error;
            if (page.html !== null) {
              try {
                return this.#renderedResult(page.html, number);
              } catch {
                // The direct page was itself a challenge; surface the actionable setup error.
              }
            }
            throw new ChallengeError(
              'UPS',
              'UPS challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
              { cause: error },
            );
          }
        },
      },
      {
        id: 'trawl',
        enabled: trawl !== null,
        run: () => this.#trawlResult(trawl!, number),
      },
    ]);
  }

  /** The cached session, then a fresh one; both talk plain HTTP to the status API. */
  async #directResult(number: string, page: { html: string | null }): Promise<CarrierResult> {
    const cached = this.#session;
    if (cached) {
      try {
        return await this.#apiResult(number, cached);
      } catch (error) {
        if (!(error instanceof UPSSessionRejected)) throw error;
        try {
          await cached.fetchPage(upsTrackingUrl(number));
          return await this.#apiResult(number, cached);
        } catch (refreshError) {
          if (!(refreshError instanceof UPSSessionRejected)) throw refreshError;
          this.#session = null;
        }
      }
    }
    const direct = new UPSHttpSession(this.directTimeoutMs, this.#fetcher);
    page.html = await direct.fetchPage(upsTrackingUrl(number));
    if (!await direct.xsrfToken()) throw new UPSSessionRejected('UPS challenged the direct tracking session');
    const result = await this.#apiResult(number, direct);
    this.#session = direct;
    return result;
  }

  /**
   * A real browser establishes the session; the structured API is then called
   * on its cookies. The page the browser rendered is the last resort.
   */
  async #trawlResult(trawl: TrawlClient, number: string): Promise<CarrierResult> {
    const bootstrap = await trawl.scrape({
      url: upsTrackingUrl(number),
      skipHttp: true,
      maxTier: 3,
      maxTimeout: this.timeoutMs,
    }, {
      provider: 'TRAWL while fetching UPS',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_BYTES,
      fetcher: this.#fetcher,
    });
    const browser = new UPSHttpSession(this.directTimeoutMs, this.#fetcher);
    await browser.seedBrowserCookies(bootstrap.cookies, bootstrap.userAgent);
    let browserError: unknown;
    if (await browser.xsrfToken()) {
      try {
        const result = await this.#apiResult(number, browser);
        this.#session = browser;
        return result;
      } catch (error) {
        browserError = error;
        // A rejected session is not worth keeping; anything else means the
        // session works and the payload was the problem.
        if (!(error instanceof UPSSessionRejected)) this.#session = browser;
      }
    }
    try {
      return this.#renderedResult(bootstrap.html, number);
    } catch (error) {
      if (browserError) {
        throw new ChallengeError('UPS', 'UPS rejected the browser-established session', { cause: browserError });
      }
      throw new TransportError('UPS', 'TRAWL did not establish a usable UPS session', { cause: error });
    }
  }

  async #apiResult(number: string, session: UPSHttpSession): Promise<CarrierResult> {
    const result = parseUPSTrackingResponse(await session.fetchStatus(number), number);
    result.tracking_url = upsTrackingUrl(number);
    result.tracking_source = 'structured-web-response';
    return result;
  }

  #renderedResult(page: string, number: string): CarrierResult {
    const result = parseUPSTrackingHtml(page, number);
    result.tracking_url = upsTrackingUrl(number);
    result.tracking_source = 'rendered-page';
    return result;
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new UPSTracker({
    fetcher: environment.fetcher,
    trawl: environment.trawl,
    recorder: environment.recorder,
  });
  return {
    id: 'ups',
    // `direct` covers the cached session, its one refresh and a fresh session:
    // all of them are the same plain-HTTP transport. `trawl` is the browser.
    steps: ['direct', 'trawl'],
    track: (input) => tracker.fetch(input.number),
  };
};
