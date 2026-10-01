import 'server-only';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { BudgetExceededError, IndeterminateError, RateLimitedError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { normalizeMrwNumber, parseMrwBootstrap, parseMrwHistory, parseMrwSummary } from './parser';

const ORIGIN = 'https://www.mrw.es';
const LANDING = `${ORIGIN}/seguimiento/`;
const POST = `${ORIGIN}/seguimiento/validar-envio.asp`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const PACE_MS = 1_200;
const MAX_BYTES = 500_000;

function addSessionCookies(response: Response, jar: Map<string, string>): void {
  for (const header of response.headers.getSetCookie()) {
    const part = header.split(';', 1)[0] ?? '';
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    const name = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (/^(?:ASPSESSIONID[A-Z0-9]{8}|TS[0-9a-f]{6,32})$/.test(name) && /^[^\s;]{1,256}$/.test(value)) jar.set(name, value);
  }
}

function nextLocation(response: Response, sourceUrl: string, expected: string): string {
  if (response.status !== 302) throw new IndeterminateError('MRW', 'MRW did not continue the tracking session');
  let next: URL;
  try { next = new URL(response.headers.get('location') ?? '', sourceUrl); }
  catch { throw new SchemaError('MRW', 'MRW tracking redirect is invalid'); }
  if (next.origin === ORIGIN && next.pathname === '/error/429.asp') throw new RateLimitedError('MRW');
  if (next.origin !== ORIGIN || next.pathname !== expected || next.search || next.hash || next.username || next.password) {
    throw new IndeterminateError('MRW', 'MRW tracking session changed route');
  }
  return next.toString();
}

export class MrwTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder; paceMs?: number } = {}) {}

  fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeMrwNumber(raw);
    const budgetMs = context.budgetMs ?? 18_000;
    return runSteps({ carrier: 'mrw', budgetMs, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      const deadline = performance.now() + remainingMs;
      const jar = new Map<string, string>();
      let requests = 0;
      const ensureTime = () => {
        if (performance.now() >= deadline) throw new BudgetExceededError('MRW', budgetMs);
        signal.throwIfAborted();
      };
      const pace = async () => {
        if (!requests) return;
        ensureTime();
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            reject(signal.reason);
          };
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
          }, this.options.paceMs ?? PACE_MS);
          signal.addEventListener('abort', abort, { once: true });
        }).catch(error => {
          if (performance.now() >= deadline) throw new BudgetExceededError('MRW', budgetMs, { cause: error });
          throw error;
        });
        ensureTime();
      };
      const read = async (url: string, init: RequestInit = {}) => {
        await pace();
        ensureTime();
        const left = deadline - performance.now();
        const cookies = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
        const headers = new Headers(init.headers);
        headers.set('User-Agent', USER_AGENT);
        headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
        headers.set('Accept-Language', 'es-ES,es;q=0.9');
        if (cookies) headers.set('Cookie', cookies);
        const result = await fetchBounded(url, { ...init, headers, signal }, {
          provider: 'MRW', timeoutMs: Math.max(1, Math.floor(left)), maxBytes: MAX_BYTES,
          redirect: 'manual', allowHttpStatuses: [302, 404, 410], fetcher: this.options.fetcher,
        });
        requests += 1;
        ensureTime();
        addSessionCookies(result.response, jar);
        if (result.response.status === 404 || result.response.status === 410) {
          throw new IndeterminateError('MRW', 'MRW tracking page is unavailable');
        }
        return { response: result.response, html: decodeText(result.bytes) };
      };

      const landing = await read(LANDING);
      if (landing.response.status !== 200) throw new IndeterminateError('MRW', 'MRW tracking form is unavailable');
      parseMrwBootstrap(landing.html);
      if (![...jar.keys()].some(name => name.startsWith('ASPSESSIONID'))) {
        throw new IndeterminateError('MRW', 'MRW did not establish an anonymous session');
      }
      const submitted = await read(POST, { method: 'POST', headers: {
        'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN, Referer: LANDING,
      }, body: new URLSearchParams({ 'mrw-finder-follow-code': number, enviar_numenvio_bt: 'Enviar' }) });
      const summaryUrl = nextLocation(submitted.response, POST, '/seguimiento/envio-actual.asp');
      const summaryPage = await read(summaryUrl, { headers: { Referer: POST } });
      if (summaryPage.response.status !== 200) throw new IndeterminateError('MRW', 'MRW did not return a shipment summary');
      const summary = parseMrwSummary(summaryPage.html, number);
      const historyJump = await read(summary.historyUrl, { headers: { Referer: summaryUrl } });
      const historyUrl = nextLocation(historyJump.response, summary.historyUrl, '/seguimiento/envio-historico.asp');
      const historyPage = await read(historyUrl, { headers: { Referer: summaryUrl } });
      if (historyPage.response.status !== 200) throw new IndeterminateError('MRW', 'MRW did not return shipment history');
      return parseMrwHistory(historyPage.html, number, summary);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new MrwTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'mrw', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
