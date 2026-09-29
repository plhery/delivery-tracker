import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { IndeterminateError, SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { normalizeBringNumber, parseBring } from './parser';

export class BringTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeBringNumber(raw);
    return runSteps({ carrier: 'bring-posten', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      const { response, bytes } = await fetchBounded(`https://sporing.bring.no/sporing/json/${number}?lang=en`,
        { signal, headers: { Accept: 'application/json' } }, { provider: 'Bring',
          timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000, allowHttpStatuses: [404, 410], fetcher: this.options.fetcher });
      // The consumer's negative response does not identify the requested parcel.
      if (response.status === 404 || response.status === 410) throw new IndeterminateError('Bring', 'No identity-bound parcel history');
      let payload: unknown;
      try { payload = JSON.parse(decodeText(bytes)); } catch { throw new SchemaError('Bring'); }
      return parseBring(payload, number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new BringTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'bring-posten', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
