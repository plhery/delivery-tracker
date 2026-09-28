import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, parse, YanwenTracker, yanwenTrackingUrl } from './adapter';

const NUMBER = 'UK000000005YP';
const fixture = (name = 'delivered') => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8');

describe('Yanwen result projection', () => {
  it('binds both responsive result copies and reads per-scan GMT offsets', () => {
    const result = normalizeCarrierResult(parse(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: '2026-03-05T12:00:00+01:00',
      delivered_at: '2026-03-05T12:00:00+01:00', destination_country: 'IT', delivery_tracking_number: '6000000000001' });
    expect(result.events).toHaveLength(4);
    expect(result.events?.map((event) => event.stage)).toEqual(['delivered', 'out_for_delivery', 'in_transit', 'accepted']);
    expect(result.events?.at(-1)?.time).toBe('2026-03-02T14:00:00+08:00');
    expect(result.events?.[0].location).toBe('Example facility');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('requires actual result identity and rejects disagreeing responsive copies', () => {
    expect(() => parse(`<input value="${NUMBER}">${fixture().replaceAll(NUMBER, 'UK000000014YP')}`, NUMBER)).toThrow('different or ambiguous');
    const $ = load(fixture());
    $('.cx_lb').last().find('.cz_r h6').last().text('Different history');
    expect(() => parse($.html(), NUMBER)).toThrow('inconsistent');
    const duplicates = load(fixture());
    duplicates('.ny_cxjg').append(duplicates('input[name=wcdhA]').clone());
    expect(() => parse(duplicates.html(), NUMBER)).toThrow('ambiguous');
  });

  it('recognizes only the explicit identity-bound missing-item result', () => {
    expect(() => parse(fixture('not-found'), NUMBER)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    expect(() => parse(fixture('not-found').replaceAll('No information was found', 'Maintenance'), NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parse(fixture('not-found').replace('查询不到', '未知'), NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parse('<input id="numbers_en"><h1>YW TRACKING</h1>', NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['date', 'offset', 'empty', 'missing-timeline'])('rejects invalid %s instead of promoting earlier scans', (mode) => {
    const $ = load(fixture());
    if (mode === 'date') $('.czhaodl dt').first().text('2026-02-30');
    if (mode === 'offset') $('.timePoint').first().text('12:00:00 [GMT+unknown]');
    if (mode === 'empty') $('.cz_r').first().find('h6').last().empty();
    if (mode === 'missing-timeline') $('.czhaodl').first().remove();
    expect(() => parse($.html(), NUMBER)).toThrow();
  });

  it('uses actual scans instead of the summary status or progress rail', () => {
    const $ = load(fixture());
    $('.cz_r').each((_, element) => { const h = $(element).find('h6').last(); if (h.text().endsWith('Delivered.')) h.text('Expected delivery'); });
    const result = parse($.html(), NUMBER);
    expect(result.status).toBe('unknown');
    expect(result.events?.[0].stage).toBeUndefined();
    expect(result.delivered_at).toBeUndefined();
  });

  it('deduplicates identical scans and proves each declared capability', () => {
    const $ = load(fixture());
    $('.czhaodl dl').each((_, element) => { const dl = $(element); dl.append(dl.find('dd').last().clone()); });
    const result = parse($.html(), NUMBER);
    expect(result.events).toHaveLength(4);
    const checks: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.some((event) => event.location)), delivered_at: Boolean(result.delivered_at) };
    const metadata = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    for (const capability of metadata.capabilities) expect(checks[capability], capability).toBe(true);
  });
});

describe('Yanwen anonymous form retrieval', () => {
  it('uses the public browser signature with one fresh bounded form request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(fixture()));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    await expect(instance.track({ number: 'uk 000.000-005 yp' })).resolves.toMatchObject({ status: 'delivered' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://track.yw56.com.cn/en/querydel?nums=UK000000005YP&cyp=7cbe10bb0451c723ffac72e72cb79aa2');
    expect(yanwenTrackingUrl(NUMBER)).toBe(url);
    expect(init).toMatchObject({ method: 'POST', body: 'timeZone=1', cache: 'no-store', redirect: 'error' });
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited']])('classifies HTTP %s without treating it as shipment absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('failure', { status: Number(status) }));
    await expect(new YanwenTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported inputs before I/O, propagates cancellation and limits response size', async () => {
    const unused = vi.fn<typeof fetch>();
    await expect(new YanwenTracker({ fetcher: unused }).fetch('tracking&nums')).rejects.toThrow(TypeError);
    await expect(new YanwenTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new YanwenTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
  });
});
