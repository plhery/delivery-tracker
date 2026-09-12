import 'server-only';

import { load } from 'cheerio';
import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { isValidMondialRelayBarcode } from '../../core/detection';
import { ChallengeError, InputRequiredError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps, singleFlight } from '../../core/runner';
import type { ClassifiedStatus } from '../../core/status';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { isoTime, zonedTime, type ParsedTime } from '../../core/time';
import { cleanScalar, TrawlClient, trawlBody, type TrawlScrapeRequest, type TrawlScrapeResponse } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { classifyStatus, milestoneNumberStatus } from './status';

// Protocol provenance (inspected 2026-08-30):
// https://www.mondialrelay.fr/versioned-assets/2nMAiuVI9Rv9J3kZacblPYCfCABwzS-qZ3m7eFBQn4A/Scripts/vue/tracking/js/app.js
// SHA-256: da73008ae548f51bfd27791969c6e53d809f080070cd2faa6779bb7850509f80
// The current official bundle reads the server-rendered `token` attribute from
// #tracking and sends it as RequestVerificationToken to GET /api/tracking.
// Mondial Relay's current CONNECT guide documents 8-, 10-, and 12-digit IDs:
// https://www.mondialrelay.fr/media/124728/fr-documentation-utilisateur-connect-v-12.pdf
const TRACKING_PAGE = 'https://www.mondialrelay.fr/suivi-de-colis/';
const TRACKING_API = 'https://www.mondialrelay.fr/api/tracking';
const MAX_DIRECT_BYTES = 2_000_000;
const MAX_TRAWL_BYTES = 10_000_000;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_DIRECT_TIMEOUT_MS = 20_000;
const ZONE = 'Europe/Paris';
const CREDENTIAL_MESSAGE = 'Mondial Relay tracking requires an 8-, 10-, or 12-digit shipment number followed by '
  + 'the 5-digit recipient postcode';

interface MondialRelayCredential {
  shipment: string;
  postcode: string;
  canonicalShipment?: string;
}

interface ParsedEvent {
  event: CarrierEvent;
  status: ClassifiedStatus['status'];
  timestamp: number;
  index: number;
}

/** Strip the markup Mondial Relay embeds in its labels, entities included. */
function plainText(value: unknown, limit = 500): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const raw = String(value).slice(0, Math.max(limit * 10, 5_000));
  return cleanScalar(load(raw).text(), limit);
}

function plausibleFrenchPostcode(value: string): boolean {
  return /^(?:0[1-9]|[1-8]\d|9[0-5]|97|98)\d{3}$/.test(value);
}

export function normalizeMondialRelayCredential(
  rawShipment: string,
  rawPostcode = '',
): MondialRelayCredential {
  let shipment = rawShipment.trim().replace(/[\s.-]/g, '');
  let postcode = rawPostcode.trim();
  if (/^\d{26}$/.test(shipment)) {
    if (!isValidMondialRelayBarcode(shipment) || (postcode && !plausibleFrenchPostcode(postcode))) {
      throw new SchemaError('Mondial Relay', 'Invalid Mondial Relay barcode or postcode');
    }
    // The public alias carries brand/shipment/parcel sequence, not a postcode.
    return { shipment: shipment.slice(0, 12), postcode, canonicalShipment: shipment.slice(2, 10) };
  }
  if (!postcode && /^(?:\d{13}|\d{15}|\d{17})$/.test(shipment)) {
    postcode = shipment.slice(-5);
    shipment = shipment.slice(0, -5);
  }
  const shapedShipment = /^(?:\d{8}|\d{10}|\d{12})$/.test(shipment);
  if (!shapedShipment || !plausibleFrenchPostcode(postcode)) {
    // A well-shaped number without a usable postcode is a missing credential;
    // anything else is a number this carrier cannot address at all.
    throw shapedShipment
      ? new InputRequiredError('Mondial Relay', 'the recipient postcode', CREDENTIAL_MESSAGE)
      : new SchemaError('Mondial Relay', CREDENTIAL_MESSAGE);
  }
  return { shipment, postcode };
}

