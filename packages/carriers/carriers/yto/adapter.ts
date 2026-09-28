import 'server-only';

import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeYtoNumber, parseYto } from './parser';

// Current domestic website request builder, queryWaybillTrackList:
// https://www.yto.net.cn/ (Nuxt client). This endpoint accepts anonymous reads.
const ENDPOINT = 'https://www.yto.net.cn/ec/order/gwWaybillInfoList';

export class YtoTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeYtoNumber(raw);
    return runSteps({ carrier: 'yto', signal: context.signal, budgetMs: context.budgetMs ?? 15_000,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      try {
        const { bytes } = await fetchBounded(ENDPOINT, { method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', source: 'PC' }, body: JSON.stringify([number]),
        }, { provider: 'YTO Express', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000, fetcher: this.options.fetcher });
        return parseYto(parseJsonBytes(bytes, 'YTO Express'), number);
      } catch (error) {
        if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
          throw new TransportError('YTO Express', 'YTO tracking endpoint is unavailable', { cause: error });
        }
        throw error;
      }
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new YtoTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'yto', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
