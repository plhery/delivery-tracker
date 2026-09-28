import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeNzPostNumber, parseNzPost } from './parser';

const ENDPOINT = 'https://tools.nzpost.co.nz/tracking/api/parceltrack/parcels';

export class NzPostTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeNzPostNumber(raw);
    return runSteps({ carrier: 'nz-post', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      const url = new URL(ENDPOINT); url.searchParams.set('tracking_reference', number);
      let bytes: Uint8Array;
      try {
        ({ bytes } = await fetchBounded(url, { signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json' } },
          { provider: 'nz-post', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000, fetcher: this.options.fetcher }));
      } catch (error) {
        if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
          throw new TransportError('nz-post', 'NZ Post tracking endpoint is unavailable', { cause: error });
        }
        throw error;
      }
      let payload: unknown;
      try { payload = parseJsonBytes(bytes, 'nz-post'); }
      catch (cause) { throw new SchemaError('nz-post', 'NZ Post returned invalid tracking JSON', { cause }); }
      return parseNzPost(payload, number);
    } }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new NzPostTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'nz-post', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeNzPostNumber(number))) };
};
