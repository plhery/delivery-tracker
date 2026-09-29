import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { CorreosExpressTracker, adapter } from './adapter';
import { normalizeCorreosExpressNumber, parseCorreosExpress } from './parser';
import { classifyCorreosExpressStatus } from './status';
import statuses from './statuses.json';

const NUMBER = '9900000000000002';
const OTHER = '9900000000000003';
const html = readFileSync(new URL('./fixtures/history.html', import.meta.url), 'utf8');
const response = (body = html) => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const edit = (change: (document: ReturnType<typeof load>) => void) => { const $ = load(html); change($); return $.html(); };
const negative = (number = NUMBER, code = '2') => `<html><head><title>Sigue tu envío- correosexpress.com</title></head><body>
  <form id="desktopHomeForm"><input name="shippingNumber" value="${number}"><input name="errorCode" value="${code}"></form>
  <form id="mobileHomeForm"><input name="shippingNumber" value="${number}"><input name="errorCode" value="${code}"></form>
  <div class="errorMessage2"><span class="errorMessage">Lo sentimos, no se ha encontrado ningún envío con el número indicado.</span></div>
  <div class="errorMessage-1">Lo sentimos, se ha producido un error durante la búsqueda del envío.</div></body></html>`;

describe('Correos Express direct tracking', () => {
  it('projects matching actual scans, local clocks, locality and date-only estimates without private details', () => {
    const result = normalizeCarrierResult(parseCorreosExpress(html, NUMBER));
    expect(result).toMatchObject({ status: 'in_transit', current_stage: 'in_transit', last_status_text: 'NUEVO REPARTO',
      last_update: null, last_update_local: '2026-01-05T18:27:00', expected_delivery: '2026-01-06' });
    expect(result.events).toHaveLength(7);
    expect(result.events?.[0]).toMatchObject({ local_time: '2026-01-05T18:27:00', location: 'BARCELONA2', provider_status: 'NUEVO REPARTO', stage: 'in_transit' });
    expect(result.events?.map(event => event.stage)).toEqual(['in_transit', 'exception', 'out_for_delivery', 'in_transit', 'in_transit', 'accepted', 'registered']);
    expect(result.events?.every(event => !event.time && !event.provider_code)).toBe(true);
    expect(result.delivered_at).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
    for (const row of statuses.entries) expect(classifyCorreosExpressStatus(row.wording)?.stage).toBe(row.stage);
    expect(classifyCorreosExpressStatus('constructor')).toBeUndefined();
  });

  it('requires supported input and both independent shipment label and hidden field to match', () => {
    expect(normalizeCorreosExpressNumber('9900 0000 0000 0002')).toBe(NUMBER);
    for (const raw of ['', '123', NUMBER + '1234567', NUMBER + '?', 'A' + NUMBER.slice(1)]) expect(() => normalizeCorreosExpressNumber(raw)).toThrow(TypeError);
    for (const changed of [edit($ => $('h3.status .shipping > span').text(OTHER)), edit($ => $('#shippingNumber').val(OTHER)),
      edit($ => $('.shipping').remove()), edit($ => $('h3.status').clone().appendTo('body')),
      edit($ => $('.shipping > span').clone().appendTo('.shipping')),
      edit($ => $('table.miyazaki').clone().appendTo('body')), edit($ => $('#shippingNumber').clone().appendTo('body'))]) {
      expect(() => parseCorreosExpress(changed, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('uses only a matching server-selected no-history outcome, never hidden message text alone', () => {
    expect(() => parseCorreosExpress(negative(), NUMBER)).toThrowError(expect.objectContaining({ kind: 'not_found' }));
    for (const code of ['', '-1', '1', 'unknown']) expect(() => parseCorreosExpress(negative(NUMBER, code), NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parseCorreosExpress(negative(OTHER), NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    expect(() => parseCorreosExpress(negative().replace('no se ha encontrado ningún envío', 'temporalmente no disponible'), NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parseCorreosExpress('<html>Maintenance</html>', NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('rejects incomplete, ambiguous or oversized histories instead of inventing progress', () => {
    expect(() => parseCorreosExpress(edit($ => $('tbody tr').remove()), NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    for (const changed of [edit($ => $('thead th').first().text('Different column')), edit($ => $('tbody tr').first().find('td').last().remove()),
      edit($ => $('tbody tr').first().find('td').last().text('')),
      edit($ => $('table.miyazaki tbody').html($('table.miyazaki tbody tr').first().toString().repeat(501)))]) {
      expect(() => parseCorreosExpress(changed, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('retains label-free and unrecognized native scans without exposing incident details', () => {
    const changed = edit($ => {
      const first = $('tbody tr').first();
      first.find('td').last().text('. PRIVATE_SYNTHETIC_INCIDENT');
      const unknown = first.clone();
      unknown.find('td').first().text('05/01/2026 18:20');
      unknown.find('td').last().text('FIRMADO POR PRIVATE_SYNTHETIC_NAME');
      first.after(unknown);
      $('tbody tr').eq(2).find('td').last().text('ENTREGADO. PRIVATE_SYNTHETIC_SIGNATURE');
    });
    const result = parseCorreosExpress(changed, NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_status_text: 'Tracking update', expected_delivery: null });
    expect(result.current_stage).toBeUndefined();
    expect(result.events).toHaveLength(8);
    expect(result.events?.slice(0, 2)).toEqual([
      expect.objectContaining({ description: 'Tracking update', local_time: '2026-01-05T18:27:00' }),
      expect.objectContaining({ description: 'Tracking update', local_time: '2026-01-05T18:20:00' }),
    ]);
    expect(result.events?.[0].provider_status).toBeUndefined();
    expect(result.events?.[1].provider_status).toBeUndefined();
    expect(result.events?.[2].stage).toBe('delivered');
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
  });

  it('keeps newest unknown or malformed-clock rows ahead of older delivery and preserves unresolved digits', () => {
    for (const clock of ['', '31/02/2026 12:00', '05/01/2026 25:00', 'Tomorrow']) {
      const changed = edit($ => {
        $('tbody tr').first().find('td').eq(0).text(clock);
        $('tbody tr').first().find('td').eq(2).text('NUEVO ESTADO. PRIVATE_SYNTHETIC_DETAIL');
        $('tbody tr').eq(1).find('td').eq(2).text('ENTREGADO. PRIVATE_SYNTHETIC_SIGNATURE');
      });
      const result = parseCorreosExpress(changed, NUMBER);
      expect(result).toMatchObject({ status: 'unknown', last_status_text: 'Tracking update', last_update: null, expected_delivery: null });
      expect(result.current_stage).toBeUndefined();
      expect(result.delivered_at).toBeUndefined();
      expect(result.events?.[0].local_time).toBeUndefined();
      expect(result.events?.[0].provider_status).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
      if (clock) expect(result.events?.[0].provider_time_text).toBe(clock);
    }
  });

  it('preserves latest terminal semantics without assigning a delivery instant from local clocks', () => {
    for (const [label, status, stage] of [['ENTREGADO', 'delivered', 'delivered'], ['DEVUELTO', 'exception', 'returned']] as const) {
      const result = parseCorreosExpress(edit($ => $('tbody tr').first().find('td').last().text(label + '. PRIVATE_SYNTHETIC_SIGNATURE')), NUMBER);
      expect(result).toMatchObject({ status, current_stage: stage, expected_delivery: null });
      expect(result.delivered_at).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
    }
  });

  it('keeps provider positions while deduplicating and bounds retained history', () => {
    const deduped = edit($ => {
      const row = $('table.miyazaki tbody tr').first().clone();
      $('table.miyazaki tbody').append(row);
    });
    expect(parseCorreosExpress(deduped, NUMBER).events).toHaveLength(7);
    expect(parseCorreosExpress(deduped, NUMBER).last_status_text).toBe('NUEVO REPARTO');
    const many = edit($ => { const first = $('table.miyazaki tbody tr').first();
      for (let i = 0; i < 105; i++) { const row = first.clone(); row.find('td').eq(1).text('LOCALITY ' + i); $('table.miyazaki tbody').append(row); } });
    expect(parseCorreosExpress(many, NUMBER).events).toHaveLength(100);
  });

  it('validates calendar estimates and omits stale, unresolved and incident promises', () => {
    for (const estimate of ['31 Feb 2026', '03 Ene 2026', '06 Xxx 2026', 'Unknown']) {
      const changed = edit($ => { const heading = $('h3.status');
        heading.contents().filter((_, node) => node.type === 'text').remove();
        heading.append('Entrega prevista: Martes, ' + estimate);
      });
      expect(parseCorreosExpress(changed, NUMBER).expected_delivery).toBeNull();
    }
    const incident = edit($ => $('tbody tr').first().find('td').last().text('ESTACIONADO'));
    expect(parseCorreosExpress(incident, NUMBER).expected_delivery).toBeNull();
  });

  it('uses one anonymous form POST with no bootstrap, cookie, authorization or credential', async () => {
    const fetcher = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://s.correosexpress.com/SeguimientoSinCP/search');
      expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
      expect(init?.body).toBeInstanceOf(URLSearchParams);
      expect(String(init?.body)).toBe('shippingNumber=' + NUMBER + '&errorCode=');
      expect(new Headers(init?.headers).has('cookie')).toBe(false);
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return response();
    }) as unknown as typeof fetch;
    const instance = adapter({ fetcher, env: {}, trawl: null, browserExecutablePath: null, recorder: { step() {}, lookup() {} } });
    expect(await instance.track({ number: NUMBER, postcode: 'PRIVATE_SYNTHETIC_POSTCODE' })).toMatchObject({ status: 'in_transit' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('recognizes matching history and a proven negative but never ranks local clocks or converts failure to absence', async () => {
    const fetcher = vi.fn(async () => response()) as unknown as typeof fetch;
    const instance = adapter({ fetcher, env: {}, trawl: null, browserExecutablePath: null, recorder: { step() {}, lookup() {} } });
    expect(await instance.recognize!('invalid')).toEqual({ known: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await instance.recognize!(NUMBER)).toEqual({ known: true, lastActivityAt: null });
    const unknown = adapter({ fetcher: vi.fn(async () => response(negative())) as unknown as typeof fetch, env: {}, trawl: null, browserExecutablePath: null, recorder: { step() {}, lookup() {} } });
    expect(await unknown.recognize!(NUMBER)).toEqual({ known: false });
    const outage = adapter({ fetcher: vi.fn(async () => response(negative(NUMBER, '-1'))) as unknown as typeof fetch, env: {}, trawl: null, browserExecutablePath: null, recorder: { step() {}, lookup() {} } });
    await expect(outage.recognize!(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
  });

  it('preserves generic HTTP failures and streaming body limits without retrying', async () => {
    for (const [status, kind] of [[404, 'indeterminate'], [410, 'indeterminate'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']] as const) {
      const fetcher = vi.fn(async () => new Response('Unavailable', { status })) as unknown as typeof fetch;
      await expect(new CorreosExpressTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const large = vi.fn(async () => new Response(new Uint8Array(1_000_001))) as unknown as typeof fetch;
    await expect(new CorreosExpressTracker({ fetcher: large }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    expect(large).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation before and during retrieval and enforces the whole lookup budget', async () => {
    const immediate = vi.fn(async () => response()) as unknown as typeof fetch;
    await expect(new CorreosExpressTracker({ fetcher: immediate }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(Error);
    await expect(new CorreosExpressTracker({ fetcher: immediate }).fetch(NUMBER, { budgetMs: 0 })).rejects.toMatchObject({ kind: 'budget' });
    expect(immediate).not.toHaveBeenCalled();
    const controller = new AbortController();
    const waiting = vi.fn(async (_url, init) => {
      init?.signal?.throwIfAborted();
      await new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
      return response();
    }) as unknown as typeof fetch;
    const active = new CorreosExpressTracker({ fetcher: waiting }).fetch(NUMBER, { signal: controller.signal });
    controller.abort();
    await expect(active).rejects.toMatchObject({ kind: 'transport' });
    await expect(new CorreosExpressTracker({ fetcher: waiting }).fetch(NUMBER, { budgetMs: 20 })).rejects.toMatchObject({ kind: 'transport' });
    expect(waiting).toHaveBeenCalledTimes(2);
  });
});
