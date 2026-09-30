// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter } from './adapter';
import { normalizeTipsaNumber, parseTipsaDetail, tipsaDetailUrl } from './parser';
import { tipsaStatus } from './status';
import statuses from './statuses.json';

const NUMBER = '0990010990010000000017';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const DETAIL = fixture('delivered.html');
const LOOKUP = fixture('lookup.html');
const UNKNOWN = fixture('unknown.html');
const DETAIL_URL = 'https://dinapaqweb.tipsa-dinapaq.com/dinapaqweb/detalle_envio.php?servicio=00000000-0000-4000-8000-000000000017&fecha=26/03/26';
const LOOKUP_URL = `https://aplicaciones.tip-sa.com/cliente/datos_prestashop.php?id=${NUMBER}`;
const environment = (fetcher: typeof fetch) => ({ fetcher, env: {}, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER });
const redirect = (target: string) => `<html><head><meta http-equiv='refresh' content='0;URL=${target}'></head></html>`;

describe('TIPSA shipment page', () => {
  it('takes only the full 22-digit reference', () => {
    expect(normalizeTipsaNumber(' 099001 099001 0000000017 ')).toBe(NUMBER);
    for (const number of ['0000000017', `${NUMBER}0`, 'AB0010990010000000017', '9'.repeat(65)]) {
      expect(() => normalizeTipsaNumber(number)).toThrow(TypeError);
    }
  });

  it('follows only the lookup redirect to its own shipment page', () => {
    expect(tipsaDetailUrl(LOOKUP)).toBe(DETAIL_URL);
    expect(tipsaDetailUrl(UNKNOWN)).toBeNull();
    for (const html of [
      '<html></html>',
      redirect(DETAIL_URL.replace('dinapaqweb.tipsa-dinapaq.com', 'example.test')),
      redirect(DETAIL_URL.replace('detalle_envio', 'otra')),
      redirect(`${DETAIL_URL}&extra=1`),
      redirect(DETAIL_URL.replace('000000000017', 'x')),
      redirect(DETAIL_URL.replace('26/03/26', '2026-03-26')),
      redirect(DETAIL_URL.replace('servicio=00000000-0000-4000-8000-000000000017', 'servicio=')),
    ]) expect(() => tipsaDetailUrl(html)).toThrowError(expect.objectContaining({ kind: 'schema' }));
  });

  it('reads the history table once per cell, on Madrid time across the clock change', () => {
    const result = normalizeCarrierResult(parseTipsaDetail(DETAIL, NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_status_text: 'ENTREGADO',
      last_update: '2026-03-30T18:40:00+02:00', timezone: 'Europe/Madrid' });
    expect(result.events?.map(({ time, description, location, stage }) => [time, description, location, stage])).toEqual([
      ['2026-03-30T18:40:00+02:00', 'ENTREGADO', undefined, 'delivered'],
      ['2026-03-30T09:05:00+02:00', 'REPARTO', undefined, 'out_for_delivery'],
      ['2026-03-30T09:05:00+02:00', 'LECTURA EN AGENCIA DESTINO EJEMPLO 01', 'VILLA EJEMPLO', 'in_transit'],
      ['2026-03-28T20:11:00+01:00', 'Ausente', undefined, 'failed_attempt'],
      ['2026-03-28T08:30:00+01:00', 'REPARTO', undefined, 'out_for_delivery'],
      ['2026-03-27T19:10:00+01:00', 'LECTURA EN AGENCIA DESTINO EJEMPLO 01', 'VILLA EJEMPLO', 'in_transit'],
      ['2026-03-27T19:10:00+01:00', 'LEIDO EN DESTINO', undefined, 'in_transit'],
      ['2026-03-26T22:24:00+01:00', 'TRANSITO', undefined, 'in_transit'],
      ['2026-03-26T17:50:00+01:00', 'PENDIENTE DE ENTREGAR A TIPSA', undefined, 'registered'],
    ]);
    // Recipient, sender, reference, postcode, agency address and proof of delivery stay out.
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SYNTHETIC|99999|Receptor|Observaciones/);
    for (const entry of statuses.entries) expect(tipsaStatus(entry.wording)?.stage).toBe(entry.stage);
  });

  it('leaves unknown labels to the shared wording rules', () => {
    expect(tipsaStatus('DEVUELTO')).toEqual({ status: 'exception', stage: 'returned' });
    expect(tipsaStatus('NUEVO REPARTO')).toBeUndefined();
    const page = DETAIL.replaceAll('>ENTREGADO<', '>NUEVO REPARTO<');
    const result = parseTipsaDetail(page, NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_status_text: 'NUEVO REPARTO' });
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.[0]?.stage).toBeUndefined();
  });

  it('binds the page to the requested reference', () => {
    expect(() => parseTipsaDetail(DETAIL, '0990010990010000000025')).toThrowError(expect.objectContaining({ kind: 'schema' }));
    for (const page of [
      DETAIL.replace('value="0990010990010000000017"', 'value="0990010990010000000025"'),
      DETAIL.replace("id='Albaran' value='0000000017'", "id='Albaran' value='0000000025'"),
      DETAIL.replace(/<input type='hidden'[^\n]*\n/, ''),
    ]) expect(() => parseTipsaDetail(page, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
  });

  it('rejects changed or unusable pages', () => {
    expect(() => parseTipsaDetail('<html><head><title>Just a moment...</title></head></html>', NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'challenge' }));
    for (const page of [
      DETAIL.replace('POBLACIÓN', 'LUGAR'),
      DETAIL.replace('30/03/26 18:40', '30-03-2026 18:40'),
      DETAIL.replace('<td class="mdl-data-table__cell--non-numeric">30/03/26 18:40</td>', ''),
    ]) expect(() => parseTipsaDetail(page, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    const empty = DETAIL.replace(/<tbody>[\s\S]*<\/tbody>/, '<tbody></tbody>');
    expect(() => parseTipsaDetail(empty, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });
});

describe('TIPSA adapter', () => {
  it('looks the reference up, then reads the Latin-1 shipment page', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input) === LOOKUP_URL
      ? new Response(LOOKUP)
      : new Response(Buffer.from(DETAIL, 'latin1'), { headers: { 'Content-Type': 'text/html' } }));
    const result = await adapter(environment(fetcher)).track({ number: NUMBER });
    expect(result.events).toHaveLength(9);
    expect(fetcher.mock.calls.map(([url, init]) => [String(url), init?.redirect])).toEqual([
      [LOOKUP_URL, 'manual'], [DETAIL_URL, 'manual'],
    ]);
  });

  it('answers an unknown reference as not found after one request, and recognizes it as unknown', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(UNKNOWN));
    const tipsa = adapter(environment(fetcher));
    await expect(tipsa.track({ number: NUMBER })).rejects.toMatchObject({ kind: 'not_found' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(tipsa.recognize?.(NUMBER)).resolves.toEqual({ known: false });
    await expect(tipsa.recognize?.('0000000017')).resolves.toEqual({ known: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('recognizes a known reference with its newest scan', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => String(input) === LOOKUP_URL
      ? new Response(LOOKUP) : new Response(Buffer.from(DETAIL, 'latin1')));
    await expect(adapter(environment(fetcher)).recognize?.(NUMBER))
      .resolves.toEqual({ known: true, lastActivityAt: '2026-03-30T16:40:00.000Z' });
  });

  it('treats a moved lookup as a changed page and a blocked one as a challenge', async () => {
    const moved = vi.fn<typeof fetch>(async () => new Response(null, { status: 302, headers: { Location: 'https://example.test/' } }));
    await expect(adapter(environment(moved)).track({ number: NUMBER })).rejects.toMatchObject({ kind: 'schema' });
    const blocked = vi.fn<typeof fetch>(async (input) => String(input) === LOOKUP_URL
      ? new Response(LOOKUP) : new Response('Forbidden', { status: 403 }));
    await expect(adapter(environment(blocked)).track({ number: NUMBER })).rejects.toMatchObject({ kind: 'challenge' });
  });
});
