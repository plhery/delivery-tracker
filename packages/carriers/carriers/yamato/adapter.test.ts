import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, normalizeYamatoNumber, parse, YamatoTracker } from './adapter';

const NUMBER = '123456789012';
const fixture = () => readFileSync(new URL('./fixtures/delivered.html', import.meta.url), 'utf8');

describe('Yamato parser', () => {
  it('retains current state and yearless history without making up timestamps', () => {
    const result = normalizeCarrierResult(parse(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: null, timezone: 'Asia/Tokyo' });
    expect(result.delivered_at).toBeUndefined();
    expect(result.events).toHaveLength(4);
    expect(result.events?.[0]).toEqual({ description: '配達完了', stage: 'delivered', location: 'Example delivery office', provider_time_text: '01月01日 18:48' });
    expect(result.events?.at(-1)).toMatchObject({ description: '荷物受付', stage: 'accepted', provider_time_text: '12月31日 16:43' });
    expect(result.events?.every((event) => event.time === undefined)).toBe(true);
    expect(result.expected_delivery).toBeUndefined();
    expect(result.events?.[1]).not.toHaveProperty('stage');
  });

  it('normalizes an explicitly supplied year in Japan without borrowing it for other rows', () => {
    const $ = load(fixture());
    $('.tracking-invoice-block-detail li').last().find('.date').text('2026年01月01日 18:48');
    const result = parse($.html(), NUMBER);
    expect(result.last_update).toBe('2026-01-01T09:48:00Z');
    expect(result.delivered_at).toBe('2026-01-01T09:48:00Z');
    expect(result.events?.slice(1).every((event) => event.time === undefined)).toBe(true);
  });

  it.each(['02月30日 10:00', '13月01日 10:00', '01月01日 25:00', '2025年02月29日 10:00', 'unknown'])('rejects invalid date %s', (date) => {
    expect(() => parse(fixture().replace('01月01日 18:48', date), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('keeps unknown current wording and each event mapping independent', () => {
    const html = fixture().replace('class="tracking-invoice-block-state-title">配達完了', 'class="tracking-invoice-block-state-title">New wording');
    expect(parse(html, NUMBER)).toMatchObject({ status: 'unknown', last_status_text: 'New wording' });
    expect(parse(html, NUMBER).current_stage).toBeUndefined();
    expect(parse(html, NUMBER).events?.[0].stage).toBe('delivered');
  });

  it.each([
    ['配達中', 'out_for_delivery', 'out_for_delivery'],
    ['配達準備中', 'in_transit', 'in_transit'],
    ['ご来店予定（保管中）', 'in_transit', 'ready_for_pickup'],
    ['保管中（ご指定店）', 'in_transit', 'ready_for_pickup'],
    ['引渡', 'in_transit', 'in_transit'],
    ['委託先引渡', 'in_transit', 'in_transit'],
    ['返品完了', 'exception', 'returned'],
  ])('maps the documented current label %s without completing an intermediary handoff', (wording, status, stage) => {
    const $ = load(fixture());
    $('.tracking-invoice-block-state-title').text(wording);
    $('.tracking-invoice-block-detail li').last().find('.item').text(wording);
    expect(parse($.html(), NUMBER)).toMatchObject({ status, current_stage: stage });
  });

  it('keeps a delivery after return dispatch on the return leg', () => {
    const $ = load(fixture());
    $('.tracking-invoice-block-detail li').eq(2).find('.item').text('返品');
    const result = parse($.html(), NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned' });
    expect(result.events?.[0]).toMatchObject({ stage: 'returned', provider_leg: 'return' });
    expect(result.events?.at(-1)?.stage).toBe('accepted');
    expect(result.delivered_at).toBeUndefined();
  });

  it.each([
    ['New return wording', 'unknown', undefined],
    ['持戻（休業）', 'exception', 'failed_attempt'],
  ])('retains return-leg evidence independently from current wording %s', (wording, status, stage) => {
    const $ = load(fixture());
    $('.tracking-invoice-block-detail li').eq(2).find('.item').text('返品');
    $('.tracking-invoice-block-detail li').last().find('.item').text(wording);
    $('.tracking-invoice-block-state-title').text(wording);
    const result = parse($.html(), NUMBER);
    expect(result.status).toBe(status); expect(result.current_stage).toBe(stage);
    expect(result.events?.[0]).toMatchObject({ description: wording, provider_leg: 'return' });
    expect(result.events?.[0].stage).toBe(stage);
    expect(result.delivered_at).toBeUndefined();
  });

  it('does not borrow an older dated scan for a yearless current return', () => {
    const $ = load(fixture());
    $('.tracking-invoice-block-detail li').first().find('.date').text('2025年12月31日 16:43');
    $('.tracking-invoice-block-detail li').eq(2).find('.item').text('返品');
    const result = parse($.html(), NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned', last_update: null });
    expect(result.events?.at(-1)?.time).toBe('2025-12-31T07:43:00Z');
    expect(result.events?.[0].time).toBeUndefined();
  });

  it.each(['wrong', 'duplicate', 'missing', 'input-only'])('rejects %s detail identity', (mode) => {
    const $ = load(fixture());
    if (mode === 'wrong') $('.tracking-invoice-block-title').text('1件目：9999-9999-9999');
    if (mode === 'duplicate') $('body').append($('.parts-tracking-invoice-block').clone());
    if (mode === 'missing' || mode === 'input-only') $('.tracking-invoice-block-title').remove();
    if (mode === 'input-only') $('body').prepend(`<input name="number01" value="${NUMBER}">`);
    expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('accepts only explicit identity-bound absence and preserves broken empty replies', () => {
    const $ = load(fixture());
    $('.tracking-invoice-block-detail').remove();
    expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    $('.tracking-invoice-block-state-title').text('伝票番号未登録');
    expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    $('.tracking-invoice-block-title').text('1件目：9999-9999-9999');
    expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('rejects contradictory missing-shipment states with positive history', () => {
    const $ = load(fixture());
    $('.tracking-invoice-block-state-title').text('伝票番号未登録');
    expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('rejects incomplete rows, challenges and generic HTML', () => {
    const $ = load(fixture());
    $('.tracking-invoice-block-detail li').last().find('.date').remove();
    expect(() => parse($.html(), NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    expect(() => parse('<title>Just a moment...</title>', NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(() => parse('<title>Maintenance</title>', NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('deduplicates exact rows and bounds returned history', () => {
    const $ = load(fixture());
    const list = $('.tracking-invoice-block-detail ol');
    const scan = list.children('li').last();
    list.append(scan.clone());
    expect(parse($.html(), NUMBER).events).toHaveLength(4);
    for (let i = 0; i < 105; i++) {
      const extra = scan.clone(); extra.find('.name').text(`Example office ${i}`); list.append(extra);
    }
    expect(parse($.html(), NUMBER).events).toHaveLength(100);
    expect(parse($.html(), NUMBER).events?.[0].location).toBe('Example office 104');
  });

  it('backs declared capabilities with synthetic data', () => {
    const capabilities = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')).capabilities as string[];
    const result = parse(fixture(), NUMBER);
    const checks: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.some((event) => event.location)) };
    for (const capability of capabilities) expect(checks[capability], capability).toBe(true);
  });
});

describe('Yamato retrieval', () => {
  it('uses one bounded form submission without session state per lookup', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(fixture()));
    const instance = adapter({ fetcher, recorder: NOOP_RECORDER, env: {}, trawl: null, browserExecutablePath: null });
    expect(instance.id).toBe('yamato'); expect(instance.steps).toEqual(['direct']);
    expect(normalizeYamatoNumber('1234-5678-9012')).toBe(NUMBER);
    await instance.track({ number: '1234-5678-9012' }); await instance.track({ number: NUMBER });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toBe('https://toi.kuronekoyamato.co.jp/cgi-bin/tneko');
      expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
      expect(String(init?.body)).toBe(`number00=1&number01=${NUMBER}`);
      expect(new Headers(init?.headers).has('cookie')).toBe(false);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each(['123', '1234567890123', 'ABC123456789', '123456789012&number02=123'])('rejects unsupported input %s before I/O', async (number) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new YamatoTracker({ fetcher }).fetch(number)).rejects.toMatchObject({ kind: 'input_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[403, 'challenge'], [429, 'rate_limited'], [404, 'transport'], [410, 'transport'], [503, 'maintenance']])('does not confuse HTTP %s with shipment absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Failure', { status: Number(status) }));
    await expect(new YamatoTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('propagates cancellation and enforces fractional budgets and streaming limits', async () => {
    const unused = vi.fn<typeof fetch>();
    await expect(new YamatoTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>((resolve) => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted(); return new Response(fixture());
    });
    await expect(new YamatoTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toMatchObject({ kind: 'transport' });
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new YamatoTracker({ fetcher: oversized }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
  });
});