export function mondialRelayTrackingUrl(rawShipment: string, rawPostcode = ''): string {
  const credential = normalizeMondialRelayCredential(rawShipment, rawPostcode);
  const url = new URL(TRACKING_PAGE);
  url.searchParams.set('numeroExpedition', credential.shipment);
  return url.toString();
}

function trackingApiUrl(credential: MondialRelayCredential, brand = ''): string {
  const url = new URL(TRACKING_API);
  url.searchParams.set('shipment', credential.shipment);
  url.searchParams.set('postcode', credential.postcode);
  url.searchParams.set('brand', brand);
  url.searchParams.set('codePays', 'fr');
  return url.toString();
}

function verificationToken(html: string): string {
  const $ = load(html);
  const token = cleanScalar($('#tracking').first().attr('token'), 4_096);
  if (!/^[A-Za-z0-9:_-]{20,4096}$/.test(token)) {
    throw new ChallengeError('Mondial Relay', 'Mondial Relay did not issue a request token');
  }
  return token;
}

/**
 * An event timestamp. Mondial Relay sends offset-less Paris wall-clock time in
 * several shapes; a bare calendar day is kept as a day, because stamping
 * midnight on it would invent a precision the provider did not give.
 */
function eventTime(value: unknown): ParsedTime | null {
  const raw = cleanScalar(value, 64);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const day = isoTime(raw, ZONE);
    return day ? { iso: raw, timestamp: day.timestamp } : null;
  }
  return isoTime(raw, ZONE)
    ?? zonedTime(raw, 'dd/MM/yyyy HH:mm:ss', ZONE)
    ?? zonedTime(raw, 'dd/MM/yyyy HH:mm', ZONE)
    ?? zonedTime(raw, 'dd/MM/yyyy', ZONE);
}

/**
 * The delivery estimate, reduced to its calendar day. None of the core time
 * policies fits: they all return an instant, and the estimate is read in Paris
 * even when it carries an offset, as the provider sends it offset-less.
 */
function expectedDelivery(value: unknown): string | null {
  const raw = cleanScalar(value, 64);
  if (!raw || raw.startsWith('0001-01-01')) return null;
  const date = DateTime.fromISO(raw, { zone: ZONE });
  return date.isValid ? date.toISODate() : null;
}

function parseEvents(expedition: JsonObject): ParsedEvent[] {
  if (!Array.isArray(expedition.Evenements)) return [];
  const parsed: ParsedEvent[] = [];
  const seen = new Set<string>();
  expedition.Evenements.forEach((rawEvent, index) => {
    if (!isRecord(rawEvent)) return;
    const time = eventTime(rawEvent.Date);
    const description = plainText(rawEvent.Libelle);
    if (!time || !description) return;
    const identity = JSON.stringify([time.iso, description]);
    if (seen.has(identity)) return;
    seen.add(identity);
    const classified = classifyStatus(description);
    parsed.push({
      event: {
        time: time.iso,
        location: '',
        description,
        stage: classified.stage,
      },
      status: classified.status,
      timestamp: time.timestamp,
      index,
    });
  });
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  return parsed.slice(0, 100);
}

function milestoneStatus(expedition: JsonObject): ClassifiedStatus | null {
  if (!isRecord(expedition.SuiviParEtapes)) return null;
  const reached: Array<{ number: number; status: ClassifiedStatus }> = [];
  for (const raw of Object.values(expedition.SuiviParEtapes)) {
    if (!isRecord(raw) || !isRecord(raw.Evenement) || !cleanScalar(raw.Evenement.Date, 64)) continue;
    const number = Number(raw.Numero);
    const classified = classifyStatus(plainText(raw.Libelle));
    if (Number.isFinite(number)) reached.push({ number, status: classified });
  }
  reached.sort((left, right) => right.number - left.number);
  const latest = reached[0];
  if (!latest) return null;
  if (latest.status.status !== 'unknown') return latest.status;
  return milestoneNumberStatus(latest.number);
}

export function parseMondialRelayTrackingResponse(
  payload: unknown,
  rawShipment: string,
  rawPostcode = '',
): CarrierResult {
  return parseTrackingResponse(payload, normalizeMondialRelayCredential(rawShipment, rawPostcode));
}

