import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { BudgetExceededError, IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { ciblexTrackingUrl, normalizeCiblexTrackingNumber, parseCiblexTrackingHtml } from './parser';

export { ciblexTrackingUrl, normalizeCiblexTrackingNumber, parseCiblexTrackingHtml } from './parser';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 750_000;

export interface CiblexTrackerOptions {
  timeoutMs?: number;
  fetcher?: typeof fetch;
  recorder?: StepRecorder;
}

export class CiblexTracker {
  readonly timeoutMs: number;
  readonly fetcher?: typeof fetch;
  private readonly recorder: StepRecorder;

  constructor(options: CiblexTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
    this.recorder = options.recorder ?? NOOP_RECORDER;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new TypeError('Ciblex timeout must be positive');
  }

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeCiblexTrackingNumber(raw);
    const budgetMs = context.budgetMs ?? this.timeoutMs;
    return runSteps({ carrier: 'ciblex', budgetMs, signal: context.signal, recorder: this.recorder },
      [{ id: 'direct', run: async ({ signal, remainingMs }) => {
        signal.throwIfAborted();
        const deadline = performance.now() + remainingMs;
        const { response, bytes } = await fetchBounded(ciblexTrackingUrl(number), { signal },
          { provider: 'Ciblex', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: MAX_RESPONSE_BYTES,
            redirect: 'manual', allowHttpStatuses: [302, 404, 410], fetcher: this.fetcher });
        if (performance.now() >= deadline) throw new BudgetExceededError('Ciblex', budgetMs);
        signal.throwIfAborted();
        if (response.status !== 200) throw new IndeterminateError('Ciblex', 'Ciblex tracking endpoint is unavailable');
        const charset = /charset\s*=\s*["']?([A-Za-z0-9_-]+)/i.exec(response.headers.get('content-type') ?? '')?.[1].toLowerCase();
        if (charset && !['utf-8', 'utf8', 'iso-8859-1', 'windows-1252'].includes(charset)) throw new SchemaError('Ciblex', 'Ciblex response encoding changed');
        // The current HTTP header declares UTF-8 despite the older HTML meta tag.
        return parseCiblexTrackingHtml(decodeText(bytes, charset && !charset.startsWith('utf') ? 'windows-1252' : 'utf-8'), number);
      } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new CiblexTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'ciblex', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeCiblexTrackingNumber(number))) };
};
