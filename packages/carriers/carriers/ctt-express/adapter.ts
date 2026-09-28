import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { IndeterminateError, SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeCttExpressNumber, parseCttExpress } from './parser';

const ENDPOINT = 'https://wct.cttexpress.com/p_track_redis_v2.php';

export class CttExpressTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeCttExpressNumber(raw);
    return runSteps({ carrier: 'ctt-express', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      const url = new URL(ENDPOINT);
      url.searchParams.set('sc', number);
      const { response, bytes } = await fetchBounded(url, { signal, headers: { Accept: 'application/json',
        Origin: 'https://shipping-tracking.production.cloud2.cttexpress.com',
      } }, { provider: 'CTT Express', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000,
        allowHttpStatuses: [404, 410], fetcher: this.options.fetcher });
      if (response.status !== 200) throw new IndeterminateError('CTT Express', 'CTT Express tracking endpoint is unavailable');
      let payload: unknown;
      try { payload = parseJsonBytes(bytes, 'CTT Express'); }
      catch (cause) { throw new SchemaError('CTT Express', 'CTT Express returned invalid tracking JSON', { cause }); }
      return parseCttExpress(payload, number);
    } }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new CttExpressTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'ctt-express', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeCttExpressNumber(number))) };
};
