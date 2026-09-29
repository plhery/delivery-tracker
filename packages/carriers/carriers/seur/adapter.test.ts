import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { SeurTracker, adapter } from './adapter';
import { normalizeSeurNumber, parseSeur } from './parser';
import { classifySeurStatus } from './status';
import fixture from './fixtures/history.json';
import statuses from './statuses.json';

const NUMBER = '9900002';
const copy = () => structuredClone(fixture);
const response = (body: unknown = fixture) => Response.json(body);
const environment = (fetcher: typeof fetch) => ({ fetcher, env: {}, trawl: null, browserExecutablePath: null, recorder: { step() {}, lookup() {} } });
const noHistory = { codigo_error: 'ERR_CNSPLI_002', identificador_busqueda: null, clave_envio: null, situaciones: null };

describe('SEUR simplified anonymous tracking', () => {
  it('projects observed scan semantics, supplied instants and explicitly labelled kilogram weight', () => {
    const result = normalizeCarrierResult(parseSeur(fixture, NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_status_text: 'Delivered',
      last_update: '2026-01-23T13:13:05Z', delivered_at: '2026-01-23T13:13:05Z', weight_kg: 1.2 });
    expect(result.events).toHaveLength(6);
    expect(result.events?.map(e => e.stage)).toEqual(['delivered', 'out_for_delivery', 'exception', 'in_transit', 'accepted', 'registered']);
    expect(result.events?.[0]).toMatchObject({ provider_code: 'LL020', provider_status: 'EL ENVÍO HA SIDO ENTREGADO A UN VECINO.', time: '2026-01-23T13:13:05Z' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
    expect(result.events?.every(e => !e.location)).toBe(true);
    for (const entry of statuses.entries) {
      const scan = fixture.situaciones.find(row => row.cod_situacion === entry.code)!;
      expect(classifySeurStatus(entry.code, scan.grupo_situacion, entry.wording)?.stage).toBe(entry.stage);
    }
  });

  it('requires exact identity, nonempty single-piece history and the supported numeric shapes', () => {
    for (const n of ['9900002', '99000000000002', '990000000000000000002']) expect(normalizeSeurNumber(n)).toBe(n);
    expect(normalizeSeurNumber('990 0002')).toBe(NUMBER);
    for (const n of ['', '123', '99000002', 'AA9900002', NUMBER + '?', NUMBER + '/']) expect(() => normalizeSeurNumber(n)).toThrow(TypeError);
    for (const bad of [{ ...fixture, identificador_busqueda: '9900003' }, { ...fixture, identificador_busqueda: fixture.clave_envio },
      { ...fixture, clave_envio: '' }, { ...fixture, clave_envio: null }, { ...fixture, situaciones: {} }, {}, null, [fixture]]) {
      expect(() => parseSeur(bad, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    for (const pieces of [undefined, null, 0, 2, '1']) expect(() => parseSeur({ ...fixture, num_bultos: pieces }, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    for (const pieces of [{}, [null], [{ peso: 1 }, { peso: 2 }]]) expect(() => parseSeur({ ...fixture, bultos: pieces }, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    for (const pieces of [null, [], [{ peso: 1.2 }]]) expect(parseSeur({ ...fixture, bultos: pieces }, NUMBER).status).toBe('delivered');
    expect(() => parseSeur({ ...fixture, situaciones: [] }, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('keeps absent, recent and out-of-range lookup errors inconclusive', () => {
    for (const body of [noHistory, { ...noHistory, codigo_error: 'NEW_ERROR' }, { ...fixture, codigo_error: 'ERR_CNSPLI_002' }, { ...noHistory, codigo_error: '' }]) {
      expect(() => parseSeur(body, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
      expect(() => parseSeur(body, NUMBER)).not.toThrowError(expect.objectContaining({ kind: 'not_found' }));
    }
  });

  it('does not infer completed delivery from planned wording, changed groups or arbitrary codes', () => {
    for (const change of [{ cod_situacion: 'ZZ999' }, { descripcion_situacion: 'EL ENVÍO SERÁ ENTREGADO MAÑANA.' },
      { grupo_situacion: 'ENTREGA PREVISTA' }, { descripcion_situacion: 'EL ENVÍO NO HA SIDO ENTREGADO.' }]) {
      const body = copy(); Object.assign(body.situaciones[0], change);
      expect(parseSeur(body, NUMBER)).toMatchObject({ status: 'unknown' });
      expect(parseSeur(body, NUMBER).current_stage).toBeUndefined();
      expect(parseSeur(body, NUMBER).delivered_at).toBeUndefined();
    }
    for (const code of ['constructor', 'toString', 'ZZ999']) expect(classifySeurStatus(code, 'ENTREGADO', fixture.situaciones[0].descripcion_situacion)).toBeUndefined();
  });

  it('retains the newest unresolved clock and never borrows older delivery or freshness', () => {
    for (const date of ['', '2026-01-23', '2026-02-30T13:00:00Z', '2026-01-23T25:00:00Z', '2026-01-23T13:00:00+24:00', '2026-01-23T13:00:00+01:60', 'future morning']) {
      const body = copy(); body.situaciones[0].fecha = date; body.situaciones[1] = { ...body.situaciones[0], fecha: '2026-01-22T13:00:00Z' };
      const result = parseSeur(body, NUMBER);
      expect(result.status).toBe('delivered'); expect(result.last_update).toBeNull(); expect(result.delivered_at).toBeUndefined();
      expect(result.events?.[0].time).toBeUndefined(); expect(result.events?.[0].provider_time_text).toBe(date || undefined);
      expect(result.events?.[1].time).toBe('2026-01-22T13:00:00Z');
    }
    const naive = copy(); naive.situaciones[0].fecha = '2026-01-23T13:13:05';
    expect(parseSeur(naive, NUMBER)).toMatchObject({ last_update: null, last_update_local: '2026-01-23T13:13:05' });
    expect(parseSeur(naive, NUMBER).delivered_at).toBeUndefined();
    const offset = copy(); offset.situaciones[0].fecha = '2026-01-23T13:13:05+01:00';
    expect(parseSeur(offset, NUMBER).last_update).toBe('2026-01-23T13:13:05+01:00');
  });

  it('preserves source position for repeated scans and validates the whole bounded feed', () => {
    const body = copy(); body.situaciones.splice(1, 0, { ...body.situaciones[1], fecha: body.situaciones[0].fecha }, { ...body.situaciones[0] });
    expect(parseSeur(body, NUMBER).events?.slice(0, 3).map(e => e.stage)).toEqual(['delivered', 'out_for_delivery', 'delivered']);
    for (const change of [{ cod_situacion: '' }, { grupo_situacion: '' }, { descripcion_situacion: '' }, { descripcion_situacion: 'X'.repeat(501) }, { fecha: 'X'.repeat(65) }]) {
      const bad = copy(); Object.assign(bad.situaciones[0], change);
      expect(() => parseSeur(bad, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    expect(() => parseSeur({ ...fixture, situaciones: [...fixture.situaciones, null] }, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    expect(() => parseSeur({ ...fixture, situaciones: Array(501).fill(fixture.situaciones[0]) }, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    expect(parseSeur({ ...fixture, situaciones: Array(110).fill(fixture.situaciones[0]) }, NUMBER).events).toHaveLength(100);
  });

  it('omits unsupported, zero or invalid weights without losing tracking', () => {
    for (const weight of [undefined, null, -1, 0, NaN, Infinity, 100001, '1.2', '1 lb']) expect(parseSeur({ ...fixture, peso: weight }, NUMBER).weight_kg).toBeUndefined();
  });

  it('uses the exact official simplified POST through the full factory without recipient credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe('https://www.seur.com/miseur/backend/consultarEnvioLTSimple');
      expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'manual' });
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
      expect(new Headers(init?.headers).has('authorization')).toBe(false); expect(new Headers(init?.headers).has('cookie')).toBe(false);
      expect(JSON.parse(String(init?.body))).toEqual({ telefono: null, email: null, identificador_busqueda: NUMBER,
        idioma: 'es', cod_postal: '', tipo_actor: 'DST', cipher: false, origen_mkt: false });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return response();
    });
    expect(await adapter(environment(fetcher)).track({ number: NUMBER, postcode: 'PRIVATE_SYNTHETIC' })).toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('recognizes matching activity, skips unsupported formats and propagates no-history failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response()); const instance = adapter(environment(fetcher));
    expect(await instance.recognize!('unsupported')).toEqual({ known: false }); expect(fetcher).not.toHaveBeenCalled();
    expect(await instance.recognize!(NUMBER)).toEqual({ known: true, lastActivityAt: '2026-01-23T13:13:05.000Z' });
    const unresolved = vi.fn<typeof fetch>().mockResolvedValue(response(noHistory));
    await expect(adapter(environment(unresolved)).recognize!(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
    const body = copy(); body.situaciones.forEach(scan => { scan.fecha = ''; }); const undated = vi.fn<typeof fetch>().mockResolvedValue(response(body));
    expect(await adapter(environment(undated)).recognize!(NUMBER)).toEqual({ known: true, lastActivityAt: null });
  });

  it('keeps generic HTTP failures distinct from shipment absence and bounds response bytes', async () => {
    for (const [status, kind] of [[302, 'indeterminate'], [404, 'indeterminate'], [410, 'indeterminate'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(noHistory), { status }));
      await expect(new SeurTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind }); expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(1_000_001)));
    await expect(new SeurTracker({ fetcher: oversized }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Challenge</html>'));
    await expect(new SeurTracker({ fetcher: invalid }).fetch(NUMBER)).rejects.toThrow('invalid tracking response');
  });

  it('preserves caller cancellation and rejects delayed positive responses beyond a fractional deadline', async () => {
    const immediate = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(new SeurTracker({ fetcher: immediate }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(Error);
    await expect(new SeurTracker({ fetcher: immediate }).fetch(NUMBER, { budgetMs: 0 })).rejects.toMatchObject({ kind: 'budget' });
    expect(immediate).not.toHaveBeenCalled();
    const controller = new AbortController();
    const waiting = vi.fn<typeof fetch>(async (_url, init) => {
      await new Promise((_resolve, reject) => { init?.signal?.throwIfAborted(); init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }); });
      return response();
    });
    const active = new SeurTracker({ fetcher: waiting }).fetch(NUMBER, { signal: controller.signal }); controller.abort();
    await expect(active).rejects.toMatchObject({ kind: 'transport' }); expect(waiting).toHaveBeenCalledTimes(1);
    const late = vi.fn<typeof fetch>(async () => { await new Promise(resolve => setTimeout(resolve, 35)); return response(); });
    await expect(new SeurTracker({ fetcher: late }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toMatchObject({ kind: 'budget' });
  });
});
