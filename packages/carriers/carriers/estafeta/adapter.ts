import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { BudgetExceededError, TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { normalizeEstafetaNumber, parseEstafetaHistory, parseEstafetaLookup } from './parser';

const ORIGIN = 'https://cs.estafeta.com';

export class EstafetaTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}
  async fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeEstafetaNumber(raw);
    const budgetMs = context.budgetMs ?? 15_000;
    return runSteps({ carrier: 'estafeta', budgetMs, signal: context.signal, recorder: this.options.recorder ?? NOOP_RECORDER },
      [{ id: 'direct', run: async ({ signal, remainingMs }) => {
        const started = performance.now();
        const timeout = () => {
          signal.throwIfAborted();
          const left = remainingMs - (performance.now() - started);
          if (left <= 0) throw new BudgetExceededError('Estafeta', budgetMs);
          return Math.max(1, Math.floor(left));
        };
        try {
          const params = new URLSearchParams({ wayBill: number, wayBillType: number.length === 10 ? '0' : '1', isShipmentDetail: 'True' });
          const first = await fetchBounded(`${ORIGIN}/es/Tracking/searchByGet?${params}`, { signal },
            { provider: 'Estafeta', timeoutMs: timeout(), maxBytes: 1_000_000, fetcher: this.options.fetcher });
          const lookup = parseEstafetaLookup(decodeText(first.bytes), number);
          // Only the identity-bound canonical guide controls this read-only
          // history request. No account, issued session or report API is used.
          const history = await fetchBounded(`${ORIGIN}/es/Tracking/GetTrackingItemHistory`, { method: 'POST', signal,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ waybill: lookup.guide }).toString() },
            { provider: 'Estafeta', timeoutMs: timeout(), maxBytes: 1_000_000, fetcher: this.options.fetcher });
          return parseEstafetaHistory(decodeText(history.bytes), lookup);
        } catch (error) {
          if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError('Estafeta', 'Estafeta tracking endpoint is unavailable', { cause: error });
          throw error;
        }
      } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new EstafetaTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'estafeta', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
