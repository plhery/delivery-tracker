import 'server-only';

import makeFetchCookie from 'fetch-cookie';
import { Cookie, CookieJar } from 'tough-cookie';
import { DateTime } from 'luxon';
import { fetchBounded, parseJsonBytes, UpstreamHttpError, UpstreamNetworkError } from './boundedFetch';
import type { CarrierEvent, CarrierResult, CarrierStatus } from './carrierResult';
import { isRecord, type JsonObject } from './types';

const ORIGIN = 'https://www.dhl.de';
const DATA_PATH = '/int-verfolgen/data';
const CONFIG_URL = `${ORIGIN}${DATA_PATH}/config?domain=de&language=en`;
const TRACKING_PAGE = `${ORIGIN}/en/privatkunden/dhl-sendungsverfolgung.html`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const MAX_BYTES = 2_000_000;

function clean(value: unknown, limit = 500): string {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
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

function date(value: unknown): string {
  const raw = clean(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(raw)) return '';
  return DateTime.fromISO(raw, { zone: 'Europe/Berlin' }).isValid ? raw : '';
}

function stageForText(text: string, fallback = 'in_transit'): string {
  const value = text.toLowerCase();
  if (/return(?:ed|ing)? to (?:the )?sender|zurück.*absender|rücksendung|retour/.test(value)) return 'returned';
  if (/not delivered|could not be delivered|unable to deliver|delivery attempt|nicht.*zugestellt|zustellversuch|nicht angetroffen/.test(value)) return 'failed_attempt';
  if (/ready for (?:pickup|collection)|ready to (?:collect|pick up)|awaiting collection|abholbereit|zur abholung bereit/.test(value)) return 'ready_for_pickup';
  if (/has been delivered|was delivered|successfully delivered|^delivered\b|erfolgreich zugestellt|wurde.*zugestellt/.test(value)) return 'delivered';
  if (/^being delivered[.!]?$|out for delivery|loaded (?:into|onto).*delivery vehicle|in das zustellfahrzeug geladen|in zustellung/.test(value)) return 'out_for_delivery';
  if (/customs clearance process\b[^.]*\bhas been completed\b/.test(value)) return 'in_transit';
  if (/customs|zoll/.test(value)) return 'customs';
  if (/electronically|elektronisch|label created|shipment information|instruction data/.test(value)) return 'registered';
  if (/will be transported to the destination country/.test(value)) return 'in_transit';
  if (/pick-up was successful|accepted|handed (?:over|to)|eingeliefert|übergeben/.test(value)) return 'accepted';
  if (/processed|sorted|sorting|sortierung|bearbeitet|briefzentrum|paketzentrum|transit|transport|arrived|departed/.test(value)) return 'in_transit';
  return fallback;
}

function statusForStage(stage: string): CarrierStatus {
  if (stage === 'registered' || stage === 'pending') return 'pending';
  if (stage === 'delivered') return 'delivered';
  if (stage === 'out_for_delivery' || stage === 'ready_for_pickup') return 'out_for_delivery';
  if (stage === 'failed_attempt' || stage === 'returned') return 'exception';
  return 'in_transit';
}

function noData(): CarrierResult {
  return { status: 'unknown', last_status_text: 'DHL has not published tracking information for this shipment yet', last_update: null, expected_delivery: null, events: [] };
}

/** Parse only public status fields: never persist recipient, address, signature or service data. */
export function parseDHLTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizeDHLTrackingNumber(trackingNumber);
  if (!isRecord(payload)) throw new TypeError('DHL returned an invalid tracking response');
  if (payload.rateLimited === true || payload.isRateLimited === true) throw new UpstreamHttpError('DHL tracking', 429);
  if (!Array.isArray(payload.sendungen)) throw new TypeError('DHL returned an invalid tracking response');
  if (payload.sendungen.length === 0) throw new TypeError('DHL returned an empty tracking response');
  const matches = payload.sendungen.filter(isRecord).filter((shipment) => {
    const info = isRecord(shipment.sendungsinfo) ? shipment.sendungsinfo : {};
    const details = isRecord(shipment.sendungsdetails) ? shipment.sendungsdetails : {};
    const numbers = isRecord(details.sendungsnummern) ? details.sendungsnummern : {};
    return [shipment.id, info.gesuchteSendungsnummer, numbers.sendungsnummer]
      .some((value) => clean(value, 64).toUpperCase() === requested);
  });
  if (matches.length !== 1) throw new RangeError('DHL did not return one matching shipment');
  const shipment = matches[0]!;
  if (shipment.plzBenoetigt === true || shipment.versandDatumBenoetigt === true) {
    throw new Error('DHL requires additional verification on its tracking website');
  }
  const missing = isRecord(shipment.sendungNichtGefunden) ? shipment.sendungNichtGefunden : {};
  if (missing.keineDhlPaketSendung === true || missing.sendungsnummerNichtSuchbar === true) {
    throw new Error('This DHL service needs its own tracking website');
  }
  const details = isRecord(shipment.sendungsdetails) ? shipment.sendungsdetails : {};
  const timeline = isRecord(details.sendungsverlauf) ? details.sendungsverlauf : {};
  if (timeline.events !== undefined && !Array.isArray(timeline.events)) throw new TypeError('DHL returned invalid tracking events');
  const events: CarrierEvent[] = (Array.isArray(timeline.events) ? timeline.events : []).filter(isRecord).flatMap((event) => {
    const description = clean(event.status);
    if (!description) return [];
    return [{ time: date(event.datum), location: clean(event.ort, 160), description, stage: stageForText(description) }];
  }).sort((left, right) => {
    const leftTime = DateTime.fromISO(left.time, { zone: 'Europe/Berlin' }).toMillis();
    const rightTime = DateTime.fromISO(right.time, { zone: 'Europe/Berlin' }).toMillis();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  }).slice(0, 100);
  // DHL includes the destination postal operator in the arrival event. Trust
  // exact official hosts only; never follow an arbitrary URL from status text.
  const swissPostHandoff = events.some(({ description }) =>
    [...String(description).matchAll(/https?:\/\/[^\s<>"')]+/gi)].some(([raw]) => {
      try { return ['post.ch', 'www.post.ch', 'service.post.ch'].includes(new URL(raw).hostname.toLowerCase()); }
      catch { return false; }
    }),
  );
  const summary = clean(timeline.status);
  if (!events.length && !summary && details.istZugestellt !== true) {
    if (Object.values(missing).some((flag) => flag === true)) return noData();
    throw new TypeError('DHL returned no usable tracking status');
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
    timezone: 'Europe/Berlin', events,
    ...(swissPostHandoff ? { delivery_carrier: 'swiss-post' as const } : {}),
  };
}

export class DHLSessionError extends Error {
  constructor() { super('DHL rejected the tracking session'); this.name = 'DHLSessionError'; }
}

class DHLSession {
  readonly jar = new CookieJar();
  readonly fetcher = makeFetchCookie(fetch, this.jar);
  private userAgent = USER_AGENT;
  private token = '';
  private wg = '0';

  constructor(readonly timeoutMs: number) {}

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
      provider: 'DHL tracking', timeoutMs: this.timeoutMs, maxBytes: MAX_BYTES,
      fetcher: this.fetcher, redirect: 'manual', allowHttpError: true,
    });
    if ([301, 302, 303, 307, 308, 401, 403, 419].includes(response.status)) throw new DHLSessionError();
    if (!response.ok) throw new UpstreamHttpError('DHL tracking', response.status);
    if (!response.headers.get('content-type')?.includes('application/json')) throw new DHLSessionError();
    const value = parseJsonBytes(bytes, 'DHL');
    if (!isRecord(value)) throw new TypeError('DHL returned an invalid tracking response');
    const token = response.headers.get('verfolgen-CSRF-token');
    if (token) this.token = token;
    return value;
  }
}

