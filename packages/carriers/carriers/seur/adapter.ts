import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { BudgetExceededError, IndeterminateError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeSeurNumber, parseSeur } from './parser';

export class SeurTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeSeurNumber(raw);
    return runSteps({ carrier: 'seur', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      const deadline = performance.now() + remainingMs;
      const body = { telefono: null, email: null, identificador_busqueda: number, idioma: 'es', cod_postal: '',
        tipo_actor: 'DST', cipher: false, origen_mkt: false };
      const { response, bytes } = await fetchBounded('https://www.seur.com/miseur/backend/consultarEnvioLTSimple',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal },
        { provider: 'SEUR', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000,
          redirect: 'manual', allowHttpStatuses: [302, 404, 410], fetcher: this.options.fetcher });
      if (performance.now() >= deadline) throw new BudgetExceededError('SEUR', context.budgetMs ?? 15_000);
      signal.throwIfAborted();
      if (response.status !== 200) throw new IndeterminateError('SEUR', 'SEUR tracking endpoint is unavailable');
      return parseSeur(parseJsonBytes(bytes, 'SEUR'), number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new SeurTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'seur', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeSeurNumber(number))) };
};
