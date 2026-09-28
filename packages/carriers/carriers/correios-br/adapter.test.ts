import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/delivered.json';
import statuses from './statuses.json';
import { carrierErrorKind } from '../../core/errors';
import { normalizeCarrierResult } from '../../core/result';
import { CorreiosTracker } from './adapter';
import { isCorreiosCaptchaError, normalizeCorreiosNumber, parseCorreios } from './parser';
import { classifyCorreiosStatus } from './status';

const NUMBER = 'AA000000005BR';
const HOME = 'https://rastreamento.correios.com.br/app/index.php';
const IMAGE = 'https://rastreamento.correios.com.br/core/securimage/securimage_show.php';
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const image = () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
const clone = () => structuredClone(fixture);
const scan = (code: string, kind: string, description: string, clock: unknown) => ({ codigo: code, tipo: kind, descricao: description, dtHrCriado: clock });

function portal(payload: unknown = fixture) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetcher = vi.fn(async (raw: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(raw));
    calls.push({ url, init });
    if (url.href === HOME) {
      const response = new Response('<html>Tracking portal</html>', { headers: { 'Set-Cookie': 'PHPSESSID=synthetic-session; Path=/; Secure; HttpOnly' } });
      Object.defineProperty(response, 'url', { value: HOME });
      return response;
    }
    if (url.href === IMAGE) return image();
    return json(payload);
  }) as unknown as typeof fetch;
  const solveCaptcha = vi.fn(async () => 'a1b2');
  return { tracker: new CorreiosTracker({ fetcher, solveCaptcha }), calls, fetcher, solveCaptcha };
}

