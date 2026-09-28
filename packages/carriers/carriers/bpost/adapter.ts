import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { accepted, recognizeFromLookup } from '../../core/adapter';
import { SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeBpostNumber, parseBpost } from './parser';

// The official frontend's getItemsByBarcodeArray request returns minimized
// tracking history without the postcode required by its single-item GET.
const ENDPOINT = 'https://track.bpost.cloud/track/items';

export class BpostTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeBpostNumber(raw);
    return runSteps({ carrier: 'bpost', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      let bytes: Uint8Array;
      try {
        ({ bytes } = await fetchBounded(ENDPOINT, { method: 'POST', signal,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ barcodes: [number] }),
        }, { provider: 'bpost', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000, fetcher: this.options.fetcher }));
      } catch (error) {
        if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
          throw new TransportError('bpost', 'bpost tracking endpoint is unavailable', { cause: error });
        }
        throw error;
      }
      let payload: unknown;
      try { payload = parseJsonBytes(bytes, 'bpost'); }
      catch (cause) { throw new SchemaError('bpost', 'bpost returned invalid tracking JSON', { cause }); }
      return parseBpost(payload, number);
    } }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new BpostTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'bpost', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeBpostNumber(number))) };
};
