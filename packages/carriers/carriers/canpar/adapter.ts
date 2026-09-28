import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { SchemaError, TransportError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeCanparNumber, parseCanpar } from './parser';

const ENDPOINT = 'https://canship.canpar.com/api/CanparAddons/trackByBarcodeV2';

export class CanparTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeCanparNumber(raw);
    return runSteps({ carrier: 'canpar', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      const { response, bytes } = await fetchBounded(ENDPOINT, { method: 'POST', signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ barcode: number, track_shipment: false }),
      }, { provider: 'Canpar', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000,
        allowHttpStatuses: [404, 410], fetcher: this.options.fetcher });
      if (response.status !== 200) throw new TransportError('Canpar', 'Canpar tracking endpoint is unavailable');
      let payload: unknown;
      try { payload = parseJsonBytes(bytes, 'Canpar'); }
      catch (cause) { throw new SchemaError('Canpar', 'Canpar returned invalid tracking JSON', { cause }); }
      return parseCanpar(payload, number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new CanparTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'canpar', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context),
      () => accepted(() => normalizeCanparNumber(number))) };
};
