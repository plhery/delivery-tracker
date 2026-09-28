import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeUniuniNumber, normalizeUniuniRecognitionNumber, parseUniuni } from './parser';

const ENDPOINT = 'https://tracking-service-api.uniuni.ca/tracking/trackinguniuninew';
// Fixed anonymous website configuration from the official tracking client;
// this is neither an account credential nor an issued browser/session token.
const WEB_KEY = 'SMq45nJhQuNR3WHsJA6N'; // gitleaks:allow

export class UniuniTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeUniuniNumber(raw);
    return runSteps({ carrier: 'uniuni', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      let bytes: Uint8Array;
      try {
        const params = new URLSearchParams({ id: number, key: WEB_KEY, source: 'web' });
        ({ bytes } = await fetchBounded(`${ENDPOINT}?${params}`, { signal, headers: { Accept: 'application/json' } }, {
          provider: 'UniUni', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000, fetcher: this.options.fetcher,
        }));
      } catch (error) {
        if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
          throw new TransportError('UniUni', 'UniUni tracking endpoint is unavailable', { cause: error });
        }
        throw error;
      }
      let payload: unknown;
      try { payload = parseJsonBytes(bytes, 'UniUni'); }
      catch (cause) { throw new SchemaError('UniUni', 'UniUni returned invalid tracking JSON', { cause }); }
      return parseUniuni(payload, number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new UniuniTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'uniuni', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context),
      () => accepted(() => normalizeUniuniRecognitionNumber(number))) };
};
