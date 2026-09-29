import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { BudgetExceededError, IndeterminateError, SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { normalizeBrtNumber, parseBrt } from './parser';

export class BrtTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeBrtNumber(raw);
    return runSteps({ carrier: 'brt', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      const deadline = performance.now() + remainingMs;
      const { response, bytes } = await fetchBounded(`https://vas.brt.it/vas/sped_det_new.htm?brtCode=${number}&lang=en`,
        { signal }, { provider: 'BRT', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000,
          redirect: 'manual', allowHttpStatuses: [302, 404, 410], fetcher: this.options.fetcher });
      if (performance.now() >= deadline) throw new BudgetExceededError('BRT', context.budgetMs ?? 15_000);
      signal.throwIfAborted();
      if (response.status !== 200) throw new IndeterminateError('BRT', 'BRT tracking endpoint is unavailable');
      const charset = /charset\s*=\s*["']?([A-Za-z0-9_-]+)/i.exec(response.headers.get('content-type') ?? '')?.[1].toLowerCase();
      if (charset && !['utf-8', 'utf8', 'iso-8859-1', 'windows-1252'].includes(charset)) throw new SchemaError('BRT', 'BRT response encoding changed');
      return parseBrt(decodeText(bytes, charset?.startsWith('utf') ? 'utf-8' : 'windows-1252'), number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new BrtTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'brt', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeBrtNumber(number))) };
};
