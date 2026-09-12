/**
 * The browser capture the two TRAWL-backed providers share.
 *
 * ParcelsApp and 17TRACK both render their history from an in-page API call,
 * so the browser service loads the public tracking page and hands back the
 * responses it saw for that one API URL. This module performs that call,
 * yields the readable bodies newest first, and turns the service's own answers
 * (a redirect, a rejected status, an unreadable body) into the shared error
 * taxonomy. Parsing stays with each provider.
 */
import { IndeterminateError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { TrawlClient, TrawlScrapeResponse } from '../../core/transport';
import type { UniversalSource } from './result';

/** How many responses the browser may have captured before the newest is meaningless. */
const MAX_CAPTURED = 20;
/** How long the browser waits for the in-page API call after the page settles. */
const SETTLE_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 10_000_000;

export interface CaptureSpec {
  source: UniversalSource;
  /** The public tracking page the browser loads. */
  url: string;
  /** The in-page API URL whose responses are captured. */
  apiUrl: string;
  budgetMs: number;
  fetcher?: typeof fetch;
}

/**
 * The browser answered, but no shipment history came back with it: the service
 * captured nothing (`capture_missing`), could not read the body it captured
 * (`capture_unreadable`), or captured only replies without history
 * (`history_missing`). None of them prove anything about the shipment.
 */
export class TrackingCaptureError extends IndeterminateError {
  constructor(
    readonly reason: 'capture_missing' | 'capture_unreadable' | 'history_missing',
    provider = 'Tracking browser',
  ) {
    super(provider, `Tracking browser: ${reason}`);
    this.name = 'TrackingCaptureError';
  }
}

function retryAfterMs(headers: Record<string, string>): number | undefined {
  const raw = headers['retry-after'];
  if (typeof raw !== 'string') return undefined;
  return /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now();
}

/** Load the provider's tracking page in the browser service, capturing its API call. */
export async function loadCapture(trawl: TrawlClient | null, spec: CaptureSpec): Promise<TrawlScrapeResponse> {
  if (!trawl) throw new TransportError(spec.source, 'Automatic carrier lookup requires the tracking browser service');
  const budgetMs = Math.max(1, Math.floor(spec.budgetMs));
  const page = await trawl.scrape({
    url: spec.url, skipHttp: true, maxTier: 3, maxTimeout: budgetMs,
    captureResponses: [spec.apiUrl], settleTimeout: SETTLE_TIMEOUT_MS,
  }, {
    provider: `${spec.source} tracking browser`, timeoutMs: budgetMs,
    maxBytes: MAX_PAGE_BYTES, fetcher: spec.fetcher,
    // A 304 page still carries a fresh captured API reply (observed on
    // 17TRACK 2026-09-13), so the solved-page gate below allows it: the caller
    // validates through the captured bodies (identity, demo and polling
    // rejection) instead of the page status. Without a usable capture the
    // caller still fails closed with a typed capture error.
    requireSolved: false,
  });
  // A solved page for another URL is an interstitial or a redirect, never this shipment.
  if (page.url !== spec.url) throw new SchemaError(spec.source, 'Tracking browser returned an incomplete page');
  // Preserve the solved-tier requirement for capture flows: only a browser
  // tier (2/3) with a fresh (200) or not-modified (304) page may carry a
  // usable capture. Anything else stays an unsolved page, as before.
  if (![2, 3].includes(page.tier) || (page.statusCode !== 200 && page.statusCode !== 304)) {
    throw new TransportError(spec.source, 'Tracking browser: page unsolved');
  }
  return page;
}

/**
 * The captured bodies for the provider's API, newest first. Lazily generated:
 * a rejected status only ends the lookup when no newer body parsed first,
 * which keeps a completed reply usable after an intermediate failure.
 */
export function* capturedBodies(page: TrawlScrapeResponse, spec: CaptureSpec): Generator<string> {
  for (const entry of page.capturedResponses.slice(0, MAX_CAPTURED).reverse()) {
    if (entry.url !== spec.apiUrl) continue;
    // Preserve the provider's own status for the router's backoff policy.
    if (entry.status === 429) throw new UpstreamHttpError(spec.source, 429, retryAfterMs(entry.headers));
    if (entry.status >= 400) throw new UpstreamHttpError(spec.source, entry.status);
    if (entry.status !== 200 || entry.truncated || entry.base64Encoded || entry.body === null) continue;
    yield entry.body;
  }
}

/** Why a captured page carried no usable history, once every body has been tried. */
export function captureFailure(page: TrawlScrapeResponse, spec: CaptureSpec): TrackingCaptureError {
  if (!Array.isArray(page.raw.capturedResponses)) return new TrackingCaptureError('capture_missing', spec.source);
  const unreadable = page.capturedResponses.some((entry) => entry.url === spec.apiUrl && (entry.error || entry.body === null));
  return new TrackingCaptureError(unreadable ? 'capture_unreadable' : 'history_missing', spec.source);
}
