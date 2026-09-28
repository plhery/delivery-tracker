import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { IndeterminateError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
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
        allowHttpStatuses: [404, 410], fetcher: this.options.fetcher });
      if (response.status === 404 || response.status === 410) {
        // The portal returns generic ProblemDetails for unknown numbers; the
        // same envelope can mean a missing API route rather than no parcel.
        throw new IndeterminateError('OnTrac', 'OnTrac could not return the tracking resource');
      }
      return parseOntrac(parseJsonBytes(bytes, 'OnTrac'), number);
    } }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new OntracTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'ontrac', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
