import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, EstafetaTracker } from './adapter';
import { normalizeEstafetaNumber, parseEstafetaHistory, parseEstafetaLookup } from './parser';
import { estafetaStatus } from './status';

const NUMBER = '9000000001';
const GUIDE = '100000000000000A00TEST';
const OTHER = '100000000000000A00TES2';
const lookupHtml = () => readFileSync(new URL('./fixtures/delivered-lookup.html', import.meta.url), 'utf8');
const historyHtml = () => readFileSync(new URL('./fixtures/delivered-history.html', import.meta.url), 'utf8');
const lookup = () => parseEstafetaLookup(lookupHtml(), NUMBER);
const negative = '<html><head><title>Resultado</title></head><body><div class="TimeLineErrorRow"><div class="fontWaybill">Numero de Guia:<span class="fontWaybillBold"></span></div><h4>Lo sentimos, no se encontró información</h4></div></body></html>';

describe('Estafeta bound history', () => {
  it('binds the short-code alias to the canonical guide and retains local clocks without projecting private details', () => {
    const result = normalizeCarrierResult(parseEstafetaHistory(historyHtml(), lookup()));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', canonical_tracking_number: GUIDE, last_update: null, last_update_local: '2026-01-04T12:00:00', expected_delivery: null });
    expect(result.events).toHaveLength(4);
    expect(result.events?.[0]).toMatchObject({ description: 'Entregado', location: 'Example City', local_time: '2026-01-04T12:00:00' });
    expect(result.events?.at(-1)).toMatchObject({ stage: 'accepted', local_time: '2026-01-03T12:00:00' });
    expect(result.events?.some(event => event.time)).toBe(false); expect(result).not.toHaveProperty('delivered_at');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|scheduledDate|signature|proof|generateReport/);
    const full = parseEstafetaHistory(historyHtml(), parseEstafetaLookup(lookupHtml(), GUIDE)); expect(full).not.toHaveProperty('canonical_tracking_number');
    const metadata = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    const evidence: Record<string, boolean> = { history: !!result.events?.length, location: !!result.events?.some(event => event.location) };
    for (const capability of metadata.capabilities) expect(evidence[capability], capability).toBe(true);
  });
  it('rejects wrong or duplicate structured identities and history targets', () => {
    const wrongCode = lookupHtml().replace(NUMBER, '9000000002');
    const wrongGuide = lookupHtml().replaceAll(GUIDE, OTHER);
    const duplicateField = load(lookupHtml()); duplicateField('.shipmentInfoDiv').append(`<div class="shipmentInfoSeparator"><div class="fontRoman">Código de rastreo:</div><div class="fontBold">${NUMBER}</div></div>`);
    const wrongTarget = load(lookupHtml()); wrongTarget('.showHistory').attr('data-shipment-index', OTHER);
    for (const html of [wrongCode, duplicateField.html(), wrongTarget.html()]) expect(() => parseEstafetaLookup(html, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    expect(() => parseEstafetaLookup(wrongGuide, GUIDE)).toThrow(expect.objectContaining({ kind: 'schema' }));
    expect(() => parseEstafetaLookup('<html>Unavailable</html>', NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
  it('rejects colliding cards, collision markers and master-piece lists before selecting a history target', () => {
    const cards = load(lookupHtml()); cards('body').append(cards('.shipmentByOne').clone());
    const marker = load(lookupHtml()); marker('.shipmentByOne').attr('data-tracking-code', 'clsn9000000001');
    const pieces = load(lookupHtml()); pieces('.shipmentInfoDiv').append(`<ul class="multiplesWaybillList"><li><a class="MultipleLink">${OTHER}</a></li></ul>`);
    for (const html of [cards.html(), marker.html(), pieces.html()]) expect(() => parseEstafetaLookup(html, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
  });
  it('keeps the generic unknown page and empty history inconclusive without fabricating a terminal scan', () => {
    expect(() => parseEstafetaLookup(negative, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    for (const html of ['', '<div class="NoHistory">Por el momento, no hay información</div>']) expect(() => parseEstafetaHistory(html, lookup())).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
  });
  it('rejects challenges in either response while ignoring unrelated hidden no-information dialogs', () => {
    for (const html of ['<html><title>Just a moment</title></html>', '<div class="g-recaptcha"></div>']) {
      expect(() => parseEstafetaLookup(html, NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
      expect(() => parseEstafetaHistory(html, lookup())).toThrow(expect.objectContaining({ kind: 'challenge' }));
    }
    expect(parseEstafetaHistory(`${historyHtml()}<div class="NoHistory" hidden>Unavailable</div>`, lookup()).events).toHaveLength(4);
  });
  it('requires every date group to identify the canonical guide and rejects detached or malformed scans', () => {
    const wrong = historyHtml().replace(GUIDE, OTHER);
    const missing = historyHtml().replace(`data-shipmentindex="${GUIDE}"`, '');
    const duplicate = load(historyHtml()); duplicate('.historyEventRow').first().find('.col-xs-9').append(`<div class="remainingHistoryEvents" data-shipmentindex="${GUIDE}"></div>`);
    const malformed = load(historyHtml()); malformed('.eventInfo').eq(1).append('<div>Extra</div>');
    const detached = load(historyHtml()); detached('body').append(detached('.eventInfo').first().clone());
    for (const html of [wrong, missing, duplicate.html(), malformed.html(), detached.html()]) expect(() => parseEstafetaHistory(html, lookup())).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
  it('rejects latest-clock disagreement even when the terminal description matches', () => {
    const day = load(historyHtml()); day('.historyEventRow').first().children('.col-xs-2').text('05/01/2026');
    const time = load(historyHtml()); time('.eventInfo').first().children().first().text('12:01 hrs.');
    for (const html of [day.html(), time.html()]) expect(() => parseEstafetaHistory(html, lookup())).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
  });
  it('does not turn a completed summary into delivery when the actual newest scan differs', () => {
    const $ = load(historyHtml()); $('.eventInfo').first().children().last().text('En tránsito');
    expect(() => parseEstafetaHistory($.html(), lookup())).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parseEstafetaHistory(historyHtml(), { ...lookup(), state: 'En tránsito' })).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    const result = parseEstafetaHistory($.html(), { ...lookup(), state: 'En tránsito' }); expect(result).toMatchObject({ status: 'in_transit', current_stage: 'in_transit' }); expect(result).not.toHaveProperty('delivered_at');
  });
  it.each(['30/02/2026', 'January 4'])('retains incomplete newest dates %s literally without borrowing the summary date', date => {
    const $ = load(historyHtml()); $('.historyEventRow').first().children('.col-xs-2').text(date);
    const result = parseEstafetaHistory($.html(), { ...lookup(), latestDate: date });
    expect(result).toMatchObject({ last_update: null, last_update_local: null }); expect(result.events?.[0]).toMatchObject({ provider_time_text: `${date} 12:00 hrs.` }); expect(result.events?.[0]).not.toHaveProperty('local_time');
  });
  it.each(['24:00', '12:99', 'no clock'])('retains invalid newest clocks %s without normalizing them to another day', clock => {
    const $ = load(historyHtml()); $('.eventInfo').first().children().first().text(`${clock} hrs.`);
    const result = parseEstafetaHistory($.html(), { ...lookup(), latestClock: clock }); expect(result.events?.[0]).not.toHaveProperty('local_time'); expect(result.last_update).toBeNull();
  });
  it('keeps external transport delays nonterminal', () => {
    expect(estafetaStatus('CARGA DEMORADA POR BLOQUEO O ACCIDENTE EXTERNO EN VIA FEDERAL')).toEqual({ status: 'exception', stage: 'exception' });
    expect(estafetaStatus('No entregado')).toBeUndefined();
  });
  it('preserves unknown and equal-time scans in provider order, deduplicating and bounding output', () => {
    const $ = load(historyHtml()); const latest = $('.eventInfo').first(); latest.children().last().text('__proto__');
    const context = { ...lookup(), state: 'En tránsito' };
    const result = parseEstafetaHistory($.html(), context); expect(result).toMatchObject({ status: 'unknown', last_status_text: '__proto__' }); expect(result.events?.[0]).not.toHaveProperty('stage'); expect(estafetaStatus('__proto__')).toBeUndefined();
    $('.remainingHistoryEvents').first().append(latest.clone()); expect(parseEstafetaHistory($.html(), context).events).toHaveLength(4);
    for (let i = 0; i < 110; i++) { const row = latest.clone(); row.children().eq(1).text(`Example ${i}`); $('.remainingHistoryEvents').first().append(row); }
    expect(parseEstafetaHistory($.html(), context).events).toHaveLength(100);
    for (let i = 0; i < 400; i++) $('.remainingHistoryEvents').first().append(latest.clone()); expect(() => parseEstafetaHistory($.html(), context)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
});

describe('Estafeta direct retrieval', () => {
  it('uses a fresh identity-bound GET and form history POST without reusing session cookies', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => new Response(String(url).includes('GetTrackingItemHistory') ? historyHtml() : lookupHtml(), { headers: { 'Set-Cookie': 'session=PRIVATE_SYNTHETIC_TOKEN' } }));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
    await instance.track({ number: NUMBER }); await instance.track({ number: '100000000000000a00test' }); expect(fetcher).toHaveBeenCalledTimes(4);
    for (let index = 0; index < fetcher.mock.calls.length; index++) {
      const [rawUrl, init] = fetcher.mock.calls[index]; const url = new URL(String(rawUrl));
      expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' }); expect(init?.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(init?.headers); expect(headers.has('Cookie') || headers.has('Authorization')).toBe(false);
      if (index % 2 === 0) expect(Object.fromEntries(url.searchParams)).toEqual({ wayBill: index === 0 ? NUMBER : GUIDE, wayBillType: index === 0 ? '0' : '1', isShipmentDetail: 'True' });
      else { expect(url.origin + url.pathname).toBe('https://cs.estafeta.com/es/Tracking/GetTrackingItemHistory'); expect(init?.method).toBe('POST'); expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({ waybill: GUIDE }); }
    }
    expect(normalizeEstafetaNumber('90000-00001')).toBe(NUMBER);
  });
  it('stops after one request for collision, piece and generic unknown responses', async () => {
    const pieces = `${lookupHtml()}<ul class="multiplesWaybillList"></ul>`;
    for (const html of [negative, pieces]) { const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(html)); await expect(new EstafetaTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' }); expect(fetcher).toHaveBeenCalledOnce(); }
  });
  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])('keeps HTTP %s separate from unknown parcel data in either request', async (status, kind) => {
    for (const second of [false, true]) {
      const fetcher = vi.fn<typeof fetch>(); if (second) fetcher.mockResolvedValueOnce(new Response(lookupHtml())); fetcher.mockResolvedValueOnce(new Response('Failure', { status: Number(status) }));
      await expect(new EstafetaTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind }); expect(fetcher).toHaveBeenCalledTimes(second ? 2 : 1);
    }
  });
  it('rejects invalid input and cancellation before I/O and limits both response bodies', async () => {
    const unused = vi.fn<typeof fetch>(); for (const number of ['123', `${NUMBER}&wayBill=OTHER`, 'ABC1234567', 'X'.repeat(23)]) await expect(new EstafetaTracker({ fetcher: unused }).fetch(number)).rejects.toThrow(TypeError);
    await expect(new EstafetaTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow(); expect(unused).not.toHaveBeenCalled();
    for (const second of [false, true]) { const fetcher = vi.fn<typeof fetch>(); if (second) fetcher.mockResolvedValueOnce(new Response(lookupHtml())); fetcher.mockResolvedValueOnce(new Response('x'.repeat(1_000_001))); await expect(new EstafetaTracker({ fetcher }).fetch(NUMBER)).rejects.toThrow('unexpectedly large'); }
  });
  it('passes the remaining total fractional deadline into the actual second request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(lookupHtml())).mockImplementationOnce(async (_url, init) => {
      await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => resolve(), { once: true })); init?.signal?.throwIfAborted(); return new Response('');
    });
    await expect(new EstafetaTracker({ fetcher }).fetch(NUMBER, { budgetMs: 100.5 })).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
