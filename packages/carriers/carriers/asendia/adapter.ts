import 'server-only';

/**
 * Asendia tracking through Asendia USA's A1 platform.
 *
 * Protocol provenance (inspected 2026-09-22):
 * - The official public page https://a1.asendiausa.com/tracking/ (the same
 *   static app is served at https://a1.asendia.com/tracking/) loads
 *   `js/main.js`, which carries the page's public client configuration: the
 *   API base URL, a shared Basic authorization value, an `X-AsendiaOne-ApiKey`
 *   and the default branded tracking key. Every anonymous visitor receives the
 *   same values. They are read from that script at run time, never pinned.
 * - The page asks `TrackingBranded/Customer?trackingKey=` for its brand, then
 *   `TrackingBranded/Tracking?trackingKey=&trackingNumber=`. Both answer HTTP
 *   200 with `responseStatus.responseStatusCode` 200, or 204 when nothing
 *   matches.
 * - Without a valid tracking key the Tracking call answers 204 "no package
 *   data" even for a known parcel. The key is therefore validated through
 *   Customer (204 "no customers configured" for a wrong key) before a 204 is
 *   reported as not found, so a rotated key cannot turn every lookup into a
 *   not-found.
 * - Both header values are required (JSON 401 and 403 otherwise). Cloudflare
 *   refuses a library's default User-Agent (403 "error code: 1010"); an
 *   ordinary one is accepted, with no cookie, session or browser.
 * - Prior art calling the same endpoint: Paylicier/Packt (MPL-2.0,
 *   backend/src/sources/implementations/asendia.ts) and deingithub/beanstalk
 *   (beanstalk/parcel.py).
 *
 * Coverage: parcels on the A1 platform only. Asendia's global portal
 * track.asendia.com, which serves the other subsidiaries, needs a Cloudflare
 * Turnstile token for every search and is not used here (see probe.ts). A
 * number A1 does not know is a not-found for this adapter only; routing then
 * tries the universal providers in the same check.
 *
 * Privacy: events keep their time, wording, code and city, province and
 * country. Address lines and postal codes in `eventLocationDetails` are never
 * read, and nothing else from the summary is copied except the destination
 * country, weight and the declared last-mile reference.
 */
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { carrierIdFromPartner } from '../../core/catalog/hints';
import {
  BudgetExceededError,
  ChallengeError,
  IndeterminateError,
  NotFoundError,
  SchemaError,
  UpstreamHttpError,
} from '../../core/errors';
import type { CarrierEvent, CarrierResult, CarrierStatus } from '../../core/result';
import { languageStageStatus, wordingStage, type Stage } from '../../core/status';
import { explicitOffsetTime } from '../../core/time';
import { clean, cleanScalar, decodeText, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { classifyAsendiaA1Event, type ClassifiedAsendiaStatus } from './status';

const PROVIDER = 'Asendia';
const PAGE_URL = 'https://a1.asendiausa.com/tracking/';
const SCRIPT_URL = `${PAGE_URL}js/main.js`;
const API_HOST_SUFFIXES = ['asendiaprod.com', 'asendia.io', 'asendia.com', 'asendiausa.com'];
const USER_AGENT = 'Mozilla/5.0 (compatible; SwissDeliveryTracker/1.0)';
const GUID = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi;
const DEFAULT_BUDGET_MS = 25_000;
const MAX_REQUEST_MS = 10_000;
/** The public configuration is re-read at least this often, in case it rotates. */
const CONFIG_TTL_MS = 6 * 60 * 60_000;
/** A not-found is only trusted when the tracking key was accepted this recently. */
const KEY_CHECK_TTL_MS = 15 * 60_000;
const MAX_SCRIPT_BYTES = 500_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENTS_TO_INSPECT = 500;
const MAX_EVENTS_TO_RETURN = 100;
const POUNDS_TO_KG = 0.453_592_37;

export interface AsendiaA1PublicConfig {
  /** The API origin, e.g. https://a1reportapi.asendiaprod.com. */
  baseUrl: string;
  authorization: string;
  apiKey: string;
  trackingKey: string;
}

/** The API refused the page's public header values (JSON 401 or 403). */
class AsendiaCredentialsError extends SchemaError {
  constructor() {
    super(PROVIDER, 'Asendia rejected the public tracking credentials');
    this.name = 'AsendiaCredentialsError';
  }
}

function record(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

/** Letters and digits only, upper-cased: how A1 identifiers are compared. */
function comparable(value: unknown): string {
  return cleanScalar(value, 80).toLocaleUpperCase('en-US').replace(/[^A-Z0-9]/g, '');
}

export function normalizeAsendiaA1TrackingNumber(raw: string): string {
  const value = comparable(raw);
  if (!/^[A-Z0-9]{6,40}$/.test(value)) {
    throw new TypeError('Asendia tracking numbers must contain 6 to 40 ASCII letters and digits');
  }
  return value;
}

/** The official public page for one number. */
export function asendiaA1TrackingUrl(rawTrackingNumber: string): string {
  const url = new URL(PAGE_URL);
  url.searchParams.set('trackingnumber', normalizeAsendiaA1TrackingNumber(rawTrackingNumber));
  return url.toString();
}

function scriptField(script: string, name: string): string {
  const values = new Set([...script.matchAll(new RegExp(`"${name}"\\s*:\\s*"([^"\\\\]{1,600})"`, 'g'))]
    .map((match) => match[1]!));
  if (values.size !== 1) throw new SchemaError(PROVIDER, `Asendia's tracking page no longer publishes ${name}`);
  return [...values][0]!;
}

function apiOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new SchemaError(PROVIDER, 'Asendia published an invalid tracking API address', { cause: error });
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !['', '/'].includes(url.pathname)
    || !API_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    throw new SchemaError(PROVIDER, 'Asendia published an unexpected tracking API address');
  }
  return url.origin;
}

