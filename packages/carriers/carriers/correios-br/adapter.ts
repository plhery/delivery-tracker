import 'server-only';
import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { BudgetExceededError, ChallengeError, IndeterminateError, SchemaError } from '../../core/errors';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { CorreiosOcr } from './ocr';
import { isCorreiosCaptchaError, normalizeCorreiosNumber, parseCorreios } from './parser';

const ORIGIN = 'https://rastreamento.correios.com.br';
const HOME = `${ORIGIN}/app/index.php`;
const IMAGE = `${ORIGIN}/core/securimage/securimage_show.php`;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
type Solver = (bytes: Uint8Array, signal: AbortSignal) => Promise<string>;

export class CorreiosTracker {
  private readonly ocr = new CorreiosOcr();
  constructor(private readonly options: { fetcher?: typeof fetch; recorder?: StepRecorder; solveCaptcha?: Solver } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}) {
    const number = normalizeCorreiosNumber(raw);
    const budgetMs = context.budgetMs ?? 20_000;
    return runSteps({ carrier: 'correios-br', budgetMs, signal: context.signal,
      recorder: this.options.recorder ?? NOOP_RECORDER }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      const deadline = performance.now() + remainingMs;
      const check = () => {
        signal.throwIfAborted();
        const left = deadline - performance.now();
        if (left <= 0) throw new BudgetExceededError('Correios', budgetMs);
        return Math.max(1, Math.floor(left));
      };
      const fetcher = makeFetchCookie(this.options.fetcher ?? fetch, new CookieJar());
      const request = async (url: string | URL, maxBytes: number) => {
        const result = await fetchBounded(url, { signal, headers: { 'User-Agent': USER_AGENT, Referer: HOME } }, {
          provider: 'Correios', timeoutMs: check(), maxBytes, fetcher, allowHttpStatuses: [404, 410],
        });
        check();
        if (result.response.status !== 200) throw new IndeterminateError('Correios', 'Correios tracking endpoint is unavailable');
        return result;
      };
      // A fresh jar binds this parcel's CAPTCHA to this lookup, never another user.
      await request(HOME, 100_000);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const image = await request(IMAGE, 100_000);
        if (!image.response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) {
          throw new ChallengeError('Correios', 'Correios returned no text CAPTCHA image');
        }
        const answer = await (this.options.solveCaptcha ?? this.ocr.solve.bind(this.ocr))(image.bytes, signal);
        check();
        if (!/^[a-z0-9]{4,6}$/.test(answer)) {
          if (attempt === 0) continue;
          throw new ChallengeError('Correios', 'Correios text CAPTCHA could not be read');
        }
        const url = new URL(`${ORIGIN}/app/resultado.php`);
        url.search = new URLSearchParams({ objeto: number, captcha: answer, mqs: 'S' }).toString();
        const { bytes } = await request(url, 1_000_000);
        let payload: unknown;
        try { payload = parseJsonBytes(bytes, 'Correios'); }
        catch (cause) { throw new SchemaError('Correios', 'Correios returned invalid tracking JSON', { cause }); }
        if (isCorreiosCaptchaError(payload) && attempt === 0) continue;
        return parseCorreios(payload, number);
      }
      throw new ChallengeError('Correios', 'Correios rejected the text CAPTCHA');
    } }]);
  }

  close() { return this.ocr.close(); }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new CorreiosTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return { id: 'correios-br', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
