import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { BudgetExceededError, ChallengeError, IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { normalizeCorreosChileNumber, parseCorreosChileBootstrap, parseCorreosChileTracking } from './parser';

const PAGE = 'https://www.correos.cl/seguimiento-en-linea';
const ORIGIN = 'https://www.correos.cl';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const BOOTSTRAP_MAX_BYTES = 500_000;
// The anonymous resource includes the full public branch list alongside the
// requested shipment, even though only the shipment detail is projected.
const TRACKING_MAX_BYTES = 6_000_000;

function anonymousSession(response: Response): string {
  const cookies = new Map<string, string>();
  for (const header of response.headers.getSetCookie()) {
    const part = header.split(';', 1)[0] ?? '';
    const match = /^(JSESSIONID|SERVER_ID)=([A-Za-z0-9._~!$%&'*+\-^`|:=@]{1,512})$/.exec(part);
    if (match) cookies.set(match[1]!, part);
  }
  if (!cookies.has('JSESSIONID') || !cookies.has('SERVER_ID')) {
    throw new IndeterminateError('Correos de Chile', 'Anonymous tracking session is missing');
  }
  return `${cookies.get('JSESSIONID')}; ${cookies.get('SERVER_ID')}`;
}

export class CorreosChileTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeCorreosChileNumber(raw);
    const budgetMs = context.budgetMs ?? 15_000;
    return runSteps({ carrier: 'correos-chile', budgetMs, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      const deadline = performance.now() + remainingMs;
      const read = async (url: string, init: RequestInit, maxBytes: number) => {
        signal.throwIfAborted();
        const left = deadline - performance.now();
        if (left <= 0) throw new BudgetExceededError('Correos de Chile', budgetMs);
        const result = await fetchBounded(url, { ...init, signal }, {
          provider: 'Correos de Chile', timeoutMs: Math.max(1, Math.floor(left)), maxBytes,
          redirect: 'manual', allowHttpStatuses: [302, 404, 410], fetcher: this.options.fetcher,
        });
        if (performance.now() >= deadline) throw new BudgetExceededError('Correos de Chile', budgetMs);
        signal.throwIfAborted();
        if (result.response.status !== 200) {
          throw new IndeterminateError('Correos de Chile', 'Anonymous tracking resource is unavailable');
        }
        return result;
      };
      const bootstrap = await read(PAGE, { headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
      } }, BOOTSTRAP_MAX_BYTES);
      const html = decodeText(bootstrap.bytes);
      const session = parseCorreosChileBootstrap(html);
      const cookie = anonymousSession(bootstrap.response);
      const body = new URLSearchParams({ [session.numberField]: number, p_auth: session.csrf });
      const tracking = await read(session.url, { method: 'POST', body, headers: {
        'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest', Origin: ORIGIN, Referer: PAGE, Cookie: cookie,
      } }, TRACKING_MAX_BYTES);
      const text = decodeText(tracking.bytes);
      if (/Radware (?:Captcha )?Page|Please solve this CAPTCHA/i.test(text)) {
        throw new ChallengeError('Correos de Chile', 'Tracking resource returned a browser challenge');
      }
      let payload: unknown;
      try { payload = JSON.parse(text); }
      catch { throw new SchemaError('Correos de Chile', 'Tracking resource returned invalid JSON'); }
      return parseCorreosChileTracking(payload, number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new CorreosChileTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'correos-chile', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