/**
 * Read the public client configuration from the official page's script. The
 * values are the ones every visitor's browser sends; the default tracking key
 * is the only GUID in the script besides the API key.
 */
export function parseAsendiaA1PublicConfig(script: string): AsendiaA1PublicConfig {
  const baseUrl = apiOrigin(scriptField(script, 'baseUrl'));
  const authorization = scriptField(script, 'authorizationHeaderValue');
  const apiKey = scriptField(script, 'a1ApiKeyHeaderValue');
  if (!/^Basic [A-Za-z0-9+/]{8,500}={0,2}$/.test(authorization) || !new RegExp(`^${GUID.source}$`, 'i').test(apiKey)) {
    throw new SchemaError(PROVIDER, 'Asendia published invalid tracking API credentials');
  }
  const keys = new Map([...script.matchAll(GUID)].map((match) => [match[0].toUpperCase(), match[0]]));
  keys.delete(apiKey.toUpperCase());
  if (keys.size !== 1) throw new SchemaError(PROVIDER, "Asendia's tracking page no longer publishes one tracking key");
  return { baseUrl, authorization, apiKey, trackingKey: [...keys.values()][0]! };
}

function responseCode(payload: JsonObject): number | null {
  const code = record(payload.responseStatus).responseStatusCode;
  return typeof code === 'number' && Number.isInteger(code) ? code : null;
}

function eventLocation(value: unknown): string {
  const location = record(value);
  // Address lines and postal codes are deliberately not read.
  return [location.city, location.province, location.countryIso2]
    .map((part) => clean(part, 80))
    .filter(Boolean)
    .join(', ');
}

function eventCode(value: unknown): string {
  const code = cleanScalar(value, 32).toLocaleUpperCase('en-US');
  return /^[A-Z0-9._-]{1,32}$/.test(code) ? code : '';
}

