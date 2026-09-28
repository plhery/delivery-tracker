import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { IndeterminateError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { normalizeCorreosExpressNumber, parseCorreosExpress } from './parser';

const ENDPOINT = 'https://s.correosexpress.com/SeguimientoSinCP/search';

export class CorreosExpressTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeCorreosExpressNumber(raw);
    return runSteps({ carrier: 'correos-express', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      const { response, bytes } = await fetchBounded(ENDPOINT, { method: 'POST', signal,
        headers: { Accept: 'text/html' }, body: new URLSearchParams({ shippingNumber: number, errorCode: '' }),
      }, { provider: 'Correos Express', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000,
        allowHttpStatuses: [404, 410], fetcher: this.options.fetcher });
      if (response.status !== 200) throw new IndeterminateError('Correos Express', 'Correos Express tracking endpoint is unavailable');
      return parseCorreosExpress(decodeText(bytes), number);
    } }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new CorreosExpressTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'correos-express', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeCorreosExpressNumber(number))) };
};