function parseTrackingResponse(payload: unknown, credential: MondialRelayCredential): CarrierResult {
  if (!isRecord(payload)) throw new SchemaError('Mondial Relay');
  if (!isRecord(payload.Expedition)) {
    const warning = Array.isArray(payload.status)
      && payload.status.some((entry) => isRecord(entry) && cleanScalar(entry.state, 32) === 'warn');
    // The provider echoes the query in that warning; only the fact is kept.
    if (warning || Array.isArray(payload.FiltresRecherche)) throw new NotFoundError('Mondial Relay');
    throw new SchemaError('Mondial Relay', 'Mondial Relay returned incomplete tracking details');
  }

  const expedition = payload.Expedition;
  const returnedShipment = cleanScalar(expedition.Numero, 32).replace(/\s/g, '');
  if (!/^(?:\d{8}|\d{10}|\d{12})$/.test(returnedShipment)) {
    throw new SchemaError('Mondial Relay', 'Mondial Relay returned an invalid shipment number');
  }
  if (returnedShipment !== credential.shipment && returnedShipment !== credential.canonicalShipment) {
    throw new SchemaError('Mondial Relay', 'Mondial Relay returned a different shipment');
  }

  const parsedEvents = parseEvents(expedition);
  const events = parsedEvents.map(({ event }) => event);
  const contextual = plainText(expedition.SuiviContextuel);
  const statusText = contextual || events[0]?.description || 'Tracking information received';
  const contextualStatus = classifyStatus(statusText);
  const status = contextualStatus.status !== 'unknown'
    ? contextualStatus.status
    : parsedEvents.find((event) => event.status !== 'unknown')?.status
      ?? milestoneStatus(expedition)?.status
      ?? 'unknown';

  return {
    status,
    last_status_text: statusText,
    last_update: events[0]?.time ?? null,
    expected_delivery: ['delivered', 'exception'].includes(status)
      ? null
      : expectedDelivery(expedition.EstimatedDeliveryDate),
    timezone: ZONE,
    events,
    source: 'mondial_relay_public_web',
  };
}

/**
 * The page the browser actually loaded. Mondial Relay's Vue app replaces the
 * `#tracking` root as soon as it boots, so the captured response body carries
 * the server-rendered token that the rendered HTML no longer has.
 */
function originalTrawlPage(response: TrawlScrapeResponse): string {
  const body = trawlBody(response.raw, MAX_DIRECT_BYTES);
  return body.includes('id="tracking"') || body.includes("id='tracking'") ? body : response.html;
}

function trawlJson(response: TrawlScrapeResponse): unknown {
  const candidates = [trawlBody(response.raw, MAX_DIRECT_BYTES)];
  const $ = load(response.html);
  candidates.push($('pre').first().text(), $('body').text(), response.html);
  for (const candidate of candidates) {
    const cleaned = candidate.trim().replace(/^﻿/, '');
    if (!cleaned) continue;
    try {
      return JSON.parse(cleaned);
    } catch {
      // Try the next representation. Browser navigations wrap JSON in a <pre>.
    }
  }
  throw new SchemaError('Mondial Relay', 'Mondial Relay browser fallback returned invalid tracking data');
}

function assertTrawlTarget(response: TrawlScrapeResponse, expectedUrl: string): void {
  const returned = cleanScalar(response.url, 2_048);
  if (!returned) return;
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(returned);
    expected = new URL(expectedUrl);
  } catch (error) {
    throw new SchemaError('Mondial Relay', 'Mondial Relay browser fallback returned an invalid URL', { cause: error });
  }
  if (actual.origin !== expected.origin
    || actual.pathname !== expected.pathname
    || actual.searchParams.get('shipment') !== expected.searchParams.get('shipment')
    || actual.searchParams.get('postcode') !== expected.searchParams.get('postcode')) {
    throw new SchemaError('Mondial Relay', 'Mondial Relay browser fallback returned a different shipment');
  }
}

export interface MondialRelayTrackerOptions {
  timeoutMs?: number;
  directTimeoutMs?: number;
  /** Legacy configuration seam; `trawl` is preferred. */
  trawlUrl?: string;
  /** The browser service, or null when none is configured. */
  trawl?: TrawlClient | null;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
}

