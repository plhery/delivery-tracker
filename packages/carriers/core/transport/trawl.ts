/**
 * One client for the private TRAWL browser service (a FlareSolverr-compatible
 * API). Adapters that need a real browser to get past a challenge, or to
 * capture an in-page API response, ask this client instead of building the
 * request themselves.
 *
 * Two endpoints exist on the service: the native `/scrape` API (tiers,
 * response capture, cookies, user agent) and the legacy `/v1` command API
 * (`request.get`). Both are bounded like every other provider call.
 */
import { CarrierError, UpstreamHttpError, type CarrierErrorOptions } from '../errors';
import { decodeText, fetchBounded, parseJsonBytes } from './boundedFetch';
import { clean } from './text';
import { isRecord, type JsonObject } from '../types';

export interface TrawlScrapeRequest extends JsonObject {
  url: string;
  /** Skip the plain HTTP tier and go straight to a browser. */
  skipHttp?: boolean;
  /** 1 = HTTP client, 2 = headless browser, 3 = full browser with challenge solving. */
  maxTier?: 1 | 2 | 3;
  /** Milliseconds the service may spend before answering. */
  maxTimeout?: number;
  /** In-page API URLs whose responses the browser should capture. */
  captureResponses?: string[];
  settleTimeout?: number;
}

export interface TrawlCapturedResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string | null;
  truncated: boolean;
  base64Encoded: boolean;
  error: string | null;
}

export interface TrawlScrapeResponse {
  url: string;
  html: string;
  cookies: JsonObject[];
  userAgent: string | null;
  tier: number;
  statusCode: number;
  capturedResponses: TrawlCapturedResponse[];
  /** The whole decoded payload, for adapters that read fields not modelled here. */
  raw: JsonObject;
}

export interface TrawlCallOptions {
  /** Label used in errors and diagnostics, for example "TRAWL while fetching UPS". */
  provider: string;
  timeoutMs: number;
  maxBytes?: number;
  fetcher?: typeof fetch;
  /** Require a solved browser tier (2 or 3) with HTTP 200. Default true. */
  requireSolved?: boolean;
}

export class TrawlError extends CarrierError {
  constructor(provider: string, message: string, options?: CarrierErrorOptions) {
    super('transport', provider, message, options);
    this.name = 'TrawlError';
  }
}

const DEFAULT_MAX_BYTES = 10_000_000;
const TRANSPORT_ALLOWANCE_MS = 15_000;

export function trawlEndpoint(configured: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(configured.trim());
  } catch (error) {
    throw new TypeError('FLARESOLVERR_URL must be an HTTP(S) URL', { cause: error });
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || !endpoint.host) {
    throw new TypeError('FLARESOLVERR_URL must be an HTTP(S) URL');
  }
  endpoint.pathname = endpoint.pathname.replace(/\/(?:v1|scrape)\/?$/, '').replace(/\/$/, '');
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
}

function captured(value: unknown): TrawlCapturedResponse[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(0, 50).map((entry) => ({
    url: typeof entry.url === 'string' ? entry.url : '',
    status: Number.isInteger(entry.status) ? Number(entry.status) : 0,
    headers: isRecord(entry.headers)
      ? Object.fromEntries(Object.entries(entry.headers).filter((pair): pair is [string, string] => typeof pair[1] === 'string'))
      : {},
    body: typeof entry.body === 'string' ? entry.body : null,
    truncated: entry.truncated === true,
    base64Encoded: entry.base64Encoded === true,
    error: typeof entry.error === 'string' ? entry.error : entry.error ? 'error' : null,
  }));
}

/**
 * Decode the several shapes TRAWL releases use for a captured body: a string,
 * a byte array, a serialized Node Buffer, or an index-keyed object.
 */
