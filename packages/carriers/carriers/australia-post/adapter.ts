import 'server-only';

import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { BudgetExceededError, ChallengeError, InputRequiredError, NotFoundError, RateLimitedError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import type { StepRecorder } from '../../core/telemetry';
import { explicitOffsetTime, epochMillisTime } from '../../core/time';
import { clean, TrawlClient } from '../../core/transport';
import { isRecord } from '../../core/types';
import { australiaPostStatus } from './status';

const PROVIDER = 'Australia Post';
const DETAIL = 'https://auspost.com.au/mypost/track/details/';
const API = 'https://digitalapi.auspost.com.au/shipments-gateway/v1/watchlist/shipments';
const MAX_BYTES = 1_000_000;
const TRANSPORT_ALLOWANCE_MS = 15_000;

export function normalizeAustraliaPostNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^(?=.*\d)[A-Z0-9]{10,34}$/.test(number)) {
    throw new InputRequiredError(PROVIDER, 'number', 'Australia Post requires a 10-to-34-character tracking number');
  }
  return number;
}

export function australiaPostTrackingUrl(raw: string): string {
  return `${DETAIL}${normalizeAustraliaPostNumber(raw)}`;
}

export function australiaPostApiUrl(raw: string): string {
  return `${API}?${new URLSearchParams({ trackingIds: normalizeAustraliaPostNumber(raw) })}`;
}

/** The one lookup entry and article must independently match the submitted reference. */
export function parse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = normalizeAustraliaPostNumber(trackingNumber);
  if (!Array.isArray(payload) || !payload.length || payload.length > 20 || payload.some((entry) => !isRecord(entry))) {
    throw new SchemaError(PROVIDER, 'Australia Post returned an invalid tracking response');
  }
  const entries = payload.filter(isRecord).filter((entry) => Array.isArray(entry.trackingIds) && entry.trackingIds.includes(number));
  if (entries.length !== 1) throw new SchemaError(PROVIDER, 'Australia Post returned a different or ambiguous lookup');
  const entry = entries[0];
  if (entry.status === 400 && isRecord(entry.error) && entry.error.errorCode === 21
    && entry.error.error === 'Invalid Tracking ID' && entry.error.status === 'Failed'
    && entry.shipment === undefined) throw new NotFoundError(PROVIDER);
  if (entry.status !== 200 || !isRecord(entry.shipment) || entry.shipment.status !== 'Success') {
    throw new SchemaError(PROVIDER, 'Australia Post could not confirm the shipment');
  }
  const shipment = entry.shipment;
  if (typeof shipment.consignmentId !== 'string' || !shipment.consignmentId
    || !Array.isArray(shipment.articles) || !shipment.articles.length || shipment.articles.length > 100
    || shipment.articles.some((article) => !isRecord(article))) {
    throw new SchemaError(PROVIDER, 'Australia Post returned invalid articles');
  }
  const articles = shipment.articles.filter(isRecord);
  const matches = articles.filter((article) => article.articleId === number);
  // A consignment can contain several independent deliveries. Only an exact
  // article or a verified single-article consignment can produce one result.
  const selected = matches.length === 1 ? matches[0]
    : matches.length === 0 && shipment.consignmentId === number && articles.length === 1
      ? articles[0] : null;
  if (!selected) throw new SchemaError(PROVIDER, 'Australia Post returned a different or ambiguous article');
  if (typeof selected.articleId !== 'string' || !selected.articleId || !Array.isArray(selected.details)
    || selected.details.length !== 1 || !isRecord(selected.details[0])) {
    throw new SchemaError(PROVIDER, 'Australia Post returned invalid article details');
  }
  const details = selected.details[0];
  if (details.articleId !== selected.articleId || details.consignmentId !== shipment.consignmentId) {
    throw new SchemaError(PROVIDER, 'Australia Post returned mismatched article details');
  }
  if (!Array.isArray(details.events) || !details.events.length || details.events.length > 500) {
    throw new SchemaError(PROVIDER, 'Australia Post returned incomplete tracking history');
  }
  const events: Array<{ event: CarrierEvent; timestamp: number }> = [];
  const seen = new Set<string>();
  for (const raw of details.events) {
    if (!isRecord(raw)) throw new SchemaError(PROVIDER, 'Australia Post returned an invalid event');
    const offset = explicitOffsetTime(raw.localeDateTime);
    const epoch = typeof raw.dateTime === 'number' && Number.isSafeInteger(raw.dateTime) && raw.dateTime > 100_000_000_000
      ? epochMillisTime(raw.dateTime) : null;
    if (offset && epoch && offset.timestamp !== epoch.timestamp) throw new SchemaError(PROVIDER, 'Australia Post returned conflicting event dates');
    const at = offset ?? epoch;
    if (!at) throw new SchemaError(PROVIDER, 'Australia Post returned an invalid event date');
    const code = clean(raw.eventCode, 64);
    const description = clean(raw.description);
    const location = clean(raw.location, 200);
    if (!description) throw new SchemaError(PROVIDER, 'Australia Post returned an empty event');
    const classified = australiaPostStatus(clean(raw.milestone), code);
    const event: CarrierEvent = { time: at.iso,
      description: classified?.stage === 'delivered' ? 'Delivered' : description,
      ...(location ? { location } : {}), ...(classified ? { stage: classified.stage } : {}),
      ...(/^[A-Z0-9_-]{1,64}$/.test(code) ? { provider_code: code } : {}),
    };
    const key = JSON.stringify([at.timestamp, event.description, location, code]);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ event, timestamp: at.timestamp });
  }
  events.sort((a, b) => b.timestamp - a.timestamp);
  const summary = clean(selected.trackStatusOfArticle)
    || (isRecord(selected.status) ? clean(selected.status.statusAttributeValue) : '');
  if (!summary) throw new SchemaError(PROVIDER, 'Australia Post returned no article status');
  const status = australiaPostStatus(summary);
  const deliveredAt = status?.status === 'delivered' ? events.find(({ event }) => event.stage === 'delivered')?.event.time : null;
  // Summary modification/milestone timestamps are not scan times. In the
  // observed reply they differed from the delivery event by about ten hours.
  return {
    status: status?.status ?? 'unknown', ...(status ? { current_stage: status.stage } : {}),
    last_status_text: status?.status === 'delivered' ? 'Delivered' : summary,
    last_update: events[0]!.event.time, expected_delivery: null,
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}), events: events.slice(0, 100).map(({ event }) => event),
  };
}

