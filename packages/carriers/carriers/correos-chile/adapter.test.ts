import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { CorreosChileTracker, adapter } from './adapter';
import { normalizeCorreosChileNumber, parseCorreosChileBootstrap, parseCorreosChileTracking } from './parser';
import { classifyCorreosChileScan } from './status';
import fixture from './fixtures/customs.json';
import statuses from './statuses.json';

const NUMBER = 'SX000000005CL';
const BOOTSTRAP = readFileSync(fileURLToPath(new URL('./fixtures/bootstrap.html', import.meta.url)), 'utf8');
const detail = () => JSON.parse(fixture.seguimiento) as Record<string, unknown> & { historial: Record<string, unknown>[] };
const payload = (change: Record<string, unknown> = {}) => ({ ...fixture, ...change });
const withDetail = (change: Record<string, unknown>) => payload({ seguimiento: JSON.stringify({ ...detail(), ...change }) });
const environment = (fetcher: typeof fetch) => ({ fetcher, env: {}, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER });
const pageResponse = (html = BOOTSTRAP) => new Response(html, { headers: [
  ['set-cookie', 'JSESSIONID=syntheticSession123; Path=/; Secure; HttpOnly'],
  ['set-cookie', 'SERVER_ID=syntheticServer123; Path=/; Secure'],
] });