function weightKg(value: unknown): number | null {
  const match = /^(\d{1,5}(?:\.\d{1,4})?)\s*(lb|lbs|kg)$/i.exec(clean(value, 32));
  if (!match) return null;
  const amount = Number(match[1]) * (match[2]!.toLowerCase() === 'kg' ? 1 : POUNDS_TO_KG);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 1000) / 1000 : null;
}

interface ParsedEvent {
  event: CarrierEvent;
  classified: ClassifiedAsendiaStatus | null;
  timestamp: number;
  sourceIndex: number;
}

function parseEvents(details: JsonObject[]): ParsedEvent[] {
  const parsed: ParsedEvent[] = [];
  const seen = new Set<string>();
  details.slice(0, MAX_EVENTS_TO_INSPECT).forEach((raw, sourceIndex) => {
    // A1 stamps every event with an explicit offset; an offset-less value is
    // dropped rather than guessed as UTC.
    const time = explicitOffsetTime(raw.eventOn);
    const description = clean(raw.eventDescription, 300);
    if (!time || !description) return;
    const code = eventCode(raw.eventCode);
    const location = eventLocation(raw.eventLocationDetails);
    const identity = JSON.stringify([time.iso, code, description, location]);
    if (seen.has(identity)) return;
    seen.add(identity);
    // Codes are only meaningful per source: USPS and other partners reuse
    // short codes such as "10" or "B1" for unrelated scans.
    const classified = classifyAsendiaA1Event(clean(raw.eventSource, 80), code, description);
    parsed.push({
      sourceIndex,
      classified,
      timestamp: time.timestamp,
      event: {
        time: time.iso,
        location,
        description,
        ...(classified ? { stage: classified.stage } : {}),
        ...(code ? { provider_code: code } : {}),
      },
    });
  });
  // A1 lists the newest event first; keep that order for equal instants.
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.sourceIndex - right.sourceIndex);
  return parsed.slice(0, MAX_EVENTS_TO_RETURN);
}

/** Pure projection of one Tracking reply for the requested number. */
export function parseAsendiaA1TrackingResponse(payload: unknown, rawTrackingNumber: string): CarrierResult {
  const requested = normalizeAsendiaA1TrackingNumber(rawTrackingNumber);
  if (!isRecord(payload)) throw new SchemaError(PROVIDER, 'Asendia returned an invalid tracking response');
  const code = responseCode(payload);
  if (code === 204) throw new NotFoundError(PROVIDER);
  if (code !== 200) throw new IndeterminateError(PROVIDER, `Asendia answered with tracking status ${code ?? 'none'}`);
  const summary = record(payload.trackingBrandedSummary);
  const original = comparable(summary.trackingNumberCustomerCarrierOriginal);
  const customer = comparable(summary.trackingNumberCustomer);
  const vendor = comparable(summary.trackingNumberVendor);
  // The reply echoes nothing about the query itself: bind it through the
  // references it reports, which A1 also accepts as lookup numbers.
  const identities = [original, customer, vendor].filter(Boolean);
  if (identities.length === 0) throw new SchemaError(PROVIDER, 'Asendia did not identify the shipment');
  if (!identities.includes(requested)) throw new SchemaError(PROVIDER, 'Asendia returned a different shipment');
  if (!Array.isArray(payload.trackingBrandedDetail)) {
    throw new SchemaError(PROVIDER, 'Asendia returned an invalid tracking history');
  }
  const parsed = parseEvents(payload.trackingBrandedDetail.filter(isRecord));
  const events = parsed.map(({ event }) => event);
  const latest = events[0];
  const explicit = parsed[0]?.classified ?? null;
  const stage: Stage | null = explicit?.stage ?? (latest ? wordingStage(latest.description ?? '') : null);
  const status: CarrierStatus = explicit?.status ?? (stage ? languageStageStatus(stage) : 'unknown');

  const partner = carrierIdFromPartner('', clean(summary.finalMileTrackingLink, 500));
  const destination = clean(summary.destinationCountryIso2, 2).toUpperCase();
  const weight = weightKg(summary.weight);
  return {
    status,
    ...(explicit ? { current_stage: explicit.stage } : {}),
    last_status_text: latest?.description ?? null,
    last_update: latest?.time ?? null,
    expected_delivery: null,
    ...(weight !== null ? { weight_kg: weight } : {}),
    ...(/^[A-Z]{2}$/.test(destination) ? { destination_country: destination } : {}),
    ...(partner && partner !== 'asendia' ? { delivery_carrier: partner } : {}),
    ...(vendor && vendor !== requested && /^[A-Z0-9]{4,40}$/.test(vendor) ? { delivery_tracking_number: vendor } : {}),
    events,
  };
}

