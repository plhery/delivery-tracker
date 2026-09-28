import 'server-only';
import { load } from 'cheerio';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizePocztaPolskaNumber, parsePocztaPolska } from './parser';

const PORTAL = 'https://emonitoring.poczta-polska.pl/';
const BASE = 'https://uss.poczta-polska.pl/uss/v2.0/tracking';

export function parsePocztaPolskaBootstrap(html: string): { endpoint: string; apiKey: string } {
  const widgets = load(html)('#widgetTracking');
  const endpoint = widgets.attr('data-urltracking');
  const apiKey = widgets.attr('data-apikey');
  if (widgets.length !== 1 || endpoint !== BASE || !apiKey || apiKey.length < 20 || apiKey.length > 4096 || /\s/.test(apiKey)) {
    throw new SchemaError('poczta-polska', 'Poczta Polska tracking configuration changed');
  }
  return { endpoint, apiKey };
}

export class PocztaPolskaTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizePocztaPolskaNumber(raw);
    return runSteps({ carrier: 'poczta-polska', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      const started = performance.now();
      const bounded = async (url: string, init: RequestInit, maxBytes: number) => {
        signal.throwIfAborted();
        try {
          return await fetchBounded(url, { ...init, signal }, { provider: 'poczta-polska',
            timeoutMs: Math.max(1, Math.floor(remainingMs - (performance.now() - started))),
            maxBytes, fetcher: this.options.fetcher });
        } catch (error) {
          if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
            throw new TransportError('poczta-polska', 'Poczta Polska tracking endpoint is unavailable', { cause: error });
          }
          throw error;
        }
      };
      // This key is anonymous widget configuration published on the portal,
      // not an issued account credential. Read it fresh instead of storing it.
      const { bytes: html } = await bounded(PORTAL, { headers: { Accept: 'text/html' } }, 500_000);
      const { endpoint, apiKey } = parsePocztaPolskaBootstrap(decodeText(html));
      const { bytes } = await bounded(`${endpoint}/checkmailex`, { method: 'POST', headers: {
        Accept: 'application/json', 'Content-Type': 'application/json', API_KEY: apiKey,
      }, body: JSON.stringify({ language: 'EN', number, addPostOfficeInfo: false }) }, 1_000_000);
      let payload: unknown;
      try { payload = parseJsonBytes(bytes, 'poczta-polska'); }
      catch (cause) { throw new SchemaError('poczta-polska', 'Poczta Polska returned invalid tracking JSON', { cause }); }
      return parsePocztaPolska(payload, raw);
    } }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PocztaPolskaTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'poczta-polska', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizePocztaPolskaNumber(number))) };
};