describe('Correos de Chile anonymous tracking', () => {
  it('accepts only supported complete references and checks the Chilean postal check digit', () => {
    expect(normalizeCorreosChileNumber(' sx 000000005 cl ')).toBe(NUMBER);
    expect(normalizeCorreosChileNumber('9900000000001')).toBe('9900000000001');
    for (const value of ['', 'SX000000000CL', 'SX000000005US', '990000000001', NUMBER + '?', 'X'.repeat(49)]) {
      expect(() => normalizeCorreosChileNumber(value)).toThrow(TypeError);
    }
  });

  it('projects current physical scans, not future progress markers or recipient data', () => {
    const result = normalizeCarrierResult(parseCorreosChileTracking(fixture, NUMBER));
    expect(result).toMatchObject({ status: 'in_transit', current_stage: 'customs', last_update: null,
      last_update_local: '2026-09-05T01:24:00', last_status_text: 'ENVÍO EN PROCESO DE INTERNACIÓN AL PAÍS' });
    expect(result.events).toHaveLength(2);
    expect(result.events?.[0]).toMatchObject({ stage: 'customs', provider_code: '003', location: 'AEROPUERTO',
      local_time: '2026-09-05T01:24:00' });
    expect(result.events?.[1].stage).toBeUndefined();
    expect(result.delivered_at).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SYNTHETIC|sucursales|Iconos|Codigo|Referencia|RutEntrega/);
    for (const entry of statuses.entries) {
      expect(classifyCorreosChileScan(entry.code, entry.wording)?.stage).toBe(entry.stage);
    }
  });

  it('requires both exact provider references, bounded nonempty history and valid response shapes', () => {
    for (const change of [{ MainCodigo: 'SX000000013CL' }, { Referencia: 'SX000000013CL' },
      { Referencia: undefined }, { historial: null }, { historial: [null] },
      { historial: Array(501).fill(detail().historial[0]) }]) {
      expect(() => parseCorreosChileTracking(withDetail(change), NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    expect(() => parseCorreosChileTracking(withDetail({ historial: [] }), NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    for (const body of [null, [], {}, payload({ seguimiento: '{}' }), payload({ seguimiento: '{' })]) {
      expect(() => parseCorreosChileTracking(body, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('keeps ambiguous missing or expired tracking inconclusive', () => {
    expect(() => parseCorreosChileTracking({ error: true, descripcion: 'Seguimiento no encontrado' }, NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parseCorreosChileTracking({ error: true, maxLimit: true }, NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'rate_limited' }));
  });

  it('retains portal order and never promotes older delivery when the current scan is unresolved', () => {
    const body = detail();
    body.historial[0] = { ...body.historial[0], FechaDate: '2026-02-30T01:24:00', Fecha: '',
      Estado: 'ENVÍO PENDIENTE DE PROCESAMIENTO', Icono: '999' };
    body.historial[1] = { ...body.historial[1], FechaDate: '2026-08-31T19:20:00',
      Estado: 'ENVÍO ENTREGADO', Icono: '006' };
    const result = parseCorreosChileTracking(payload({ seguimiento: JSON.stringify(body) }), NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_update: null });
    expect(result.current_stage).toBeUndefined();
    expect(result.last_update_local).toBeUndefined();
    expect(result.delivered_at).toBeUndefined();
    expect(result.events?.[0].provider_time_text).toBe('2026-02-30T01:24:00');
    expect(result.events?.[1].stage).toBe('delivered');
    expect(result.events?.[1].local_time).toBe('2026-08-31T19:20:00');
  });

  it('does not expose untyped recipient-like scan text or free-form provider codes', () => {
    const body = detail();
    body.historial[0] = { ...body.historial[0], Estado: 'ENTREGADO A PRIVATE_SYNTHETIC_RECIPIENT', Icono: 'recipient-ID' };
    const result = parseCorreosChileTracking(payload({ seguimiento: JSON.stringify(body) }), NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_status_text: 'Actualización del envío' });
    expect(result.events?.[0].description).toBe('Actualización del envío');
    expect(result.events?.[0].provider_code).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC_RECIPIENT');
  });

  it('requires a current same-origin resource and CSRF token, classifies challenges', () => {
    const session = parseCorreosChileBootstrap(BOOTSTRAP);
    expect(session).toMatchObject({ csrf: 'syntheticToken123' });
    expect(session.url).toContain('cmd_resource_get_seguimientos');
    for (const html of [BOOTSTRAP.replace('https://www.correos.cl/', 'https://example.invalid/'),
      BOOTSTRAP.replace('cmd_resource_get_seguimientos', 'other_command'),
      BOOTSTRAP.replace('syntheticToken123', ''), BOOTSTRAP.replace('p_p_lifecycle=2', 'p_p_lifecycle=1')]) {
      expect(() => parseCorreosChileBootstrap(html)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    expect(() => parseCorreosChileBootstrap('Radware Captcha Page')).toThrowError(expect.objectContaining({ kind: 'challenge' }));
  });

  it('uses exactly two bounded native requests and a fresh anonymous session through the factory', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(init?.redirect).toBe('manual'); expect(init?.cache).toBe('no-store');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (fetcher.mock.calls.length === 1) {
        expect(String(url)).toBe('https://www.correos.cl/seguimiento-en-linea');
        expect(init?.method).toBeUndefined();
        return pageResponse();
      }
      expect(String(url)).toContain('cmd_resource_get_seguimientos');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('cookie')).toBe('JSESSIONID=syntheticSession123; SERVER_ID=syntheticServer123');
      expect(headers.has('authorization')).toBe(false);
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('p_auth')).toBe('syntheticToken123');
      expect([...body.entries()].filter(([key]) => key !== 'p_auth')).toEqual([[parseCorreosChileBootstrap(BOOTSTRAP).numberField, NUMBER]]);
      expect([...body.keys()]).toHaveLength(2);
      return Response.json(fixture);
    });
    expect(await adapter(environment(fetcher)).track({ number: NUMBER, postcode: 'PRIVATE_SYNTHETIC' }))
      .toMatchObject({ status: 'in_transit', current_stage: 'customs' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not confuse generic resource errors with parcel absence', async () => {
    for (const status of [302, 404, 410]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
      await expect(new CorreosChileTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const missingCookies = vi.fn<typeof fetch>().mockResolvedValue(new Response(BOOTSTRAP));
    await expect(new CorreosChileTracker({ fetcher: missingCookies }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(500_001)));
    await expect(new CorreosChileTracker({ fetcher: oversized }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const oversizedDetail = vi.fn<typeof fetch>().mockResolvedValueOnce(pageResponse())
      .mockResolvedValueOnce(new Response(new Uint8Array(6_000_001)));
    await expect(new CorreosChileTracker({ fetcher: oversizedDetail }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    expect(oversizedDetail).toHaveBeenCalledTimes(2);
    const inconclusive = vi.fn<typeof fetch>().mockResolvedValueOnce(pageResponse())
      .mockResolvedValueOnce(Response.json({ error: true, descripcion: 'Seguimiento no encontrado' }));
    await expect(adapter(environment(inconclusive)).track({ number: NUMBER })).rejects.toMatchObject({ kind: 'indeterminate' });
  });

  it('preserves the single deadline and cancellation across bootstrap and tracking requests', async () => {
    const immediate = vi.fn<typeof fetch>().mockResolvedValue(pageResponse());
    await expect(new CorreosChileTracker({ fetcher: immediate }).fetch(NUMBER, { budgetMs: 0 }))
      .rejects.toMatchObject({ kind: 'budget' });
    expect(immediate).not.toHaveBeenCalled();
    const slowBootstrap = vi.fn<typeof fetch>(async () => {
      await new Promise(resolve => setTimeout(resolve, 35));
      return pageResponse();
    });
    await expect(new CorreosChileTracker({ fetcher: slowBootstrap }).fetch(NUMBER, { budgetMs: 20.5 }))
      .rejects.toMatchObject({ kind: 'budget' });
    expect(slowBootstrap).toHaveBeenCalledTimes(1);
    const slowDetail = vi.fn<typeof fetch>().mockResolvedValueOnce(pageResponse())
      .mockImplementationOnce(async () => {
        await new Promise(resolve => setTimeout(resolve, 35));
        return Response.json(fixture);
      });
    await expect(new CorreosChileTracker({ fetcher: slowDetail }).fetch(NUMBER, { budgetMs: 20.5 }))
      .rejects.toMatchObject({ kind: 'budget' });
    expect(slowDetail).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    const waiting = vi.fn<typeof fetch>(async (_url, init) => {
      await new Promise((_resolve, reject) => {
        init?.signal?.throwIfAborted();
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
      return pageResponse();
    });
    const pending = new CorreosChileTracker({ fetcher: waiting }).fetch(NUMBER, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'transport' });
    expect(waiting).toHaveBeenCalledTimes(1);
  });
});
