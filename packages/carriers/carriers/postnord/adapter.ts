import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { BudgetExceededError, IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord } from '../../core/types';
import { normalizePostnordNumber, parsePostnord } from './parser';

const ENDPOINT = 'https://api2.postnord.com/rest/shipment/v1/trackingweb/shipmentInformation';
const ORIGIN = 'https://tracking.postnord.com';

// Reproduce the bounded anonymous request proof from the official widget:
// https://tracking.postnord.com/widget-v2/pn-widget.mjs
async function requestProof(number: string, signal: AbortSignal, deadline: number, budgetMs: number): Promise<string> {
  for (let attempt = 0; attempt < 100_000; attempt += 1) {
    signal.throwIfAborted();
    if (performance.now() >= deadline) throw new BudgetExceededError('PostNord', budgetMs);
    const nonce = randomUUID();
    const digest = createHash('sha512').update(number + nonce).digest();
    if (digest[0] === 0) return Buffer.concat([digest, Buffer.from(`--${nonce}`)]).toString('base64');
    // Let cancellation and deadline timers run during an unusually long search.
    if (attempt % 128 === 127) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new IndeterminateError('PostNord', 'PostNord request proof could not be generated');
}

export class PostnordTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizePostnordNumber(raw);
    const budgetMs = context.budgetMs ?? 15_000;
    return runSteps({ carrier: 'postnord', budgetMs, signal: context.signal, recorder: this.options.recorder ?? NOOP_RECORDER }, [{
      id: 'direct', run: async ({ signal, remainingMs }) => {
        const deadline = performance.now() + remainingMs;
        const proof = await requestProof(number, signal, deadline, budgetMs);
        signal.throwIfAborted();
        const left = deadline - performance.now();
        if (left <= 0) throw new BudgetExceededError('PostNord', budgetMs);
        const url = new URL(ENDPOINT);
        url.searchParams.set('shipmentId', number);
        url.searchParams.set('locale', 'en');
        url.searchParams.set('timeZone', 'UTC');
        const { response, bytes } = await fetchBounded(url.href, { signal, headers: {
          Accept: 'application/json', Origin: ORIGIN, 'x-bap-key': 'web-tracking-sc', 'X-CustomHeader': proof,
        } }, { provider: 'PostNord', timeoutMs: Math.max(1, Math.floor(left)), maxBytes: 1_000_000,
          allowHttpStatuses: [404, 410], fetcher: this.options.fetcher });
        if (response.status === 404 || response.status === 410) {
          let negative: unknown;
          try { negative = parseJsonBytes(bytes, 'PostNord'); } catch { /* A generic error page proves no parcel negative. */ }
          if (response.status === 404 && isRecord(negative) && negative.message === 'Shipment was not found.') throw new NotFoundError('PostNord');
          throw new IndeterminateError('PostNord', 'PostNord returned an unrecognized missing-resource response');
        }
        let payload: unknown;
        try { payload = parseJsonBytes(bytes, 'PostNord'); }
        catch (cause) { throw new SchemaError('PostNord', 'PostNord returned invalid shipment JSON', { cause }); }
        return parsePostnord(payload, number);
      },
    }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PostnordTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'postnord', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
