import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeDelhiveryNumber, parseDelhivery } from './parser';

// Anonymous consumer feed with independently checked identity-bound responses.
// Prior endpoint lead: https://github.com/ha-parcel-integrations/ha-delhivery
const ENDPOINT = 'https://dlv-api.delhivery.com/v3/unified-tracking-new';

export class DelhiveryTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}
  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeDelhiveryNumber(raw);
    return runSteps({ carrier: 'delhivery', budgetMs: context.budgetMs ?? 15_000,
      signal: context.signal, recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      let bytes: Uint8Array;
      try { ({ bytes } = await fetchBounded(`${ENDPOINT}?wbn=${number}`, { signal,
        headers: { Accept: 'application/json', Origin: 'https://www.delhivery.com', Referer: 'https://www.delhivery.com/' },
      }, { provider: 'Delhivery', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000, fetcher: this.options.fetcher })); }
      catch (error) {
        if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError('Delhivery', 'Delhivery tracking endpoint is unavailable', { cause: error });
        throw error;
      }
      return parseDelhivery(parseJsonBytes(bytes, 'Delhivery'), number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new DelhiveryTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'delhivery', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