export class MondialRelayTracker {
  readonly timeoutMs: number;
  readonly directTimeoutMs: number;
  readonly trawlUrl: string;
  readonly #trawl: TrawlClient | null | undefined;
  readonly #fetcher: typeof fetch | undefined;
  readonly #recorder: StepRecorder;
  readonly #serialize = singleFlight();

  constructor(options: MondialRelayTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.directTimeoutMs = Math.max(1_000, Math.min(
      this.timeoutMs,
      options.directTimeoutMs ?? DEFAULT_DIRECT_TIMEOUT_MS,
    ));
    this.trawlUrl = (options.trawlUrl ?? process.env.FLARESOLVERR_URL ?? '').trim();
    this.#trawl = options.trawl;
    this.#fetcher = options.fetcher;
    this.#recorder = options.recorder ?? NOOP_RECORDER;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Mondial Relay timeout must be positive');
    }
  }

  /** The injected browser service, or one built from the configured URL. */
  #browserService(): TrawlClient | null {
    if (this.#trawl !== undefined) return this.#trawl;
    return this.trawlUrl ? new TrawlClient(this.trawlUrl, this.#fetcher) : null;
  }

  async fetch(rawShipment: string, rawPostcode = ''): Promise<CarrierResult> {
    // One lookup at a time: the page token and the API call have to stay on the
    // same solved browser identity.
    return this.#serialize(() => this.#lookup(normalizeMondialRelayCredential(rawShipment, rawPostcode)));
  }

  async #lookup(credential: MondialRelayCredential): Promise<CarrierResult> {
    // Cloudflare blocks every non-browser client with an HTTP 403 WAF block
    // (verified from multiple networks, 2026-09-10), so a direct attempt only
    // burns time and reports a fallback on each sync. There is one step, and
    // it is the browser.
    const trawl = this.#browserService();
    if (!trawl) {
      throw new ChallengeError(
        'Mondial Relay',
        'Mondial Relay challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
      );
    }
    return runSteps<CarrierResult>({
      carrier: 'mondial-relay', budgetMs: this.timeoutMs, recorder: this.#recorder,
    }, [
      { id: 'trawl', run: () => this.#trawlResult(trawl, credential) },
    ]);
  }

  async #trawlResult(trawl: TrawlClient, credential: MondialRelayCredential): Promise<CarrierResult> {
    const bootstrap = await this.#scrape(trawl, { url: TRACKING_PAGE });
    const token = verificationToken(originalTrawlPage(bootstrap));
    const apiUrl = trackingApiUrl(credential);
    const tracked = await this.#scrape(trawl, {
      url: apiUrl,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Referer: TRACKING_PAGE,
        RequestVerificationToken: token,
      },
    });
    assertTrawlTarget(tracked, apiUrl);
    return this.#finish(trawlJson(tracked), credential, 'browser-session-response');
  }

  #scrape(trawl: TrawlClient, request: TrawlScrapeRequest): Promise<TrawlScrapeResponse> {
    return trawl.scrape({ skipHttp: true, maxTier: 3, maxTimeout: this.timeoutMs, ...request }, {
      provider: 'TRAWL while fetching Mondial Relay',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_TRAWL_BYTES,
      fetcher: this.#fetcher,
    });
  }

  #finish(
    payload: unknown,
    credential: MondialRelayCredential,
    trackingSource: string,
  ): CarrierResult {
    const result = parseTrackingResponse(payload, credential);
    const url = new URL(TRACKING_PAGE);
    url.searchParams.set('numeroExpedition', credential.shipment);
    result.tracking_url = url.toString();
    result.tracking_source = trackingSource;
    return result;
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new MondialRelayTracker({
    fetcher: environment.fetcher,
    trawl: environment.trawl,
    recorder: environment.recorder,
  });
  return {
    id: 'mondial-relay',
    // Cloudflare refuses every non-browser client, so there is no direct tier.
    steps: ['trawl'],
    track: (input) => tracker.fetch(input.number, input.postcode ?? ''),
  };
};
