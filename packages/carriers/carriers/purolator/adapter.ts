import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { ChallengeError, IndeterminateError, SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizePurolatorNumber, parsePurolator } from './parser';

const ENDPOINT = 'https://public-tracking.purolator.com/tracking/data';
// Public anonymous client configuration, not an account/API credential:
// https://web.purolator.com/app/tracker/js/app.tracker-drupal.js
const PUBLIC_WIDGET_KEY = 'NneqHVQEJO5CkHcsiPXqJ8cTAngvBR1D3Rcu3baQ'; // gitleaks:allow
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export class PurolatorTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizePurolatorNumber(raw);
    return runSteps({ carrier: 'purolator', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      const { response, bytes } = await fetchBounded(ENDPOINT, { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT, 'x-api-key': PUBLIC_WIDGET_KEY },
        body: JSON.stringify({ search: [{ trackingId: number, sequenceId: 1, eventSortOrder: 'd' }], language: 'en' }),
      }, { provider: 'Purolator', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000,
        allowHttpStatuses: [404, 405, 410], fetcher: this.options.fetcher });
      if ([202, 405].includes(response.status) && ['captcha', 'challenge'].includes(response.headers.get('x-amzn-waf-action') ?? '')) {
        throw new ChallengeError('Purolator', 'Purolator requires an AWS WAF challenge');
      }
      if (response.status !== 200) throw new IndeterminateError('Purolator', 'Purolator returned an unrecognized tracking response');
      let payload: unknown;
      try { payload = parseJsonBytes(bytes, 'Purolator'); }
      catch (cause) { throw new SchemaError('Purolator', 'Purolator returned invalid tracking JSON', { cause }); }
      return parsePurolator(payload, number);
    } }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PurolatorTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'purolator', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