export interface AustraliaPostTrackerOptions {
  trawl: TrawlClient | null;
  timeoutMs?: number;
  recorder?: StepRecorder;
}

export class AustraliaPostTracker {
  constructor(private readonly options: AustraliaPostTrackerOptions) {}

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeAustraliaPostNumber(raw);
    const budgetMs = context.budgetMs ?? this.options.timeoutMs ?? 45_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 60_000) throw new TypeError('Australia Post budget must be between 1 and 60000 ms');
    context.signal?.throwIfAborted();
    if (budgetMs <= TRANSPORT_ALLOWANCE_MS) throw new BudgetExceededError(PROVIDER, budgetMs);
    const trawl = this.options.trawl;
    if (!trawl) throw new ChallengeError(PROVIDER, 'Australia Post requires the browser tracking service');
    return runSteps({ carrier: 'australia-post', budgetMs, signal: context.signal, recorder: this.options.recorder }, [{
      id: 'trawl', run: async ({ signal, remainingMs }) => {
        const timeoutMs = Math.floor(remainingMs - TRANSPORT_ALLOWANCE_MS);
        if (timeoutMs < 1) throw new BudgetExceededError(PROVIDER, budgetMs);
        const apiUrl = australiaPostApiUrl(number);
        const page = await trawl.scrape({ url: australiaPostTrackingUrl(number), skipHttp: true, maxTier: 3,
          maxTimeout: timeoutMs, captureResponses: [apiUrl], settleTimeout: Math.min(timeoutMs, 10_000),
        }, { provider: 'TRAWL while fetching Australia Post', timeoutMs, signal, maxBytes: 6_000_000, requireSolved: false });
        signal.throwIfAborted();
        if (![2, 3].includes(page.tier) || ![200, 304].includes(page.statusCode)) {
          throw new TransportError(PROVIDER, 'The browser service did not load Australia Post tracking');
        }
        const captures = page.capturedResponses.filter((capture) => capture.url === apiUrl && capture.status !== 204);
        if (!captures.length || captures.length > 20) throw new TransportError(PROVIDER, 'Australia Post returned no matching browser response');
        const capture = captures[captures.length - 1]!;
        if (capture.status === 429) {
          const retry = capture.headers['retry-after'];
          throw new RateLimitedError(PROVIDER, retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : undefined);
        }
        if ([401, 403].includes(capture.status)) throw new ChallengeError(PROVIDER);
        if (capture.status >= 400) throw new UpstreamHttpError(PROVIDER, capture.status);
        if (capture.status !== 200 || capture.error || capture.truncated || capture.base64Encoded || capture.body === null) {
          throw new TransportError(PROVIDER, 'Australia Post returned an incomplete browser response');
        }
        if (Buffer.byteLength(capture.body, 'utf8') > MAX_BYTES) throw new SchemaError(PROVIDER, 'Australia Post returned an unexpectedly large response');
        let payload: unknown;
        try { payload = JSON.parse(capture.body); } catch { throw new SchemaError(PROVIDER, 'Australia Post returned invalid tracking JSON'); }
        return parse(payload, number);
      },
    }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new AustraliaPostTracker({ trawl: environment.trawl, recorder: environment.recorder });
  return { id: 'australia-post', steps: ['trawl'], track: (input, context) => tracker.fetch(input.number, context) };
};
