import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { BudgetExceededError, IndeterminateError, SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeNinjaVanNumber, parseNinjaVan, parseNinjaVanNotFound } from './parser';

const ENDPOINT = 'https://walrus.ninjavan.co/my/dash/1.2/public/orders';

export class NinjaVanTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeNinjaVanNumber(raw);
    return runSteps({ carrier: 'ninja-van', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      if (remainingMs <= 0) throw new BudgetExceededError('Ninja Van', context.budgetMs ?? 15_000);
      const url = new URL(ENDPOINT);
      url.searchParams.set('tracking_id', number);
      const { response, bytes } = await fetchBounded(url, { signal, headers: { Accept: 'application/json' } }, {
        provider: 'Ninja Van', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000,
        allowHttpStatuses: [404], fetcher: this.options.fetcher,
      });
      let payload: unknown;
      try { payload = parseJsonBytes(bytes, 'Ninja Van'); }
      catch (cause) { throw new SchemaError('Ninja Van', 'Ninja Van returned invalid tracking JSON', { cause }); }
      if (response.status === 404) return parseNinjaVanNotFound(payload, number);
      if (response.status !== 200) throw new IndeterminateError('Ninja Van', 'Ninja Van returned an inconclusive tracking response');
      return parseNinjaVan(payload, number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new NinjaVanTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'ninja-van', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context),
      () => accepted(() => normalizeNinjaVanNumber(number))) };
};