function retryAfterMs(header: string | null): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

export interface AsendiaA1TrackerOptions {
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
  /** Wall clock in milliseconds, for the configuration cache and budgets. */
  now?: () => number;
  budgetMs?: number;
}

interface CachedConfig {
  value: AsendiaA1PublicConfig;
  loadedAt: number;
  keyCheckedAt: number;
}

export class AsendiaA1Tracker {
  private readonly fetcher?: typeof fetch;
  private readonly now: () => number;
  private readonly budgetMs: number;
  private cached: CachedConfig | null = null;
  private loading: Promise<CachedConfig> | null = null;

  constructor(options: AsendiaA1TrackerOptions = {}) {
    this.fetcher = options.fetcher;
    this.now = options.now ?? Date.now;
    this.budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
    if (!Number.isFinite(this.budgetMs) || this.budgetMs <= 0) throw new TypeError('Asendia budget must be positive');
  }

  async fetch(rawTrackingNumber: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const trackingNumber = normalizeAsendiaA1TrackingNumber(rawTrackingNumber);
    const budgetMs = context.budgetMs ?? this.budgetMs;
    const deadline = this.now() + budgetMs;
    const request = { deadline, budgetMs, signal: context.signal };
    let config = this.freshConfig();
    const reused = config !== null;
    config ??= await this.loadConfig(request);
    let payload: JsonObject;
    try {
      payload = await this.tracking(config.value, trackingNumber, request);
    } catch (error) {
      // Rotated public credentials: re-read the page once, then give up.
      if (!reused || !(error instanceof AsendiaCredentialsError)) throw error;
      this.cached = null;
      config = await this.loadConfig(request);
      payload = await this.tracking(config.value, trackingNumber, request);
    }
    if (responseCode(payload) === 204 && this.now() - config.keyCheckedAt > KEY_CHECK_TTL_MS) {
      // A 204 is also what an unaccepted key produces. Confirm the key before
      // trusting the not-found, and retry once with a re-read page if it moved.
      if (!await this.keyAccepted(config.value, request)) {
        this.cached = null;
        config = await this.loadConfig(request);
        payload = await this.tracking(config.value, trackingNumber, request);
      } else {
        config.keyCheckedAt = this.now();
      }
    }
    const result = parseAsendiaA1TrackingResponse(payload, trackingNumber);
    result.tracking_url = asendiaA1TrackingUrl(trackingNumber);
    result.tracking_source = 'structured-web-response';
    return result;
  }

  private freshConfig(): CachedConfig | null {
    return this.cached && this.now() - this.cached.loadedAt < CONFIG_TTL_MS ? this.cached : null;
  }

  /** One page read at a time; concurrent lookups share it. */
  private loadConfig(request: RequestBudget): Promise<CachedConfig> {
    this.loading ??= this.readConfig(request).finally(() => { this.loading = null; });
    return this.loading;
  }

