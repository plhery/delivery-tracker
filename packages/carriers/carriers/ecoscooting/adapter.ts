import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { normalizeEcoscootingNumber, parseEcoscooting } from './parser';

const ENDPOINT = 'https://de-link.cainiao.com/gateway/link.do';

export class EcoscootingTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}
  async fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeEcoscootingNumber(raw);
    return runSteps({ carrier: 'ecoscooting', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      try {
        // Fixed public configuration from Ecoscooting's own anonymous client,
        // not an issued account credential or a guessed merchant signature.
        const body = new URLSearchParams({ logistics_interface: JSON.stringify({ mailNo: number, locale: 'en_US', role: 'endUser' }),
          msg_type: 'CN_OVERSEA_LOGISTICS_INQUIRY_TRACKING', logistic_provider_id: 'DISTRIBUTOR_30250031', data_digest: 'suibianxie', to_code: 'CNL_EU' });
        const { bytes } = await fetchBounded(ENDPOINT, { method: 'POST', signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
          { provider: 'Ecoscooting', timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 1_000_000, fetcher: this.options.fetcher });
        let payload: unknown;
        try { payload = parseJsonBytes(bytes, 'Ecoscooting'); } catch (cause) { throw new SchemaError('Ecoscooting', 'Ecoscooting returned invalid tracking JSON', { cause }); }
        return parseEcoscooting(payload, number);
      } catch (error) {
        if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError('Ecoscooting', 'Ecoscooting tracking endpoint is unavailable', { cause: error });
        throw error;
      }
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new EcoscootingTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'ecoscooting', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