export class DHLTracker {
  readonly timeoutMs: number;
  readonly directTimeoutMs: number;
  readonly trawlUrl: string;
  private session: DHLSession | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(options: { timeoutMs?: number; directTimeoutMs?: number; trawlUrl?: string } = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.directTimeoutMs = options.directTimeoutMs ?? 15_000;
    this.trawlUrl = (options.trawlUrl ?? process.env.FLARESOLVERR_URL ?? '').trim();
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const number = normalizeDHLTrackingNumber(trackingNumber);
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const cached = this.session !== null;
      this.session ??= new DHLSession(this.directTimeoutMs);
      let recoveryError: DHLSessionError | UpstreamNetworkError;
      try {
        return await this.session.fetch(number);
      } catch (error) {
        if (!(error instanceof DHLSessionError || error instanceof UpstreamNetworkError)) throw error;
        recoveryError = error;
      }
      // Renew stale sessions and retry interrupted reads once before using a browser.
      if (cached || recoveryError instanceof UpstreamNetworkError) {
        this.session = new DHLSession(this.directTimeoutMs);
        try { return await this.session.fetch(number); } catch (error) {
          if (!(error instanceof DHLSessionError || error instanceof UpstreamNetworkError)) throw error;
          recoveryError = error;
        }
      }
      this.session = null;
      if (!this.trawlUrl) throw recoveryError;
      const endpoint = new URL(this.trawlUrl);
      if (!['http:', 'https:'].includes(endpoint.protocol)) throw new TypeError('FLARESOLVERR_URL must be an HTTP(S) URL');
      endpoint.pathname = `${endpoint.pathname.replace(/\/(?:v1|scrape)\/?$/, '').replace(/\/$/, '')}/scrape`;
      const { bytes } = await fetchBounded(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ url: dhlTrackingUrl(number), skipHttp: true, maxTier: 3, maxTimeout: this.timeoutMs }),
      }, { provider: 'TRAWL while fetching DHL', timeoutMs: this.timeoutMs + 15_000, maxBytes: 10_000_000 });
      const browser = parseJsonBytes(bytes, 'TRAWL');
      if (!isRecord(browser) || browser.error || ![2, 3].includes(Number(browser.tier))
        || browser.statusCode !== 200 || !Array.isArray(browser.cookies)) {
        throw new DHLSessionError();
      }
      const session = new DHLSession(this.directTimeoutMs);
      await session.seed(browser.cookies, browser.userAgent);
      const result = await session.fetch(number);
      this.session = session;
      return result;
    } finally { release(); }
  }
}
