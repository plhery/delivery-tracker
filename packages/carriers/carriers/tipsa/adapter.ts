import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { BudgetExceededError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { normalizeTipsaNumber, parseTipsaDetail, tipsaDetailUrl } from './parser';

// The shop link (www.tip-sa.com/cliente/datos_prestashop.php) redirects here.
const LOOKUP = 'https://aplicaciones.tip-sa.com/cliente/datos_prestashop.php';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const LOOKUP_MAX_BYTES = 20_000;
const DETAIL_MAX_BYTES = 1_000_000;
const REDIRECTS = [301, 302, 303, 307, 308];

export class TipsaTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeTipsaNumber(raw);
    const budgetMs = context.budgetMs ?? 15_000;
    return runSteps({ carrier: 'tipsa', budgetMs, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      const deadline = performance.now() + remainingMs;
      const read = async (url: string, maxBytes: number, encoding: string) => {
        signal.throwIfAborted();
        const left = deadline - performance.now();
        if (left <= 0) throw new BudgetExceededError('TIPSA', budgetMs);
        const { response, bytes } = await fetchBounded(url, { signal, headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        } }, { provider: 'TIPSA', timeoutMs: Math.max(1, Math.floor(left)), maxBytes, redirect: 'manual',
          allowHttpStatuses: REDIRECTS, fetcher: this.options.fetcher });
        if (performance.now() >= deadline) throw new BudgetExceededError('TIPSA', budgetMs);
        if (REDIRECTS.includes(response.status)) throw new SchemaError('TIPSA', 'TIPSA tracking page moved');
        return decodeText(bytes, encoding);
      };
      const detail = tipsaDetailUrl(await read(`${LOOKUP}?id=${number}`, LOOKUP_MAX_BYTES, 'utf-8'));
      if (!detail) throw new NotFoundError('TIPSA');
      return parseTipsaDetail(await read(detail, DETAIL_MAX_BYTES, 'iso-8859-1'), number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new TipsaTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'tipsa', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeTipsaNumber(number))) };
};
