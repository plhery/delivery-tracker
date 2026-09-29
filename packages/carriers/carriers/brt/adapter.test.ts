import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { BrtTracker, adapter } from './adapter';
import { normalizeBrtNumber, parseBrt } from './parser';
import { classifyBrtStatus } from './status';
import statuses from './statuses.json';

const NUMBER = '99000000000002';
const OTHER = '99000000000003';
const html = readFileSync(new URL('./fixtures/history.html', import.meta.url), 'utf8');
const negative = (number = NUMBER) => `<div id="box_tool_content"><div id="toolbar_sx"><h3>Rintraccia</h3></div><h3 class="separatore">Errori riscontrati</h3><div id="box_contenuti">TIS0868 Parcel Label number ${number} not found</div></div>`;
const edit = (fn: (document: ReturnType<typeof load>) => void) => { const $ = load(html); fn($); return $.html(); };
const response = (body = html) => new Response(body, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
const environment = (fetcher: typeof fetch) => ({ fetcher, env: {}, trawl: null, browserExecutablePath: null, recorder: { step() {}, lookup() {} } });

describe('BRT direct tracking', () => {
  it('projects actual locker scans, cross-border local clocks and explicit kilogram weight', () => {
    const result = normalizeCarrierResult(parseBrt(html, NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_status_text: 'Delivered',
      last_update: null, last_update_local: '2026-01-16T21:07:00', weight_kg: 0.2 });
    expect(result.events).toHaveLength(7);
    expect(result.events?.[0]).toMatchObject({ stage: 'delivered', description: 'Delivered', local_time: '2026-01-16T21:07:00', location: 'TEST DEPOT (990)' });
    expect(result.events?.[1].stage).toBe('ready_for_pickup');
    expect(result.events?.[2]).toMatchObject({ stage: 'out_for_delivery', provider_time_text: '14.01.2026' });
    expect(result.events?.[2].local_time).toBeUndefined();
    expect(result.events?.[5].stage).toBe('accepted');
    expect(result.events?.[6].stage).toBe('registered');
    expect(result.events?.every(event => !event.time && !event.provider_code)).toBe(true);
    expect(result.delivered_at).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
    for (const entry of statuses.entries) expect(classifyBrtStatus(entry.wording)?.stage).toBe(entry.stage);
    for (const word of ['constructor', 'toString', 'DELIVERY PLANNED', 'RETURN REQUESTED']) expect(classifyBrtStatus(word)).toBeUndefined();
  });

  it('binds the returned BRTcode, rejects ambiguous details and accepts only the supported format', () => {
    expect(normalizeBrtNumber('9900 0000 0000 02')).toBe(NUMBER);
    for (const n of ['', '123', NUMBER + '0', NUMBER.slice(1), NUMBER + '?', 'ABC00000000000']) expect(() => normalizeBrtNumber(n)).toThrow(TypeError);
    for (const body of [edit($ => $('.table_dati_spedizione tr').eq(1).children('td').last().text(OTHER)),
      edit($ => $('.table_dati_spedizione tr').eq(1).remove()),
      edit($ => $('.table_dati_spedizione tr').eq(1).clone().appendTo('.table_dati_spedizione')),
      edit($ => $('.table_dati_spedizione').clone().appendTo('body')),
      edit($ => $('.table_stato_dati').clone().appendTo('body'))]) {
      expect(() => parseBrt(body, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('reports only the scoped matching TIS0868 parcel-label negative', () => {
    expect(() => parseBrt(negative(), NUMBER)).toThrowError(expect.objectContaining({ kind: 'not_found' }));
    for (const body of [negative(OTHER), negative().replace('TIS0868', 'TIS0000'), negative().replace('Errori riscontrati', 'Maintenance'),
      negative().replace('box_tool_content', 'hidden'), negative() + negative(), '<html>Parcel not found</html>',
      edit($ => $('.table_stato_dati').remove())]) {
      expect(() => parseBrt(body, NUMBER)).toThrow();
      expect(() => parseBrt(body, NUMBER)).not.toThrowError(expect.objectContaining({ kind: 'not_found' }));
    }
  });

  it('does not promote older dated delivery when the newest clock or wording is unresolved', () => {
    for (const [date, clock] of [['', ''], ['31.02.2026', '25.00'], ['16.01.2026', '09.99'], ['Tomorrow', 'Any time']]) {
      const result = parseBrt(edit($ => {
        const first = $('.table_stato_dati tr').eq(1).children('td');
        first.eq(0).text(date); first.eq(1).text(clock); first.eq(3).text('NEW PROVIDER STATUS');
        $('.table_stato_dati tr').eq(2).children('td').last().text('DELIVERED');
      }), NUMBER);
      expect(result).toMatchObject({ status: 'unknown', last_status_text: 'NEW PROVIDER STATUS', last_update: null });
      expect(result.current_stage).toBeUndefined(); expect(result.last_update_local).toBeUndefined(); expect(result.delivered_at).toBeUndefined();
      expect(result.events?.[0].provider_time_text).toBe([date, clock].filter(Boolean).join(' ') || undefined);
      expect(result.events?.[0].local_time).toBeUndefined();
    }
    const delivered = parseBrt(edit($ => $('.table_stato_dati tr').eq(1).children('td').eq(1).text('')), NUMBER);
    expect(delivered.status).toBe('delivered'); expect(delivered.last_update_local).toBeUndefined(); expect(delivered.delivered_at).toBeUndefined();
  });

  it('keeps native newest-first position, equal clocks and repeated scans without inventing codes', () => {
    const body = edit($ => {
      const row = $('.table_stato_dati tr').eq(1);
      row.clone().insertAfter(row);
      $('.table_stato_dati tr').eq(2).children('td').last().text('FOR DELIVERY');
      row.clone().insertAfter($('.table_stato_dati tr').eq(2));
    });
    const result = parseBrt(body, NUMBER);
    expect(result.status).toBe('delivered');
    expect(result.events?.slice(0, 3).map(e => e.stage)).toEqual(['delivered', 'out_for_delivery', 'delivered']);
  });

  it('rejects incomplete or oversized scan tables and bounds retained history', () => {
    for (const body of [edit($ => $('.table_stato_dati tr').first().children('td').last().text('Different heading')),
      edit($ => $('.table_stato_dati tr').eq(1).children('td').last().remove()),
      edit($ => $('.table_stato_dati tr').eq(1).children('td').last().text('')),
      edit($ => $('.table_stato_dati').append('<tr><td>x</td></tr>'.repeat(502)))]) {
      expect(() => parseBrt(body, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    expect(() => parseBrt(edit($ => $('.table_stato_dati tr').slice(1).remove()), NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    const many = edit($ => $('.table_stato_dati').append($('.table_stato_dati tr').eq(1).prop('outerHTML')!.repeat(120)));
    expect(parseBrt(many, NUMBER).events).toHaveLength(100);
  });

  it('retains only positive, unambiguous explicit kilogram weights', () => {
    for (const weight of ['0', '-1', 'NaN', '100001', '1 lb', '0,2 Peso (kg): 0,3']) {
      const result = parseBrt(edit($ => $('.table_dati_spedizione tr').eq(5).children('td').last().text(`PACCHI Peso (kg): ${weight}`)), NUMBER);
      expect(result.weight_kg).toBeUndefined();
    }
    expect(parseBrt(edit($ => $('.table_dati_spedizione tr').eq(5).children('td').last().text('PACCHI Peso (kg): 1.25 Volume m³: 0.5')), NUMBER).weight_kg).toBe(1.25);
  });

  it('retrieves the exact linked public event page in one bounded request without credentials or postcode', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(`https://vas.brt.it/vas/sped_det_new.htm?brtCode=${NUMBER}&lang=en`);
      expect(init).toMatchObject({ cache: 'no-store', redirect: 'manual' });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).has('cookie')).toBe(false);
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
      expect(init?.body).toBeUndefined();
      return response();
    });
    expect(await adapter(environment(fetcher)).track({ number: NUMBER, postcode: 'PRIVATE_SYNTHETIC_POSTCODE' })).toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('recognizes matching history without ranking unresolved local clocks and propagates outages', async () => {
    const positive = vi.fn<typeof fetch>().mockResolvedValue(response());
    const instance = adapter(environment(positive));
    expect(await instance.recognize!('unsupported')).toEqual({ known: false }); expect(positive).not.toHaveBeenCalled();
    expect(await instance.recognize!(NUMBER)).toEqual({ known: true, lastActivityAt: null });
    const absent = vi.fn<typeof fetch>().mockResolvedValue(response(negative()));
    expect(await adapter(environment(absent)).recognize!(NUMBER)).toEqual({ known: false });
    const outage = vi.fn<typeof fetch>().mockResolvedValue(response('<html>Unavailable</html>'));
    await expect(adapter(environment(outage)).recognize!(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
  });

  it('decodes the legacy page encoding while rejecting unknown encodings', async () => {
    const body = html.replaceAll('TEST DEPOT', 'TEST DÉPÔT');
    const latin = vi.fn<typeof fetch>().mockResolvedValue(new Response(Buffer.from(body, 'latin1')));
    expect((await new BrtTracker({ fetcher: latin }).fetch(NUMBER)).events?.[0].location).toBe('TEST DÉPÔT (990)');
    const changed = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'text/html;charset=UTF-16' } }));
    await expect(new BrtTracker({ fetcher: changed }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });

  it('classifies HTTP failures without treating generic 404/410 or redirects as parcel absence', async () => {
    for (const [status, kind] of [[302, 'indeterminate'], [404, 'indeterminate'], [410, 'indeterminate'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(negative(), { status }));
      await expect(new BrtTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array(1_000_001)));
    await expect(new BrtTracker({ fetcher: oversized }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    expect(oversized).toHaveBeenCalledTimes(1);
  });

  it('preserves caller cancellation and rejects responses arriving after a fractional lookup budget', async () => {
    const immediate = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(new BrtTracker({ fetcher: immediate }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(Error);
    await expect(new BrtTracker({ fetcher: immediate }).fetch(NUMBER, { budgetMs: 0 })).rejects.toMatchObject({ kind: 'budget' });
    expect(immediate).not.toHaveBeenCalled();
    const controller = new AbortController();
    const waiting = vi.fn<typeof fetch>(async (_url, init) => {
      await new Promise((_resolve, reject) => { init?.signal?.throwIfAborted(); init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }); });
      return response();
    });
    const active = new BrtTracker({ fetcher: waiting }).fetch(NUMBER, { signal: controller.signal }); controller.abort();
    await expect(active).rejects.toMatchObject({ kind: 'transport' }); expect(waiting).toHaveBeenCalledTimes(1);
    const late = vi.fn<typeof fetch>(async () => { await new Promise(resolve => setTimeout(resolve, 35)); return response(); });
    await expect(new BrtTracker({ fetcher: late }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toMatchObject({ kind: 'budget' });
    expect(late).toHaveBeenCalledTimes(1);
  });
});