  private async readConfig(request: RequestBudget): Promise<CachedConfig> {
    const { bytes } = await fetchBounded(SCRIPT_URL, {
      headers: { Accept: '*/*', Referer: PAGE_URL, 'User-Agent': USER_AGENT },
    }, {
      provider: 'Asendia tracking page', timeoutMs: this.requestTimeout(request), maxBytes: MAX_SCRIPT_BYTES, fetcher: this.fetcher,
    });
    const value = parseAsendiaA1PublicConfig(decodeText(bytes));
    if (!await this.keyAccepted(value, request)) {
      throw new SchemaError(PROVIDER, "Asendia no longer accepts its tracking page's public key");
    }
    const now = this.now();
    this.cached = { value, loadedAt: now, keyCheckedAt: now };
    return this.cached;
  }

  private async keyAccepted(config: AsendiaA1PublicConfig, request: RequestBudget): Promise<boolean> {
    const url = new URL('/api/A1/TrackingBranded/Customer', config.baseUrl);
    url.searchParams.set('trackingKey', config.trackingKey);
    const payload = await this.api(url, config, request, 'Asendia tracking brand');
    const code = responseCode(payload);
    if (code === 200 && isRecord(payload.trackingBrandedCustomer)) return true;
    if (code === 204) return false;
    throw new IndeterminateError(PROVIDER, `Asendia answered the brand check with status ${code ?? 'none'}`);
  }

  private tracking(config: AsendiaA1PublicConfig, trackingNumber: string, request: RequestBudget): Promise<JsonObject> {
    const url = new URL('/api/A1/TrackingBranded/Tracking', config.baseUrl);
    url.searchParams.set('trackingKey', config.trackingKey);
    url.searchParams.set('trackingNumber', trackingNumber);
    return this.api(url, config, request, 'Asendia tracking');
  }

  private async api(url: URL, config: AsendiaA1PublicConfig, request: RequestBudget, provider: string): Promise<JsonObject> {
    const { response, bytes } = await fetchBounded(url, {
      headers: {
        Accept: 'application/json',
        Authorization: config.authorization,
        'X-AsendiaOne-ApiKey': config.apiKey,
        'User-Agent': USER_AGENT,
      },
    }, {
      provider, timeoutMs: this.requestTimeout(request), maxBytes: MAX_RESPONSE_BYTES, fetcher: this.fetcher,
      allowHttpError: true,
    });
    const text = decodeText(bytes);
    const payload = /^\s*\{/.test(text) ? parseJsonBytes(bytes, PROVIDER) : null;
    // Rejections put the code at the top level instead of under responseStatus.
    const code = isRecord(payload)
      ? responseCode(payload) ?? responseCode({ responseStatus: payload })
      : null;
    if (response.status === 401 || response.status === 403 || code === 401 || code === 403) {
      // The API's own JSON rejection means the header values moved; anything
      // else on 401/403 is the edge refusing the client.
      if (code === 401 || code === 403) throw new AsendiaCredentialsError();
      throw new ChallengeError(PROVIDER, 'Asendia refused the tracking request');
    }
    if (!response.ok) {
      throw new UpstreamHttpError(provider, response.status, retryAfterMs(response.headers.get('retry-after')));
    }
    if (!isRecord(payload)) throw new SchemaError(PROVIDER, 'Asendia returned an invalid tracking response');
    return payload;
  }

  private requestTimeout(request: RequestBudget): number {
    request.signal?.throwIfAborted();
    const remaining = Math.floor(request.deadline - this.now());
    if (remaining < 1) throw new BudgetExceededError(PROVIDER, request.budgetMs);
    return Math.min(MAX_REQUEST_MS, remaining);
  }
}

interface RequestBudget {
  deadline: number;
  budgetMs: number;
  signal?: AbortSignal;
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new AsendiaA1Tracker({ fetcher: environment.fetcher });
  return {
    id: 'asendia',
    // Plain HTTP against the public page's own API; no second tier.
    steps: ['direct'],
    track: (input, context) => tracker.fetch(input.number, context),
  };
};
