import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { IndeterminateError, NotFoundError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord } from '../../core/types';
import { normalizeOntracNumber, parseOntrac } from './parser';

// Endpoint and schema come from the current official portal client:
// https://www.ontrac.com/wp-content/themes/ontrac/assets/js/ontrac-package-status.js
const ENDPOINT = 'https://webtrack.ontrac.com/PackageServices/tracking/';

export class OntracTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeOntracNumber(raw);
    return runSteps({ carrier: 'ontrac', budgetMs: context.budgetMs ?? 15_000,
      signal: context.signal, recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      const { response, bytes } = await fetchBounded(`${ENDPOINT}${encodeURIComponent(number)}`, {
        headers: { Accept: 'application/json' }, signal,
      }, { provider: 'OnTrac', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000,
        allowHttpError: true, fetcher: this.options.fetcher });
      if (response.status === 404 || response.status === 410) {
        let negative: unknown;
        try { negative = parseJsonBytes(bytes, 'OnTrac'); } catch { /* A generic error page proves no parcel negative. */ }
        if (response.status === 404 && isRecord(negative) && negative.Title === 'Not Found' && negative.Status === 404) throw new NotFoundError('OnTrac');
        throw new IndeterminateError('OnTrac', 'OnTrac returned an unrecognized missing-resource response');
      }
      if (!response.ok) throw new UpstreamHttpError('OnTrac', response.status);
      return parseOntrac(parseJsonBytes(bytes, 'OnTrac'), number);
    } }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new OntracTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'ontrac', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
