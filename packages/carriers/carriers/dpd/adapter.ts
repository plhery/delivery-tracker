import 'server-only';

import { randomBytes } from 'node:crypto';
import { load } from 'cheerio';
import type { AdapterFactory } from '../../core/adapter';
import {
  ChallengeError,
  IndeterminateError,
  NotFoundError,
  SchemaError,
  carrierErrorKind,
  type CarrierErrorKind,
  type CarrierErrorOptions,
} from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps, singleFlight } from '../../core/runner';
import type { StepRecorder } from '../../core/telemetry';
import { isoTime, explicitOffsetTime, zonedTime } from '../../core/time';
import { TrawlClient, decodeText, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { API_LABELS, apiStage, apiStatus, wordingStatus } from './status';

// Protocol provenance:
// - The myDPD Android application talks to a guest JSON API: a Firebase
//   installation identifies the app, Remote Config hands out the guest Basic
//   credential, that credential buys a client-credentials access token, and the
//   token reads `/v10/parcels/details/<number>`. Every value below is shipped
//   publicly in the application; none of it is an account secret.
// - The delivery postcode is optional. With it, DPD unlocks verified scans and
//   the delivery window; without it the lookup continues with
//   `continueWithoutVerification=true`. A rejected postcode (HTTP 400) is
//   retried once without verification and reported as unverified rather than
//   failing the lookup.
// - The consignee web page is the fallback when the guest API is inconclusive.
//   It sits behind Cloudflare, so it is fetched through the browser service's
//   legacy command API when one is configured and directly otherwise.
const TRACKING_BASE = 'https://www.dpdgroup.com/ch/mydpd/my-parcels/incoming';
const FETCH_BASE = 'https://www.dpdgroup.com/ch/mydpd/my-parcels/track';
const API_BASE = 'https://www.dpdgroup.com/concept/webservice';
const OAUTH_URL = `${API_BASE}/oauth/token?grant_type=client_credentials`;
const DETAILS_BASE = `${API_BASE}/v10/parcels/details`;
const FIREBASE_PROJECT = 'consignee-portal';
const FIREBASE_PROJECT_NUMBER = '959401347543';
const FIREBASE_APP_ID = '1:959401347543:android:8d1a84133332291109e392';
// Public, app-restricted identifier shipped in the myDPD Android application.
const FIREBASE_API_KEY = 'AIzaSyDHMkUNUyUwFrQzKJhdC_J-L7QEwNUzwrc'; // gitleaks:allow
const ANDROID_PACKAGE = 'com.dpdgroup.chatbot.lemny.prod';
const ANDROID_CERT = '3872ACD98DE975F69C68CAF5119A5A1B2024B873';
const CLIENT_VERSION = '3.79.14';
const INSTALLATIONS_URL = `https://firebaseinstallations.googleapis.com/v1/projects/${FIREBASE_PROJECT}/installations`;
const REMOTE_CONFIG_URL = `https://firebaseremoteconfig.googleapis.com/v1/projects/${FIREBASE_PROJECT_NUMBER}/namespaces/firebase:fetch`;
const TIMEZONE = 'Europe/Zurich';
const DEFAULT_TIMEOUT_MS = 90_000;
/** The browser service may spend the whole request timeout plus its own transport allowance. */
const SOLVER_ALLOWANCE_MS = 15_000;
const MAX_BYTES = 10_000_000;

/** Cloudflare interrupted the consignee page with an interactive challenge. */
export class DPDChallengeError extends ChallengeError {
  constructor(message = 'DPD returned a Cloudflare browser challenge', options?: CarrierErrorOptions) {
    super('DPD', message, options);
    this.name = 'DPDChallengeError';
  }
}

/**
 * The guest API answered, but the answer proves nothing about the shipment
 * (unreachable, malformed, unauthenticated, or an HTTP status the guest flow
 * handles itself). The rendered page is allowed to recover from it.
 */
export class DPDAPIError extends IndeterminateError {
  constructor(message: string, options?: CarrierErrorOptions) {
    super('DPD guest API', message, options);
    this.name = 'DPDAPIError';
  }
}

/** DPD positively reports that it does not know the parcel number. */
export class DPDTrackingError extends NotFoundError {
  constructor(options?: CarrierErrorOptions) {
    super('DPD', 'DPD could not locate the shipment', options);
    this.name = 'DPDTrackingError';
  }
}

class DPDAPIHttpError extends DPDAPIError {
  /** Always present for HTTP errors; narrowed from the optional base field. */
  declare readonly status: number;

  constructor(status: number) {
    super(`DPD guest API returned HTTP ${status}`, { status });
    this.name = 'DPDAPIHttpError';
  }
}

/**
 * The rendered page recovers exactly what the guest API path used to hand it:
 * an inconclusive answer, a transport failure, or a payload that did not match
 * the request. A positive "unknown parcel" ends the lookup instead.
 */
const PAGE_RECOVERS = new Set<CarrierErrorKind>(['indeterminate', 'transport', 'schema']);

/**
 * Local to this adapter: the guest API mixes strings and numbers in the fields
 * we project, and its labels are not length-capped here (they are capped at the
 * projection site instead), so `core/transport`'s string-only `clean` would
 * change what a numeric city or code normalizes to.
 */
function clean(value: unknown): string {
  return String(value ?? '').trim().split(/\s+/).filter(Boolean).join(' ');
}

function optionalText(value: unknown): string | null {
  return clean(value) || null;
}

export function dpdTrackingUrl(trackingNumber: string, language?: string): string {
  const url = new URL(TRACKING_BASE);
  url.searchParams.set('parcelNumber', trackingNumber);
  if (language) url.searchParams.set('lang', language);
  return url.toString();
}

/** Page timestamps are Swiss wall-clock without an offset; unparsable values stay raw. */
function eventTime(date: string, clock: string): string {
  const value = `${date} ${clock}`.trim();
  const formats = clock
    ? ['dd.MM.yyyy HH:mm:ss', 'dd.MM.yyyy HH:mm', 'dd.MM.yyyy']
    : ['dd.MM.yyyy'];
  for (const format of formats) {
    const parsed = zonedTime(value, format, TIMEZONE);
    if (parsed) return parsed.iso;
  }
  return value;
}

function apiDescription(value: unknown): string {
  const key = clean(value).toUpperCase().replaceAll(' ', '_');
  return API_LABELS[key] ?? key.toLocaleLowerCase('en-US')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function apiSender(payload: JsonObject, current: JsonObject): string | null {
  // Webshop sender only; recipient names stay out. ParcelShop collection
  // points are operational locations, not private addresses.
  for (const candidate of [payload.senderName, payload.sender, current.senderName]) {
    const value = clean(candidate);
    if (value) return value.slice(0, 200);
  }
  return null;
}

function apiPickupPoint(payload: JsonObject, current: JsonObject, stage: string | null): string | null {
  if (stage !== 'ready_for_pickup') return null;
  for (const candidate of [
    current.pickupPoint, current.parcelShop, payload.pickupPoint,
    payload.parcelShop, current.receiverName, payload.receiverName,
  ]) {
    const value = isRecord(candidate) ? clean(candidate.name ?? candidate.shopName) : clean(candidate);
    if (value) return value.slice(0, 200);
  }
  return null;
}

function apiLocation(event: JsonObject): string {
  const city = clean(event.city);
  const country = clean(event.country ?? event.countryCode ?? event.depotCountry);
  return city && country && city.toLocaleLowerCase('en-US') !== country.toLocaleLowerCase('en-US')
    ? `${city}, ${country}`
    : city || country;
}

/**
 * Guest API timestamps: an explicit offset wins, then the zone the payload
 * names for that scan, then Swiss time. Unparsable values keep their raw text.
 */
function apiEventTime(date: unknown, clock: unknown = '', timezoneName: unknown = null): string {
  const dateText = clean(date);
  const clockText = clean(clock);
  const value = clockText ? `${dateText}T${clockText}` : dateText;
  if (!value) return '';
  const offsetParsed = explicitOffsetTime(value);
  if (offsetParsed) return offsetParsed.iso;
  const zoneValue = clean(timezoneName);
  const zone = /^[+-]\d{2}:\d{2}$/.test(zoneValue) ? `UTC${zoneValue}` : zoneValue || TIMEZONE;
  const parsed = isoTime(value, zone) ?? (zoneValue ? isoTime(value, TIMEZONE) : null);
  return parsed?.iso ?? clean(`${dateText} ${clockText}`);
}

function expectedDelivery(payload: JsonObject): string | null {
  const rawDate = clean(payload.deliveryDate);
  if (!rawDate) return null;
  const date = /^\d{4}-\d{2}-\d{2}/.exec(rawDate)?.[0] ?? rawDate;
  const shortTime = (value: unknown) => /^(\d{2}:\d{2})/.exec(clean(value))?.[1] ?? '';
  const from = shortTime(payload.deliveryTimeFrom);
  const to = shortTime(payload.deliveryTimeTo);
  if (from && to) return `${date} ${from}–${to}`;
  return from || to ? `${date} ${from || to}` : date;
}

export function parseDPDTrackingApi(
  payload: unknown,
  trackingNumber: string,
  postcodeVerified?: boolean,
): CarrierResult {
  if (!isRecord(payload)) throw new DPDAPIError('DPD guest API returned an invalid response');
  if (String(payload.parcelNumber ?? payload.shipmentId ?? '') !== trackingNumber) {
    throw new SchemaError('DPD', 'DPD did not return the requested parcel');
  }
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  const append = (event: CarrierEvent) => {
    const key = JSON.stringify([event.time ?? '', event.location ?? '', event.description ?? '']);
    if (!seen.has(key)) {
      seen.add(key);
      events.push(event);
    }
  };
  if (Array.isArray(payload.parcelEvents)) {
    for (const raw of payload.parcelEvents) {
      if (!isRecord(raw)) continue;
      append({
        time: apiEventTime(raw.date, raw.time),
        location: apiLocation(raw),
        description: clean(raw.translation ?? raw.eventTypeText ?? apiDescription(raw.eventType))
          || 'Tracking update',
      });
    }
  }
  if (events.length === 0 && Array.isArray(payload.parcelHistory)) {
    for (const raw of payload.parcelHistory) {
      if (!isRecord(raw)) continue;
      append({
        time: apiEventTime(raw.eventDateAndTime, '', raw.eventDateAndTimeZoneId),
        location: apiLocation(raw),
        description: apiDescription(raw.description),
      });
    }
  }
  const current = isRecord(payload.status) ? payload.status : {};
  const currentDescription = current.description;
  const statusText = events[0]?.description || apiDescription(currentDescription)
    || 'Tracking information received';
  const stage = apiStage(currentDescription);
  const sender = apiSender(payload, current);
  const pickupPoint = apiPickupPoint(payload, current, stage);
  const result: CarrierResult = {
    status: apiStatus(currentDescription, statusText, events.length > 0),
    ...(stage ? { current_stage: stage } : {}),
    last_status_text: statusText,
    last_update: events[0]?.time || apiEventTime(
      current.eventDateAndTime,
      '',
      current.eventDateAndTimeZoneId,
    ) || null,
    expected_delivery: expectedDelivery(payload),
    events,
    source: 'mydpd_guest_api',
    delivery_date: optionalText(payload.deliveryDate),
    delivery_time_from: optionalText(payload.deliveryTimeFrom),
    delivery_time_to: optionalText(payload.deliveryTimeTo),
    is_predictive_date: Boolean(payload.isPredictiveDate),
    ...(sender ? { sender_name: sender } : {}),
    ...(pickupPoint ? { pickup_point: pickupPoint } : {}),
  };
  if (postcodeVerified !== undefined) result.dpd_postcode_verified = postcodeVerified;
  return result;
}

export function parseDPDTrackingHtml(html: string, trackingNumber: string): CarrierResult {
  if (/Just a moment|cf-mitigated|Enable JavaScript and cookies/i.test(html)) {
    throw new DPDChallengeError();
  }
  const $ = load(html);
  $('script, style').remove();
  const visible = clean($('body').text());
  if (!visible.includes(trackingNumber)) {
    throw new SchemaError('DPD', 'DPD did not return the requested parcel');
  }
  if (/no parcel|not found|nicht gefunden|aucun colis/i.test(visible)) {
    return {
      status: 'unknown',
      last_status_text: 'No parcel found',
      last_update: null,
      expected_delivery: null,
      events: [],
    };
  }
  const events: CarrierEvent[] = [];
  $('li.content-item-track').each((_, element) => {
    const row = $(element);
    const description = clean(row.find('.entry-body').text());
    if (!description) return;
    events.push({
      time: eventTime(clean(row.find('.entry-date').text()), clean(row.find('.entry-time').text())),
      location: clean(row.find('.place-track').text()),
      description,
    });
  });
  if (events.length === 0) {
    const summary: Array<{ date: string; description: string }> = [];
    $('.parcelStatus .row').each((_, element) => {
      const row = $(element);
      const date = /\d{2}\.\d{2}\.\d{4}/.exec(clean(row.text()))?.[0] ?? '';
      const description = clean(row.find('.col-xs-7').text())
        || clean(row.text()).replace(date, '').trim();
      if (date && description) summary.push({ date, description });
    });
    const offsets = new Map<string, number>();
    for (const item of summary) {
      const offset = offsets.get(item.date) ?? 0;
      offsets.set(item.date, offset + 1);
      events.push({
        time: eventTime(item.date, `00:${String(Math.floor(offset / 60)).padStart(2, '0')}:${String(offset % 60).padStart(2, '0')}`),
        location: '',
        description: item.description,
      });
    }
    events.reverse();
  }
  const labels = $('.gray-out').map((_, element) => clean($(element).text())).get().filter(Boolean);
  const statusText = events[0]?.description ?? labels.at(-1) ?? 'Tracking information received';
  return {
    status: wordingStatus(statusText, events.length > 0),
    last_status_text: statusText,
    last_update: events[0]?.time || null,
    expected_delivery: null,
    events,
  };
}

function durationSeconds(value: unknown, fallback: number): number {
  const match = /^(\d+)s?$/.exec(String(value ?? ''));
  return match ? Number(match[1]) : fallback;
}

export interface DPDTrackerOptions {
  timeoutMs?: number;
  /** Whole-lookup budget; defaults to both tiers plus the solver's own allowance. */
  budgetMs?: number;
  /** Legacy configuration seam kept for tests; production passes `trawl`. */
  flaresolverrUrl?: string;
  firebaseApiKey?: string;
  fetcher?: typeof fetch;
  trawl?: TrawlClient | null;
  recorder?: StepRecorder;
}

export class DPDTracker {
  readonly timeoutMs: number;
  readonly budgetMs: number;
  readonly flaresolverrUrl: string;
  readonly firebaseApiKey: string;
  private readonly fetcher?: typeof fetch;
  private readonly trawl?: TrawlClient | null;
  private readonly recorder?: StepRecorder;
  #accessToken = '';
  #accessTokenExpiresAt = 0;
  #basicToken = '';
  #installationFid = '';
  #installationToken = '';
  #installationExpiresAt = 0;
  readonly #tokenFlight = singleFlight();

  constructor(options: DPDTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.budgetMs = options.budgetMs ?? this.timeoutMs * 2 + SOLVER_ALLOWANCE_MS;
    this.flaresolverrUrl = (options.flaresolverrUrl ?? process.env.FLARESOLVERR_URL ?? '').trim();
    this.firebaseApiKey = (options.firebaseApiKey ?? process.env.DPD_FIREBASE_API_KEY ?? FIREBASE_API_KEY).trim();
    this.fetcher = options.fetcher;
    this.trawl = options.trawl;
    this.recorder = options.recorder;
  }

  /** The browser service, resolved late so a malformed URL fails the page step, not construction. */
  private browserService(): TrawlClient | null {
    if (this.trawl !== undefined) return this.trawl;
    return this.flaresolverrUrl ? new TrawlClient(this.flaresolverrUrl, this.fetcher) : null;
  }

  async fetch(trackingNumber: string, postcode = ''): Promise<CarrierResult> {
    if (!/^\d{14}$/.test(trackingNumber)) {
      throw new TypeError('DPD tracking numbers must contain 14 digits');
    }
    const resolvedPostcode = postcode.trim();
    if (resolvedPostcode && !/^\d{4}$/.test(resolvedPostcode)) {
      throw new TypeError('DPD postcode must contain exactly 4 digits');
    }
    const result = await runSteps<CarrierResult>({
      carrier: 'dpd', budgetMs: this.budgetMs, recorder: this.recorder,
    }, [
      { id: 'direct', run: () => this.apiFetch(trackingNumber, resolvedPostcode) },
      {
        id: 'page',
        recovers: (error) => {
          const kind = carrierErrorKind(error);
          return kind !== null && PAGE_RECOVERS.has(kind);
        },
        run: ({ previousError }) => this.pageFetch(trackingNumber, previousError !== undefined),
      },
    ]);
    result.tracking_url = dpdTrackingUrl(trackingNumber);
    return result;
  }

  private async apiFetch(trackingNumber: string, postcode: string): Promise<CarrierResult> {
    let postcodeVerified: boolean | undefined;
    let payload: JsonObject;
    try {
      payload = await this.detailsWithFreshToken(trackingNumber, postcode || undefined);
      if (postcode) postcodeVerified = true;
    } catch (error) {
      if (!(error instanceof DPDAPIHttpError) || !postcode || error.status !== 400) throw error;
      payload = await this.detailsWithFreshToken(trackingNumber);
      postcodeVerified = false;
    }
    return parseDPDTrackingApi(payload, trackingNumber, postcodeVerified);
  }

  private async detailsWithFreshToken(trackingNumber: string, postcode?: string): Promise<JsonObject> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.accessToken();
      try {
        return await this.parcelDetails(trackingNumber, postcode, token);
      } catch (error) {
        if (!(error instanceof DPDAPIHttpError) || error.status !== 401 || attempt > 0) throw error;
        this.#accessToken = '';
        this.#accessTokenExpiresAt = 0;
      }
    }
    throw new DPDAPIError('DPD guest API authentication failed');
  }

  private async parcelDetails(
    trackingNumber: string,
    postcode: string | undefined,
    token: string,
  ): Promise<JsonObject> {
    const url = new URL(`${DETAILS_BASE}/${encodeURIComponent(trackingNumber)}`);
    url.searchParams.set('parcelType', 'INCOMING');
    url.searchParams.set('businessUnit', 'DPD-CH');
    url.searchParams.set('lang', 'en');
    url.searchParams.set('continueWithoutVerification', postcode ? 'false' : 'true');
    if (postcode) url.searchParams.set('dataForVerification', postcode);
    try {
      return await this.requestJson(url, '', {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': `myDPD/${CLIENT_VERSION} (Android)`,
      });
    } catch (error) {
      if (error instanceof DPDAPIHttpError && error.status === 404) {
        throw new DPDTrackingError();
      }
      throw error;
    }
  }

  private async accessToken(): Promise<string> {
    if (this.#accessToken && Date.now() < this.#accessTokenExpiresAt) return this.#accessToken;
    // One refresh at a time: two lookups must not race for the guest credential.
    return await this.#tokenFlight(async () => {
      if (this.#accessToken && Date.now() < this.#accessTokenExpiresAt) return this.#accessToken;
      return await this.refreshAccessToken();
    });
  }

  private async refreshAccessToken(): Promise<string> {
    let payload: JsonObject | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const basicToken = this.#basicToken || await this.fetchBasicToken();
      try {
        payload = await this.requestJson(OAUTH_URL, '', {
          Authorization: `Basic ${basicToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': `myDPD/${CLIENT_VERSION} (Android)`,
        });
        break;
      } catch (error) {
        if (!(error instanceof DPDAPIHttpError)
          || ![400, 401].includes(error.status)
          || attempt > 0) throw error;
        this.#basicToken = '';
      }
    }
    const token = clean(payload?.access_token);
    if (!token) throw new DPDAPIError('DPD guest API did not issue an access token');
    this.#accessToken = token;
    this.#accessTokenExpiresAt = Date.now()
      + Math.max(1, durationSeconds(payload?.expires_in, 3_600) - 60) * 1_000;
    return token;
  }

  private async fetchBasicToken(): Promise<string> {
    if (!this.firebaseApiKey) throw new DPDAPIError('DPD Firebase client configuration is missing');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const [fid, installationToken] = await this.firebaseInstallation();
      try {
        const payload = await this.requestJson(REMOTE_CONFIG_URL, {
          appId: FIREBASE_APP_ID,
          appInstanceId: fid,
          appInstanceIdToken: installationToken,
          languageCode: 'en-US',
          countryCode: 'CH',
          platformVersion: '36',
          appVersion: CLIENT_VERSION,
          packageName: ANDROID_PACKAGE,
          sdkVersion: '22.1.2',
          analyticsUserProperties: {},
        }, this.firebaseHeaders({ 'X-Goog-Firebase-Installations-Auth': installationToken }));
        const entries = isRecord(payload.entries) ? payload.entries : {};
        const token = clean(entries.basic_dpd_token);
        if (!token) throw new DPDAPIError('myDPD Remote Config omitted its guest credential');
        this.#basicToken = token;
        return token;
      } catch (error) {
        if (!(error instanceof DPDAPIHttpError)
          || ![401, 403].includes(error.status)
          || attempt > 0) throw error;
        this.#installationFid = '';
        this.#installationToken = '';
        this.#installationExpiresAt = 0;
      }
    }
    throw new DPDAPIError('myDPD Remote Config authentication failed');
  }

  private async firebaseInstallation(): Promise<[string, string]> {
    if (this.#installationFid
      && this.#installationToken
      && Date.now() < this.#installationExpiresAt) {
      return [this.#installationFid, this.#installationToken];
    }
    const bytes = randomBytes(17);
    bytes[0] = 0x70 | (bytes[0]! & 0x0f);
    const fid = bytes.toString('base64url').slice(0, 22);
    const payload = await this.requestJson(INSTALLATIONS_URL, {
      fid,
      appId: FIREBASE_APP_ID,
      authVersion: 'FIS_v2',
      sdkVersion: 'a:18.0.0',
    }, this.firebaseHeaders());
    const auth = isRecord(payload.authToken) ? payload.authToken : {};
    const token = clean(auth.token);
    if (!token) throw new DPDAPIError('Firebase did not issue a myDPD installation token');
    this.#installationFid = clean(payload.fid) || fid;
    this.#installationToken = token;
    this.#installationExpiresAt = Date.now()
      + Math.max(1, durationSeconds(auth.expiresIn, 604_800) - 300) * 1_000;
    return [this.#installationFid, token];
  }

  private firebaseHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': this.firebaseApiKey,
      'X-Android-Package': ANDROID_PACKAGE,
      'X-Android-Cert': ANDROID_CERT,
      ...extra,
    };
  }

  private async requestJson(
    url: string | URL,
    data: JsonObject | string,
    headers: Record<string, string>,
  ): Promise<JsonObject> {
    let result;
    try {
      result = await fetchBounded(url, {
        method: 'POST',
        headers,
        body: typeof data === 'string' ? data : JSON.stringify(data),
      }, {
        provider: 'DPD guest API',
        timeoutMs: this.timeoutMs,
        maxBytes: MAX_BYTES,
        allowHttpError: true,
        fetcher: this.fetcher,
      });
    } catch (error) {
      throw new DPDAPIError('DPD guest API is unreachable', { cause: error });
    }
    if (!result.response.ok) throw new DPDAPIHttpError(result.response.status);
    let payload: unknown;
    try {
      payload = parseJsonBytes(result.bytes, 'DPD guest API');
    } catch (error) {
      throw new DPDAPIError('DPD guest API returned invalid JSON', { cause: error });
    }
    if (!isRecord(payload)) throw new DPDAPIError('DPD guest API returned an invalid response');
    return payload;
  }

  private async pageFetch(trackingNumber: string, apiFailed: boolean): Promise<CarrierResult> {
    const url = new URL(FETCH_BASE);
    url.searchParams.set('lang', 'en');
    url.searchParams.set('parcelNumber', trackingNumber);
    const trawl = this.browserService();
    let html: string;
    if (trawl) {
      html = await trawl.solve(url.toString(), {
        provider: 'The browser challenge solver',
        timeoutMs: this.timeoutMs,
        maxBytes: MAX_BYTES,
        fetcher: this.fetcher,
      });
    } else {
      try {
        html = await this.directGet(url);
      } catch (error) {
        if (!(error instanceof DPDChallengeError)) throw error;
        const prefix = apiFailed ? 'DPD guest API is unavailable and ' : 'DPD ';
        throw new DPDChallengeError(
          `${prefix}the web fallback requires a browser challenge solver; configure FLARESOLVERR_URL`,
          { cause: error },
        );
      }
    }
    return parseDPDTrackingHtml(html, trackingNumber);
  }

  private async directGet(url: URL): Promise<string> {
    const result = await fetchBounded(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-CH,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      },
    }, {
      provider: 'DPD',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_BYTES,
      redirect: 'follow',
      allowHttpError: true,
      fetcher: this.fetcher,
    });
    const html = decodeText(result.bytes);
    if (result.response.status === 403
      && (result.response.headers.get('cf-mitigated') === 'challenge'
        || /Just a moment|Enable JavaScript and cookies/i.test(html))) {
      throw new DPDChallengeError();
    }
    if (!result.response.ok) throw new IndeterminateError('DPD', `DPD returned HTTP ${result.response.status}`);
    return html;
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new DPDTracker({
    fetcher: environment.fetcher,
    trawl: environment.trawl,
    recorder: environment.recorder,
  });
  return {
    id: 'dpd',
    // The guest JSON protocol first; the Cloudflare-protected consignee page,
    // solved by the browser service when one is configured, second.
    steps: ['direct', 'page'],
    track: (input) => tracker.fetch(input.number, input.postcode ?? ''),
  };
};
