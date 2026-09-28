import 'server-only';

import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { IndeterminateError, TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeDtdcNumber, parseDtdc } from './parser';

// The current official MyDTDC app's anonymous tracking feed. Its deployed
// assets/configs/prod.json names this host; the Flutter client calls this path.
const ENDPOINT = 'https://ebookingbackend.dtdc.in/trackConsignment';

export class DtdcTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeDtdcNumber(raw);
    return runSteps({ carrier: 'dtdc', signal: context.signal, budgetMs: context.budgetMs ?? 15_000,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      try {
        const { bytes } = await fetchBounded(`${ENDPOINT}?reference_number=${number}`, { signal, headers: { Accept: 'application/json' } }, {
          provider: 'DTDC', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000, fetcher: this.options.fetcher,
        });
        return parseDtdc(parseJsonBytes(bytes, 'DTDC'), number);
      } catch (error) {
        // The feed answers unavailable references with a generic HTTP 400,
        // which does not prove absence. Endpoint 404s are not parcel absence.
        if (error instanceof UpstreamHttpError && error.status === 400) throw new IndeterminateError('DTDC', 'DTDC could not return shipment details', { cause: error });
        if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError('DTDC', 'DTDC tracking endpoint is unavailable', { cause: error });
        throw error;
      }
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new DtdcTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'dtdc', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
