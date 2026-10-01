import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { MrwTracker, adapter } from './adapter';
import { normalizeMrwNumber, parseMrwBootstrap, parseMrwHistory, parseMrwSummary } from './parser';
import { classifyMrwStatus } from './status';
import statuses from './statuses.json';

const NUMBER = '99000Z000001';
const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}.html`, import.meta.url)), 'utf8');
const summary = () => parseMrwSummary(fixture('summary'), NUMBER);
const environment = (fetcher: typeof fetch) => ({ fetcher, env: {}, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER });

describe('MRW anonymous tracking', () => {
  it('supports only the two complete native reference shapes', () => {
    expect(normalizeMrwNumber(' 99000z000001 ')).toBe(NUMBER);
    expect(normalizeMrwNumber('990000000001')).toBe('990000000001');
    for (const raw of ['', '99000Z00001', '99000ZZ000001', NUMBER + '?', 'X'.repeat(49)]) {
      expect(() => normalizeMrwNumber(raw)).toThrow(TypeError);
    }
  });

  it('binds both summary and full history to the requested reference and projects only actual scans', () => {
    const parsed = normalizeCarrierResult(parseMrwHistory(fixture('history'), NUMBER, summary()));
    expect(parsed).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: null,
      last_update_local: '2026-09-10T19:29:00', last_status_text: 'Envío entregado' });
    expect(parsed.events).toHaveLength(5);
    expect(parsed.events?.map(event => event.stage)).toEqual(['delivered', 'ready_for_pickup', 'failed_attempt', 'in_transit', 'registered']);
    expect(parsed.events?.[0]).toMatchObject({ local_time: '2026-09-10T19:29:00', location: '28000 Madrid' });
    expect(parsed.delivered_at).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain('PRIVATE_SYNTHETIC_ADDRESS');
    for (const entry of statuses.entries) expect(classifyMrwStatus(entry.wording)?.stage).toBe(entry.stage);
  });

  it('accepts a bound current status when the official history page is blank, without a synthetic scan', () => {
    expect(parseMrwHistory(fixture('blank-history'), NUMBER, summary())).toEqual({ status: 'delivered',
      current_stage: 'delivered', last_status_text: 'Envío entregado', last_update: null,
      expected_delivery: null, summary_only: true, events: [] });
    expect(() => parseMrwHistory(fixture('blank-history'), NUMBER, { ...summary(), status: 'ENTREGADO A PRIVATE_SYNTHETIC' }))
      .toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('keeps a query echo without a shipment table inconclusive', () => {
    expect(() => parseMrwSummary(fixture('unknown-summary'), '99999Z999999'))
      .toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('rejects changed form, wrong identity, ambiguous summaries and forged history links', () => {
    expect(() => parseMrwBootstrap(fixture('bootstrap').replace('validar-envio.asp', 'changed.asp')))
      .toThrowError(expect.objectContaining({ kind: 'schema' }));
    expect(() => parseMrwSummary(fixture('summary').replace(NUMBER, '99000Z000002'), NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'schema' }));
    expect(() => parseMrwSummary(fixture('summary').replace('envio=99000Z000001', 'envio=99000Z000002'), NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'schema' }));
    expect(() => parseMrwSummary(fixture('summary').replace('</tbody>', '<tr><td>99000Z000002</td></tr></tbody>'), NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parseMrwHistory(fixture('history').replace('Seguimiento del número de envío 99000Z000001',
      'Seguimiento del número de envío 99000Z000002'), NUMBER, summary()))
      .toThrowError(expect.objectContaining({ kind: 'schema' }));
  });

  it('does not infer delivery from an older row or recipient-like wording', () => {
    const altered = fixture('history').replace('10/09/2026</td><td>19:29</td><td>Envío entregado',
      '31/02/2026</td><td>19:29</td><td>ENTREGADO A PRIVATE_SYNTHETIC_RECIPIENT');
    const result = parseMrwHistory(altered, NUMBER, { ...summary(), date: '31/02/2026', status: 'ENTREGADO A PRIVATE_SYNTHETIC_RECIPIENT' });
    expect(result).toMatchObject({ status: 'unknown', last_update: null });
    expect(result.current_stage).toBeUndefined();
    expect(result.last_update_local).toBeNull();
    expect(result.delivered_at).toBeUndefined();
    expect(result.events?.[0].description).toBe('Actualización de seguimiento');
    expect(result.events?.[0].provider_time_text).toBe('31/02/2026 19:29');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC_RECIPIENT');
  });

  it('rejects summary/history disagreement instead of promoting a stale terminal result', () => {
    for (const changed of [{ status: 'En tránsito' }, { date: '11/09/2026' }, { hour: '19:30' }]) {
      expect(() => parseMrwHistory(fixture('history'), NUMBER, { ...summary(), ...changed }))
        .toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const empty = fixture('history').replace(/<tr class="past">[\s\S]*?<\/tr>/, '');
    expect(() => parseMrwHistory(empty, NUMBER, summary())).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('calls the exact anonymous five-step sequence with one cookie jar through the full factory', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const step = fetcher.mock.calls.length;
      expect(init?.cache).toBe('no-store'); expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (step === 1) {
        expect(String(url)).toBe('https://www.mrw.es/seguimiento/');
        return new Response(fixture('bootstrap'), { headers: [
          ['set-cookie', 'ASPSESSIONIDABCDEFGH=syntheticSession; Path=/; HttpOnly'],
          ['set-cookie', 'TS01dc4fc6=syntheticEdge; Path=/; Secure'],
        ] });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toContain('ASPSESSIONIDABCDEFGH=syntheticSession');
      expect(headers.get('cookie')).toContain('TS01dc4fc6=syntheticEdge');
      if (step === 2) {
        expect(String(url)).toBe('https://www.mrw.es/seguimiento/validar-envio.asp');
        expect(init?.method).toBe('POST');
        expect(new URLSearchParams(String(init?.body)).get('mrw-finder-follow-code')).toBe(NUMBER);
        return new Response('', { status: 302, headers: { Location: 'envio-actual.asp' } });
      }
      if (step === 3) { expect(String(url)).toBe('https://www.mrw.es/seguimiento/envio-actual.asp'); return new Response(fixture('summary')); }
      if (step === 4) { expect(String(url)).toContain(`envio=${NUMBER}`); return new Response('', { status: 302, headers: { Location: 'envio-historico.asp' } }); }
      expect(String(url)).toBe('https://www.mrw.es/seguimiento/envio-historico.asp');
      return new Response(fixture('history'));
    });
    const result = await adapter(environment(fetcher)).track({ number: NUMBER, postcode: 'PRIVATE_SYNTHETIC' });
    expect(result).toMatchObject({ status: 'delivered' });
    expect(result.events).toHaveLength(5);
    expect(fetcher).toHaveBeenCalledTimes(5);
  }, 10_000);

  it('keeps HTTP failures and official rate limits distinct from shipment absence', async () => {
    for (const [status, kind] of [[302, 'indeterminate'], [404, 'indeterminate'], [410, 'indeterminate'],
      [403, 'challenge'], [429, 'rate_limited']] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
      await expect(new MrwTracker({ fetcher, paceMs: 0 }).fetch(NUMBER)).rejects.toMatchObject({ kind });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(500_001)));
    await expect(new MrwTracker({ fetcher: oversized, paceMs: 0 }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const landing = new Response(fixture('bootstrap'), { headers: {
      'set-cookie': 'ASPSESSIONIDABCDEFGH=syntheticSession; Path=/',
    } });
    const redirectedLimit = vi.fn<typeof fetch>().mockResolvedValueOnce(landing)
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: '/error/429.asp?motivo=60' } }));
    await expect(new MrwTracker({ fetcher: redirectedLimit, paceMs: 0 }).fetch(NUMBER))
      .rejects.toMatchObject({ kind: 'rate_limited' });
    expect(redirectedLimit).toHaveBeenCalledTimes(2);
    const external = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(fixture('bootstrap'), { headers: {
      'set-cookie': 'ASPSESSIONIDABCDEFGH=syntheticSession; Path=/',
    } })).mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: 'https://example.invalid/parcel' } }));
    await expect(new MrwTracker({ fetcher: external, paceMs: 0 }).fetch(NUMBER))
      .rejects.toMatchObject({ kind: 'indeterminate' });
    expect(external).toHaveBeenCalledTimes(2);
  });

  it('bounds the whole session, including pacing, and honors caller cancellation', async () => {
    const immediate = vi.fn<typeof fetch>().mockResolvedValue(new Response(fixture('bootstrap')));
    await expect(new MrwTracker({ fetcher: immediate }).fetch(NUMBER, { budgetMs: 0 }))
      .rejects.toMatchObject({ kind: 'budget' });
    expect(immediate).not.toHaveBeenCalled();
    const first = vi.fn<typeof fetch>().mockResolvedValue(new Response(fixture('bootstrap'), { headers: {
      'set-cookie': 'ASPSESSIONIDABCDEFGH=syntheticSession; Path=/',
    } }));
    await expect(new MrwTracker({ fetcher: first }).fetch(NUMBER, { budgetMs: 20.5 }))
      .rejects.toMatchObject({ kind: 'budget' });
    expect(first).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    let signalStarted!: () => void;
    const started = new Promise<void>(resolve => { signalStarted = resolve; });
    const waiting = vi.fn<typeof fetch>(async (_url, init) => {
      signalStarted();
      await new Promise((_resolve, reject) => {
        init?.signal?.throwIfAborted();
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
      return new Response(fixture('bootstrap'));
    });
    const active = new MrwTracker({ fetcher: waiting }).fetch(NUMBER, { signal: controller.signal });
    await started;
    controller.abort();
    await expect(active).rejects.toMatchObject({ kind: 'transport' });
    expect(waiting).toHaveBeenCalledTimes(1);
  });
});
