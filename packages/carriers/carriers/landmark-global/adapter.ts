import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { normalizeLandmarkNumber, parseLandmark } from './parser';

export class LandmarkTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}
  async fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeLandmarkNumber(raw);
    return runSteps({ carrier: 'landmark-global', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      try {
        const { bytes } = await fetchBounded(`https://track.landmarkglobal.com/?${new URLSearchParams({ search: number, lang: 'en' })}`,
          { signal }, { provider: 'Landmark Global', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000, fetcher: this.options.fetcher });
        return parseLandmark(decodeText(bytes), number);
      } catch (error) {
        if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError('Landmark Global', 'Landmark tracking endpoint is unavailable', { cause: error });
        throw error;
      }
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new LandmarkTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'landmark-global', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
