import 'server-only';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { BudgetExceededError, IndeterminateError, SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { decodeText, fetchBounded } from '../../core/transport';
import { normalizeNacexNumber, parseNacex, validateNacexBootstrap } from './parser';

const ORIGIN = 'https://www.nacex.es';
const DETAIL_KEYS = new Set(['agencia_origen', 'numero_albaran', 'estado', 'internacional', 'externo', 'usr', 'pas']);

function sessionCookie(response: Response, previous?: string): string {
  let cookie = previous;
  for (const header of response.headers.getSetCookie()) {
    if (!header.startsWith('JSESSIONID=')) continue;
    const match = /^JSESSIONID=("[A-Za-z0-9._:-]{1,256}"|[A-Za-z0-9._:-]{1,256})(?:;|$)/.exec(header);
    if (!match) throw new SchemaError('NACEX', 'NACEX returned an invalid anonymous session');
    cookie = `JSESSIONID=${match[1]}`;
  }
  if (!cookie) throw new IndeterminateError('NACEX', 'NACEX did not establish an anonymous session');
  return cookie;
}

function htmlText(response: Response, bytes: Uint8Array): string {
  const charset = /charset\s*=\s*["']?([A-Za-z0-9_-]+)/i.exec(response.headers.get('content-type') ?? '')?.[1].toLowerCase();
  if (charset && !['utf-8', 'utf8', 'iso-8859-1', 'windows-1252'].includes(charset)) throw new SchemaError('NACEX', 'NACEX response encoding changed');
  return decodeText(bytes, charset?.startsWith('utf') ? 'utf-8' : 'windows-1252');
}

function detailUrl(location: string | null, number: string): URL {
  if (!location || location.length > 2_000) throw new SchemaError('NACEX', 'NACEX returned an incomplete redirect');
  let url: URL;
  try { url = new URL(location, ORIGIN); } catch { throw new SchemaError('NACEX', 'NACEX returned an invalid redirect'); }
  const [agency, albaran] = number.split('/');
  if (url.origin !== ORIGIN || url.username || url.password || url.hash || url.pathname !== '/seguimientoDetalle.do'
    || [...url.searchParams.keys()].some(key => !DETAIL_KEYS.has(key) || url.searchParams.getAll(key).length !== 1)
    || url.searchParams.get('agencia_origen') !== agency || url.searchParams.get('numero_albaran') !== albaran
    || !/^\d{1,2}$/.test(url.searchParams.get('estado') ?? '') || url.searchParams.get('internacional') !== '0'
    || url.searchParams.get('externo') !== 'N' || url.searchParams.get('usr') !== 'null' || url.searchParams.get('pas') !== 'null') {
    throw new SchemaError('NACEX', 'NACEX returned a different or unsupported shipment redirect');
  }
  return url;
}

export class NacexTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {}

  fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeNacexNumber(raw);
    const [agency, albaran] = number.split('/');
    return runSteps({ carrier: 'nacex', budgetMs: context.budgetMs ?? 15_000, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      signal.throwIfAborted();
      const deadline = performance.now() + remainingMs;
      const read = async (url: string | URL, init: RequestInit = {}) => {
        const left = deadline - performance.now();
        if (left <= 0) throw new BudgetExceededError('NACEX', context.budgetMs ?? 15_000);
        signal.throwIfAborted();
        const result = await fetchBounded(url, { ...init, signal }, {
          provider: 'NACEX', timeoutMs: Math.max(1, Math.floor(left)), maxBytes: 1_000_000,
          redirect: 'manual', allowHttpStatuses: [302, 404, 410], fetcher: this.options.fetcher,
        });
        if (performance.now() >= deadline) throw new BudgetExceededError('NACEX', context.budgetMs ?? 15_000);
        signal.throwIfAborted();
        return result;
      };
      const bootstrap = await read(`${ORIGIN}/irSeguimiento.do`);
      if (bootstrap.response.status !== 200) throw new IndeterminateError('NACEX', 'NACEX tracking form is unavailable');
      validateNacexBootstrap(htmlText(bootstrap.response, bootstrap.bytes));
      let cookie = sessionCookie(bootstrap.response);
      const submitted = await read(`${ORIGIN}/seguimientoFormulario.do`, { method: 'POST', headers: { Cookie: cookie },
        body: new URLSearchParams({ agencia_origen: agency!, numero_albaran: albaran! }) });
      if (submitted.response.status === 200) return parseNacex(htmlText(submitted.response, submitted.bytes), number);
      if (submitted.response.status !== 302) throw new IndeterminateError('NACEX', 'NACEX tracking submission is unavailable');
      const url = detailUrl(submitted.response.headers.get('location'), number);
      cookie = sessionCookie(submitted.response, cookie);
      const detail = await read(url, { headers: { Cookie: cookie } });
      if (detail.response.status !== 200) throw new IndeterminateError('NACEX', 'NACEX shipment detail is unavailable');
      return parseNacex(htmlText(detail.response, detail.bytes), number);
    } }]);
  }
}

export const adapter: AdapterFactory = environment => {
  const tracker = new NacexTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'nacex', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeNacexNumber(number))) };
};