describe('Correios parser', () => {
  it('projects explicit zoned history and composite scan meanings without private fields', () => {
    const result = normalizeCarrierResult(parseCorreios(fixture, NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: '2026-01-05T16:10:47-03:00', delivered_at: '2026-01-05T16:10:47-03:00', expected_delivery: null });
    expect(result.events).toHaveLength(7);
    expect(result.events?.[0]).toEqual({ description: 'Objeto entregue ao destinatário', provider_code: 'BDE/01', time: '2026-01-05T16:10:47-03:00', location: 'Cidade Exemplo, SP', stage: 'delivered' });
    expect(result.events?.[2].stage).toBe('exception');
    expect(result.events?.[3].stage).toBe('exception');
    expect(result.events?.[5].stage).toBe('accepted');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
    for (const row of statuses.entries) expect(classifyCorreiosStatus(row.code)?.stage).toBe(row.stage);
    expect(classifyCorreiosStatus('BDE/99')).toBeUndefined();
  });

  it('requires one exact response identity and structurally complete bounded scans', () => {
    expect(normalizeCorreiosNumber('aa 000000005 br')).toBe(NUMBER);
    for (const raw of ['AA000000000BR', '123', '', 'AA000000005BR?']) expect(() => normalizeCorreiosNumber(raw)).toThrow(TypeError);
    for (const payload of [null, [], {}, { ...fixture, codObjeto: 'BB000000005BR' }, { ...fixture, eventos: null }, { ...fixture, eventos: [null] },
      { ...fixture, eventos: [scan('BDE', '', 'Incomplete', null)] }, { ...fixture, eventos: [scan('BDE', '01', '', null)] },
      { ...fixture, eventos: Array(501).fill(fixture.eventos[0]) }]) expect(() => parseCorreios(payload, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    expect(() => parseCorreios({ ...fixture, eventos: [] }, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('keeps newest unknown, malformed and missing clocks before older delivery scans', () => {
    for (const clock of [null, { date: 'Not supplied' }, { date: '2026-02-30 15:00:00.000000', timezone_type: 3, timezone: 'America/Sao_Paulo' }]) {
      const result = parseCorreios({ ...fixture, eventos: [scan('BDE', '99', 'New unmapped scan', clock), ...fixture.eventos] }, NUMBER);
      expect(result).toMatchObject({ status: 'unknown', last_status_text: 'New unmapped scan', last_update: null });
      expect(result.current_stage).toBeUndefined();
      expect(result.delivered_at).toBeUndefined();
      expect(result.events?.[0].provider_code).toBe('BDE/99');
      expect(result.events?.[0].time).toBeUndefined();
      if (clock?.date) expect(result.events?.[0].provider_time_text).toBe(clock.date);
    }
  });

  it('trusts per-row zones but keeps missing, invalid, repeated and nonexistent clocks local', () => {
    const clock = { date: '2026-01-05 16:10:47.000000', timezone_type: 3, timezone: 'America/Manaus' };
    expect(parseCorreios({ ...fixture, eventos: [scan('BDE', '01', 'Delivery', clock)] }, NUMBER).last_update).toBe('2026-01-05T16:10:47-04:00');
    for (const raw of [clock.date, { date: clock.date }, { ...clock, timezone_type: 1 }, { ...clock, timezone: 'Invalid/Zone' },
      { date: '2026-11-01 01:30:00.000000', timezone_type: 3, timezone: 'America/New_York' },
      { date: '2026-03-08 02:30:00.000000', timezone_type: 3, timezone: 'America/New_York' }]) {
      const result = parseCorreios({ ...fixture, eventos: [scan('BDE', '01', 'Delivery', raw)] }, NUMBER);
      expect(result.last_update).toBeNull();
      expect(result.delivered_at).toBeUndefined();
      expect(result.events?.[0].local_time).toMatch(/^2026-/);
      expect(result.events?.[0].time).toBeUndefined();
    }
  });

  it('deduplicates projected scans and bounds text without promoting delivery-related failures', () => {
    const duplicate = clone();
    duplicate.eventos.push(structuredClone(duplicate.eventos[0]));
    expect(parseCorreios(duplicate, NUMBER).events).toHaveLength(7);
    for (const kind of ['34', '47']) {
      const result = parseCorreios({ ...fixture, eventos: [scan('BDE', kind, 'x'.repeat(600), 'x'.repeat(100)), ...fixture.eventos] }, NUMBER);
      expect(result.status).toBe('exception');
      expect(result.delivered_at).toBeUndefined();
      expect(result.events?.[0].description).toHaveLength(500);
      expect(result.events?.[0].provider_time_text).toHaveLength(64);
    }
  });

  it('never assigns an older delivery instant to a newer delivery with an unresolved clock', () => {
    const newest = scan('BDE', '01', 'Objeto entregue ao destinatário', { date: '2026-01-06 16:10:00.000000', timezone_type: 3, timezone: 'Invalid/Zone' });
    const result = parseCorreios({ ...fixture, eventos: [newest, ...fixture.eventos] }, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', last_update: null, last_update_local: '2026-01-06T16:10:00' });
    expect(result.delivered_at).toBeUndefined();
  });

  it('distinguishes explicit CAPTCHA rejection from unbound and period errors', () => {
    for (const erro of [true, 'true']) {
      const rejected = { erro, mensagem: 'Captcha inválido' };
      expect(isCorreiosCaptchaError(rejected)).toBe(true);
      expect(() => parseCorreios(rejected, NUMBER)).toThrowError(expect.objectContaining({ kind: 'challenge' }));
      for (const mensagem of ['Período inválido', 'Objeto não encontrado', 'Serviço indisponível']) {
        expect(() => parseCorreios({ erro, mensagem }, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
      }
    }
    expect(isCorreiosCaptchaError({ mensagem: 'Captcha inválido' })).toBe(false);
    expect(isCorreiosCaptchaError({ erro: true, mensagem: 'captcha service unavailable' })).toBe(false);
  });
});

describe('Correios session and transport', () => {
  it('bootstraps cookies, submits one bounded query and keeps separate lookup sessions', async () => {
    const { tracker, calls, solveCaptcha } = portal();
    await tracker.fetch(NUMBER);
    expect(calls).toHaveLength(3);
    expect(calls[0].url.href).toBe(HOME);
    expect(calls[1].url.href).toBe(IMAGE);
    expect(calls[2].url.pathname).toBe('/app/resultado.php');
    expect(Object.fromEntries(calls[2].url.searchParams)).toEqual({ objeto: NUMBER, captcha: 'a1b2', mqs: 'S' });
    expect(solveCaptcha).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), expect.any(AbortSignal));
    expect(new Headers(calls[1].init?.headers).get('cookie')).toBe('PHPSESSID=synthetic-session');
    expect(new Headers(calls[2].init?.headers).get('referer')).toBe(HOME);
    // fetch-cookie uses manual fetches and honors the original redirect:error policy.
    expect(calls.every((call) => call.init?.cache === 'no-store' && call.init?.redirect === 'manual' && call.init?.signal instanceof AbortSignal)).toBe(true);
    await tracker.fetch(NUMBER);
    expect(new Headers(calls[3].init?.headers).get('cookie')).toBeNull();
    expect(calls).toHaveLength(6);
  });

  it('retries only one fresh image after an explicit rejection, not arbitrary errors or schema mismatch', async () => {
    const { tracker, fetcher, calls } = portal();
    vi.mocked(fetcher).mockImplementationOnce(async () => new Response('portal'))
      .mockImplementationOnce(async () => image())
      .mockImplementationOnce(async () => json({ erro: 'true', mensagem: 'Captcha inválido' }));
    expect((await tracker.fetch(NUMBER)).status).toBe('delivered');
    expect(calls.map((call) => call.url.pathname)).toEqual(['/core/securimage/securimage_show.php', '/app/resultado.php']);
    expect(fetcher).toHaveBeenCalledTimes(5);
    for (const payload of [{ erro: true, mensagem: 'Período inválido' }, { ...fixture, codObjeto: 'BB000000005BR' }]) {
      const probe = portal(payload);
      await expect(probe.tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: payload.erro ? 'indeterminate' : 'schema' });
      expect(probe.calls).toHaveLength(3);
    }
    const exhausted = portal({ erro: true, mensagem: 'Captcha inválido' });
    await expect(exhausted.tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'challenge' });
    expect(exhausted.calls).toHaveLength(5);
  });

  it('bounds unreadable OCR retries, image bytes, content type and invalid JSON', async () => {
    const unreadable = portal();
    unreadable.solveCaptcha.mockResolvedValue('ABC?');
    await expect(unreadable.tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'challenge' });
    expect(unreadable.calls).toHaveLength(3);
    expect(unreadable.calls.some((call) => call.url.pathname === '/app/resultado.php')).toBe(false);
    for (const reply of [new Response('html', { headers: { 'Content-Type': 'text/html' } }),
      new Response(new Uint8Array(100_001), { headers: { 'Content-Type': 'image/png' } })]) {
      const p = portal();
      vi.mocked(p.fetcher).mockImplementationOnce(async () => new Response('portal')).mockImplementationOnce(async () => reply);
      await expect(p.tracker.fetch(NUMBER)).rejects.toBeInstanceOf(Error);
      expect(p.solveCaptcha).not.toHaveBeenCalled();
      expect(p.fetcher).toHaveBeenCalledTimes(2);
    }
    const p = portal();
    vi.mocked(p.fetcher).mockImplementationOnce(async () => new Response('portal')).mockImplementationOnce(async () => image()).mockImplementationOnce(async () => new Response('<html>changed</html>'));
    await expect(p.tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
    expect(p.fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps endpoint absence inconclusive and preserves challenge, throttle and network errors', async () => {
    for (const [status, kind] of [[404, 'indeterminate'], [410, 'indeterminate'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']] as const) {
      const fetcher = vi.fn(async () => new Response('unavailable', { status })) as unknown as typeof fetch;
      await expect(new CorreiosTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const fetcher = vi.fn(async () => { throw new Error('Network failure'); }) as unknown as typeof fetch;
    await expect(new CorreiosTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'transport' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves cancellation before requests, through HTTP and during OCR without a later query', async () => {
    const pre = portal();
    await expect(pre.tracker.fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(Error);
    expect(pre.fetcher).not.toHaveBeenCalled();
    await expect(pre.tracker.fetch(NUMBER, { budgetMs: 0 })).rejects.toMatchObject({ kind: 'budget' });
    expect(pre.fetcher).not.toHaveBeenCalled();
    const controller = new AbortController();
    const fetcher = vi.fn(async (_url, init) => {
      init?.signal?.throwIfAborted();
      await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
      return new Response('unused');
    }) as unknown as typeof fetch;
    const interrupted = new CorreiosTracker({ fetcher }).fetch(NUMBER, { signal: controller.signal });
    controller.abort();
    await expect(interrupted).rejects.toMatchObject({ kind: 'transport' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const p = portal();
    const solver = vi.fn(async (_bytes: Uint8Array, signal: AbortSignal): Promise<string> => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const result = new CorreiosTracker({ fetcher: p.fetcher, solveCaptcha: solver }).fetch(NUMBER, { budgetMs: 25 });
    await expect(result).rejects.toBeInstanceOf(Error);
    expect(solver).toHaveBeenCalledTimes(1);
    expect(p.calls).toHaveLength(2);
    expect(p.calls.some((call) => call.url.pathname === '/app/resultado.php')).toBe(false);
  });
});

it('exposes stable diagnostic kinds without treating bad clocks as negatives', () => {
  try { parseCorreios({ erro: true, mensagem: 'Período inválido' }, NUMBER); }
  catch (error) { expect(carrierErrorKind(error)).toBe('indeterminate'); }
});