export function trawlBody(value: JsonObject, maxBytes = DEFAULT_MAX_BYTES): string {
  if (typeof value.body === 'string') return value.body;
  const rawBody = value.body;
  let bytes: number[] | null = null;
  const byteLike = (entry: unknown): boolean => Number.isInteger(entry) && Number(entry) >= 0 && Number(entry) <= 255;
  if (Array.isArray(rawBody)) {
    bytes = rawBody.length <= maxBytes && rawBody.every(byteLike) ? rawBody as number[] : null;
  } else if (isRecord(rawBody) && rawBody.type === 'Buffer' && Array.isArray(rawBody.data)) {
    bytes = rawBody.data.length <= maxBytes && rawBody.data.every(byteLike) ? rawBody.data as number[] : null;
  } else if (isRecord(rawBody)) {
    const entries = Object.entries(rawBody);
    if (entries.length > 0 && entries.length <= maxBytes) {
      entries.sort((left, right) => Number(left[0]) - Number(right[0]));
      const sequential = entries.every(([key, entry], index) => String(index) === key && byteLike(entry));
      if (sequential) bytes = entries.map(([, entry]) => Number(entry));
    }
  }
  return bytes ? decodeText(Uint8Array.from(bytes)) : '';
}

export class TrawlClient {
  readonly endpoint: URL;

  constructor(configured: string, private readonly fetcher?: typeof fetch) {
    this.endpoint = trawlEndpoint(configured);
  }

  /** The client for `FLARESOLVERR_URL`, or null when no browser service is configured. */
  static fromEnvironment(env: Record<string, string | undefined> = process.env, fetcher?: typeof fetch): TrawlClient | null {
    const configured = (env.FLARESOLVERR_URL ?? '').trim();
    return configured ? new TrawlClient(configured, fetcher) : null;
  }

  private withPath(segment: string): URL {
    const url = new URL(this.endpoint);
    // A bare origin normalizes its pathname back to "/", so strip it before appending.
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${segment}`;
    return url;
  }

  scrapeUrl(): URL {
    return this.withPath('scrape');
  }

  commandUrl(): URL {
    return this.withPath('v1');
  }

  /** Native API: load a page in a browser tier, optionally capturing in-page API responses. */
  async scrape(request: TrawlScrapeRequest, options: TrawlCallOptions): Promise<TrawlScrapeResponse> {
    const { bytes } = await fetchBounded(this.scrapeUrl(), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }, {
      provider: options.provider,
      timeoutMs: options.timeoutMs + TRANSPORT_ALLOWANCE_MS,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
      fetcher: options.fetcher ?? this.fetcher,
    });
    const value = parseJsonBytes(bytes, options.provider);
    if (!isRecord(value)) throw new TrawlError(options.provider, 'The browser service returned an invalid response');
    if (value.error) {
      throw new TrawlError(options.provider, clean(String(value.error), 200) || 'The browser service could not fetch the page');
    }
    const statusCode = Number(value.statusCode);
    if (Number.isInteger(statusCode) && statusCode >= 400) throw new UpstreamHttpError(options.provider, statusCode);
    const tier = Number(value.tier);
    if ((options.requireSolved ?? true) && (![2, 3].includes(tier) || statusCode !== 200)) {
      throw new TrawlError(options.provider, 'The browser service did not solve the page');
    }
    if (typeof value.html !== 'string') throw new TrawlError(options.provider, 'The browser service returned no page');
    return {
      url: typeof value.url === 'string' ? value.url : request.url,
      html: value.html,
      cookies: Array.isArray(value.cookies) ? value.cookies.filter(isRecord) : [],
      userAgent: typeof value.userAgent === 'string' ? value.userAgent : null,
      tier,
      statusCode,
      capturedResponses: captured(value.capturedResponses),
      raw: value,
    };
  }

  /** Legacy command API (`request.get`): returns the solved page HTML. */
  async solve(url: string, options: TrawlCallOptions): Promise<string> {
    const { bytes } = await fetchBounded(this.commandUrl(), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url, maxTimeout: options.timeoutMs }),
    }, {
      provider: options.provider,
      timeoutMs: options.timeoutMs + TRANSPORT_ALLOWANCE_MS,
      maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
      fetcher: options.fetcher ?? this.fetcher,
    });
    const payload = parseJsonBytes(bytes, options.provider);
    const solution = isRecord(payload) && isRecord(payload.solution) ? payload.solution : {};
    if (isRecord(payload) && payload.status === 'ok' && [200, 302].includes(Number(solution.status))
      && typeof solution.response === 'string') {
      return solution.response;
    }
    throw new TrawlError(options.provider, 'The browser service did not solve the page');
  }
}
