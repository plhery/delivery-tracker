import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, JapanPostTracker, normalizeJapanPostNumber, parse } from './adapter';

const NUMBER = 'CN000000005JP';
const fixture = (name = 'positive') => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');
function withLastStatus(wording: string): string {
  const $ = load(fixture());
  $('table[summary="履歴情報"] tr').eq(-2).children('td').eq(1).text(wording);
  return $.html();
}

describe('Japan Post result projection', () => {
  it('projects local wall times and derives each confirmed event zone separately', () => {
    const result = normalizeCarrierResult(parse(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered',
      last_status_text: 'Final delivery', last_update: '2026-09-04T09:43:00Z', last_update_local: '2026-09-04T11:43:00', expected_delivery: null });
    expect(result.events).toHaveLength(5);
    expect(result.events?.map((event) => event.stage)).toEqual(['delivered', 'out_for_delivery', 'customs', 'in_transit', 'accepted']);
    expect(result.events?.[0].location).toBe('MALTA');
    expect(result.events?.at(-1)?.location).toBe('EXAMPLE ORIGIN, OSAKA');
    expect(result.events?.map((event) => event.local_time)).toEqual([
      '2026-09-04T11:43:00', '2026-09-04T07:45:00', '2026-09-03T12:55:00', '2026-09-02T11:33:00', '2026-09-01T12:23:00',
    ]);
    expect(result.events?.map((event) => event.time)).toEqual([
      '2026-09-04T09:43:00Z', '2026-09-04T05:45:00Z', '2026-09-03T10:55:00Z', '2026-09-02T02:33:00Z', '2026-09-01T03:23:00Z',
    ]);
    expect(result.timezone).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|000-0000|CN000000005JP/);
    expect(Object.keys(result).sort()).toEqual(['current_stage', 'events', 'expected_delivery', 'last_status_text', 'last_update', 'last_update_local', 'status']);
  });

  it('preserves carrier order across foreign clock changes and date-only precision', () => {
    const $ = load(fixture());
    $('table[summary="履歴情報"] tr').eq(-2).children('td').eq(0).text('09/01/2026');
    const result = parse($.html(), NUMBER);
    expect(result.last_update).toBeNull();
    expect(result.last_update_local).toBe('2026-09-01');
    expect(result.events?.[0]).toMatchObject({ local_time: '2026-09-01' });
    expect(result.events?.[0].time).toBeUndefined();
    expect(result.status).toBe('delivered');
  });

  it('supports the documented domestic number shape without changing tracking identity', () => {
    const html = fixture().replace('CN 000 000 005 JP', '0000-0000-005').replace('Prefecture / Country', 'Prefecture');
    expect(parse(html, '00000000005').events).toHaveLength(5);
    expect(normalizeJapanPostNumber('cn 000.000-005 jp')).toBe(NUMBER);
  });

  it.each(['UNITED STATES', 'CANADA', 'SPAIN', 'PORTUGAL', 'UNKNOWN', ''])('retains %s wall time without a guessed timezone', (region) => {
    const $ = load(fixture());
    $('table[summary="履歴情報"] tr').eq(-2).children('td').eq(4).text(region);
    const result = parse($.html(), NUMBER);
    expect(result.last_update).toBeNull();
    expect(result.last_update_local).toBe('2026-09-04T11:43:00');
    expect(result.events?.[0].time).toBeUndefined();
    expect(result.events?.[0].local_time).toBe('2026-09-04T11:43:00');
    expect(result.events?.[1].time).toBe('2026-09-04T05:45:00Z');
  });

  it.each([
    ['03/29/2026 02:30', null],
    ['10/25/2026 02:30', null],
    ['01/10/2026 11:43', '2026-01-10T10:43:00Z'],
    ['07/10/2026 11:43', '2026-07-10T09:43:00Z'],
  ])('preserves Malta timezone uncertainty and seasonal offsets for %s', (raw, instant) => {
    const $ = load(fixture());
    $('table[summary="履歴情報"] tr').eq(-2).children('td').eq(0).text(raw);
    const result = parse($.html(), NUMBER);
    expect(result.last_update).toBe(instant);
    expect(result.events?.[0].time ?? null).toBe(instant);
    expect(result.events?.[0].local_time).toEqual(expect.any(String));
  });

  it('recognizes explicit Japan country labels without using the office as timezone evidence', () => {
    const $ = load(fixture());
    const cells = $('table[summary="履歴情報"] tr').eq(-2).children('td');
    cells.eq(3).text('OSAKA');
    cells.eq(4).text('JAPAN');
    expect(parse($.html(), NUMBER).last_update).toBe('2026-09-04T02:43:00Z');
    cells.eq(4).empty();
    expect(parse($.html(), NUMBER).last_update).toBeNull();
  });

  it.each(['different', 'duplicate', 'missing', 'echo-only'])('rejects %s shipment identity', (mode) => {
    const $ = load(fixture());
    if (mode === 'different') $('table[summary="配達状況詳細"] td').first().text('CN123456785JP');
    if (mode === 'duplicate') $('body').append($('table[summary="配達状況詳細"]').clone());
    if (mode === 'missing' || mode === 'echo-only') $('table[summary="配達状況詳細"]').remove();
    if (mode === 'echo-only') $('body').prepend(`<input name="reqCodeNo1" value="${NUMBER}">`);
    expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('recognizes only an identity-bound official not-found result', () => {
    expect(() => parse(fixture('absent'), NUMBER)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    expect(() => parse(fixture('absent').replace(NUMBER, 'CN123456785JP'), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    expect(() => parse(fixture('absent').replace('Your item was not found.', 'Service unavailable.'), NUMBER))
      .toThrow(expect.objectContaining({ kind: 'schema' }));
    expect(() => parse(fixture('absent') + fixture(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['header', 'missing-row', 'missing-cell', 'bad-rowspan', 'bad-date', 'empty-status', 'empty-history', 'duplicate-history'])(
    'rejects %s schema drift rather than reporting stale progress', (mode) => {
      const $ = load(fixture());
      const history = $('table[summary="履歴情報"]');
      if (mode === 'header') history.find('th').eq(1).text('Changed header');
      if (mode === 'missing-row') history.find('tr').last().remove();
      if (mode === 'missing-cell') history.find('tr').eq(-2).children('td').last().remove();
      if (mode === 'bad-rowspan') history.find('tr').eq(-2).children('td').first().attr('rowspan', '3');
      if (mode === 'bad-date') history.find('tr').eq(-2).children('td').first().text('02/30/2026 11:43');
      if (mode === 'empty-status') history.find('tr').eq(-2).children('td').eq(1).empty();
      if (mode === 'empty-history') history.find('tr').filter((_, row) => $(row).children('td').length > 0).remove();
      if (mode === 'duplicate-history') $('body').append(history.clone());
      expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    },
  );

  it('keeps challenges and generic HTML separate from item absence', () => {
    expect(() => parse('<title>Just a moment...</title>', NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(() => parse('<html>Maintenance</html>', NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it.each([
    ['Item returned from import Customs', 'in_transit', 'in_transit'],
    ['Returned to sender', 'exception', 'returned'],
    ['Item out for physical delivery', 'out_for_delivery', 'out_for_delivery'],
    ['Final delivery', 'delivered', 'delivered'],
  ])('maps %s independently of previous events', (wording, status, stage) => {
    const result = parse(withLastStatus(wording), NUMBER);
    expect(result).toMatchObject({ status, current_stage: stage });
    expect(result.events?.at(-1)?.stage).toBe('accepted');
  });

  it.each(['Not delivered', 'Delivery expected tomorrow', 'New upstream wording'])('keeps unknown wording %s visible without invented progress', (wording) => {
    const result = parse(withLastStatus(wording), NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_status_text: wording });
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.[0].stage).toBeUndefined();
  });

  it('deduplicates exact scans and bounds returned history', () => {
    const $ = load(fixture());
    const history = $('table[summary="履歴情報"] tbody');
    const pair = history.children('tr').slice(-2);
    history.append(pair.clone());
    expect(parse($.html(), NUMBER).events).toHaveLength(5);
    for (let i = 0; i < 105; i++) {
      const event = pair.first().clone();
      event.children('td').eq(3).text(`Example office ${i}`);
      history.append(event, pair.last().clone());
    }
    const result = parse($.html(), NUMBER);
    expect(result.events).toHaveLength(100);
    expect(result.events?.[0].location).toBe('Example office 104, MALTA');
  });

  it('backs every declared capability with a synthetic fixture', () => {
    const result = parse(fixture(), NUMBER);
    const checks: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.some((event) => event.location)) };
    const capabilities = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')).capabilities as string[];
    for (const capability of capabilities) expect(checks[capability], capability).toBe(true);
  });
});

describe('Japan Post retrieval', () => {
  it('uses one fresh bounded GET per lookup without credentials or bootstrap', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(fixture()));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    expect(instance.id).toBe('japan-post');
    expect(instance.steps).toEqual(['direct']);
    await expect(instance.track({ number: 'cn 000.000-005 jp' })).resolves.toMatchObject({ status: 'delivered' });
    await instance.track({ number: NUMBER });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toBe(`https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${NUMBER}&locale=en`);
      expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
      expect(new Headers(init?.headers).has('Cookie')).toBe(false);
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each(['UL000000005JP', 'CN000000000JP', '12345', 'TRACK&reqCodeNo2=123', ''])('rejects unsupported input %s before I/O', async (number) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new JapanPostTracker({ fetcher }).fetch(number)).rejects.toMatchObject({ kind: 'input_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance'], [404, 'transport'], [410, 'transport']])(
    'does not confuse HTTP %s with item absence', async (status, kind) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Failure', { status: Number(status) }));
      await expect(new JapanPostTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('propagates pre-abort, in-flight cancellation and fractional deadline budgets', async () => {
    const unused = vi.fn<typeof fetch>();
    await expect(new JapanPostTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const abort = new AbortController();
    const cancelled = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      abort.abort();
      init?.signal?.throwIfAborted();
      return new Response(fixture());
    });
    await expect(new JapanPostTracker({ fetcher: cancelled }).fetch(NUMBER, { signal: abort.signal })).rejects.toThrow();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>((resolve) => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted();
      return new Response(fixture());
    });
    await expect(new JapanPostTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toMatchObject({ kind: 'transport' });
  });

  it('enforces the streaming response byte limit', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new JapanPostTracker({ fetcher }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
  });
});
