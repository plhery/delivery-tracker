import 'server-only';

import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { BudgetExceededError, ChallengeError, RateLimitedError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import type { StepRecorder } from '../../core/telemetry';
import { TrawlClient } from '../../core/transport';
import { normalizeSfExpressNumber, parse } from './parser';

export { normalizeSfExpressNumber, parse } from './parser';

const PROVIDER = 'SF Express';
const ORIGIN = 'https://htm.sf-express.com';
const TRANSPORT_ALLOWANCE_MS = 15_000;

export function sfExpressTrackingUrl(raw: string): string {
  return `${ORIGIN}/tw/en/dynamic_function/waybill/#search/bill-number/${normalizeSfExpressNumber(raw)}`;
}

export function sfExpressApiUrl(raw: string): string {
  return `${ORIGIN}/sf-service-core-web/service/bills/${normalizeSfExpressNumber(raw)}/routes`;
}

function matchesCapture(url: string, number: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.hash || `${parsed.origin}${parsed.pathname}` !== sfExpressApiUrl(number)) return false;
    const allowed = new Map([['lang', 'en'], ['region', 'tw'], ['translate', ''], ['app', 'bill']]);
    return [...parsed.searchParams].every(([key, value]) => allowed.get(key) === value && parsed.searchParams.getAll(key).length === 1);
  } catch { return false; }
}

export class SfExpressTracker {
  constructor(private readonly options: { trawl: TrawlClient | null; timeoutMs?: number; recorder?: StepRecorder }) {}

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeSfExpressNumber(raw);
    const budgetMs = context.budgetMs ?? this.options.timeoutMs ?? 45_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 60_000) throw new TypeError('SF Express budget must be between 1 and 60000 ms');
    context.signal?.throwIfAborted();
    if (budgetMs <= TRANSPORT_ALLOWANCE_MS) throw new BudgetExceededError(PROVIDER, budgetMs);
    const trawl = this.options.trawl;
    if (!trawl) throw new ChallengeError(PROVIDER, 'SF Express requires the browser tracking service');
    return runSteps({ carrier: 'sf-express', budgetMs, signal: context.signal, recorder: this.options.recorder }, [{
      id: 'trawl', run: async ({ signal, remainingMs }) => {
        const timeoutMs = Math.floor(remainingMs - TRANSPORT_ALLOWANCE_MS);
        if (timeoutMs < 1) throw new BudgetExceededError(PROVIDER, budgetMs);
        const page = await trawl.scrape({ url: sfExpressTrackingUrl(number), skipHttp: true, maxTier: 3, maxTimeout: timeoutMs,
          captureResponses: [sfExpressApiUrl(number)], settleTimeout: Math.min(timeoutMs, 10_000),
        }, { provider: 'TRAWL while fetching SF Express', timeoutMs, signal, maxBytes: 6_000_000, requireSolved: false });
        signal.throwIfAborted();
        if (![2, 3].includes(page.tier) || page.statusCode !== 200) throw new TransportError(PROVIDER, 'The browser service did not load SF Express tracking');
        const captures = page.capturedResponses.filter((capture) => matchesCapture(capture.url, number) && capture.status !== 204);
        if (!captures.length || captures.length > 10) throw new TransportError(PROVIDER, 'SF Express returned no matching tracking response');
        const capture = captures[captures.length - 1]!;
        if (capture.status === 429) {
          const retry = capture.headers['retry-after'];
          throw new RateLimitedError(PROVIDER, retry && /^\d+$/.test(retry) ? Number(retry) * 1_000 : undefined);
        }
        if ([401, 403].includes(capture.status)) throw new ChallengeError(PROVIDER);
        if ([404, 410].includes(capture.status)) throw new TransportError(PROVIDER, 'SF Express tracking endpoint is unavailable');
        if (capture.status >= 400) throw new UpstreamHttpError(PROVIDER, capture.status);
        if (capture.status !== 200 || capture.error || capture.truncated || capture.base64Encoded || capture.body === null) {
          throw new TransportError(PROVIDER, 'SF Express returned an incomplete tracking response');
        }
        if (Buffer.byteLength(capture.body, 'utf8') > 1_000_000) throw new SchemaError(PROVIDER, 'SF Express returned an unexpectedly large response');
        let payload: unknown;
        try { payload = JSON.parse(capture.body); } catch { throw new SchemaError(PROVIDER, 'SF Express returned invalid tracking JSON'); }
        return parse(payload, number);
      },
    }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new SfExpressTracker({ trawl: environment.trawl, recorder: environment.recorder });
  return { id: 'sf-express', steps: ['trawl'], track: (input, context) => tracker.fetch(input.number, context) };
};
