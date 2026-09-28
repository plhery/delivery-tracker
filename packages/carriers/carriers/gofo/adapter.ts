import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeGofoNumber, parseGofo } from './parser';

const ENDPOINT = 'https://www.gofo.com/us/cnee-api/consignee/track/query/page';

export class GofoTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}
  async fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeGofoNumber(raw);
    return runSteps({ carrier: 'gofo', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      try {
        const { bytes } = await fetchBounded(ENDPOINT, { method: 'POST', signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', lang: 'en', 'User-Time-Zone': 'Local Time' },
          body: JSON.stringify({ numberList: [number] }) }, { provider: 'GOFO', timeoutMs: Math.max(1, Math.floor(remainingMs)),
          maxBytes: 1_000_000, fetcher: this.options.fetcher });
        let payload: unknown;
        try { payload = parseJsonBytes(bytes, 'GOFO'); } catch (cause) { throw new SchemaError('GOFO', 'GOFO returned invalid tracking JSON', { cause }); }
        return parseGofo(payload, number);
      } catch (error) {
        if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError('GOFO', 'GOFO tracking endpoint is unavailable', { cause: error });
        throw error;
      }
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new GofoTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'gofo', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
