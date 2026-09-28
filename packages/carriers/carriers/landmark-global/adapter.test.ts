import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, LandmarkTracker } from './adapter';
import { normalizeLandmarkNumber, parseLandmark } from './parser';
import { landmarkStatus } from './status';

const NUMBER = 'LTN00000001N1';
const fixture = () => readFileSync(new URL('./fixtures/delivered.html', import.meta.url), 'utf8');
const negative = (number = NUMBER) => `<html><head><title>Landmark Global | Landmark Tracking</title></head><body><input id="search" value="${number}"><div class="error-text">We couldn't find a match for this value. Please try a different value.</div></body></html>`;

describe('Landmark Global history', () => {
  it('binds canonical parcel identity and retains local clocks without applying the current display offset', () => {
    const result = normalizeCarrierResult(parseLandmark(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', canonical_tracking_number: 'LTN00000001', last_update: null, last_update_local: '2026-01-04T12:00:00', expected_delivery: null, delivery_tracking_number: 'AA000000005AU', delivery_carrier: 'australia-post' });
    expect(result.events).toHaveLength(4); expect(result.events?.[0]).toMatchObject({ local_time: '2026-01-04T12:00:00', description: 'Delivered', location: 'Example City, EX' });
    expect(result).not.toHaveProperty('delivered_at'); expect(result.events?.some(event => event.time)).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|utc_server_offset|Australia"/);
    const metadata = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    const evidence: Record<string, boolean> = { history: !!result.events?.length, location: !!result.events?.some(event => event.location) };
    for (const capability of metadata.capabilities) expect(evidence[capability], capability).toBe(true);
  });
  it.each(['-360', '-300', '0', '330', 'INVALID'])('does not turn a current server offset %s into a historical instant', offset => {
    const $ = load(fixture()); $('#utc_server_offset').val(offset);
    expect(parseLandmark($.html(), NUMBER).events?.every(event => !event.time && event.local_time)).toBe(true);
  });
  it('accepts the canonical bare identity and rejects other identities and multi-parcel pages', () => {
    expect(parseLandmark(fixture(), 'LTN00000001')).not.toHaveProperty('canonical_tracking_number');
    const wrong = load(fixture()); wrong('.delivery-details-col h6').last().next('div').text('LTN00000002');
    const duplicate = load(fixture()); duplicate('.delivery-details-col').append('<h6>Landmark Tracking Number</h6><div>LTN00000001</div>');
    const twoTables = load(fixture()); twoTables('.event-table').append(twoTables('.event-table table').clone());
    for (const html of [wrong.html(), duplicate.html(), twoTables.html()]) expect(() => parseLandmark(html, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
  it('requires exact absence with the requested form identity and never treats challenges as not found', () => {
    expect(() => parseLandmark(negative(), NUMBER)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    for (const html of [negative('LTN00000002N1'), negative().replace("We couldn't find a match for this value. Please try a different value.", 'Unavailable'), '<html>Unavailable</html>']) {
      expect(() => parseLandmark(html, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
    expect(() => parseLandmark(negative().replace('Landmark Global | Landmark Tracking', 'Verify you are human'), NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
  });
  it('rejects latest-summary mismatches and malformed, absent or excessive history', () => {
    const wording = load(fixture()); wording('.current-status h3').text('Different');
    const date = load(fixture()); date('.current-status .time').attr('data-time', '2026-01-05 12:00:00');
    const empty = load(fixture()); empty('tbody').empty();
    for (const html of [wording.html(), date.html(), empty.html()]) expect(() => parseLandmark(html, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    const malformed = load(fixture()); malformed('tbody tr').eq(1).append('<td>Extra</td>');
    const excessive = load(fixture()); const row = excessive('tbody tr').first().toString(); excessive('tbody').html(row.repeat(501));
    for (const html of [malformed.html(), excessive.html()]) expect(() => parseLandmark(html, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
  it('retains incomplete or invalid newest clocks as provider text without borrowing older rows', () => {
    const $ = load(fixture()); $('.current-status .time,tbody tr:first-child .time').attr('data-time', '2026-02-30 12:00:00');
    const result = parseLandmark($.html(), NUMBER); expect(result.last_update).toBeNull(); expect(result.events?.[0]).toMatchObject({ provider_time_text: '2026-02-30 12:00:00' }); expect(result).not.toHaveProperty('delivered_at');
    $('.current-status .time,tbody tr:first-child .time').attr('data-time', 'Jan 4');
    expect(parseLandmark($.html(), NUMBER).events?.[0]).toMatchObject({ provider_time_text: 'Jan 4' });
  });
  it('preserves invalid local hours literally instead of rolling them into the next day', () => {
    const $ = load(fixture()); $('.current-status .time,tbody tr:first-child .time').attr('data-time', '2026-01-04 24:00:00');
    expect(parseLandmark($.html(), NUMBER).events?.[0]).toMatchObject({ provider_time_text: '2026-01-04 24:00:00' });
    expect(parseLandmark($.html(), NUMBER).events?.[0]).not.toHaveProperty('local_time');
  });
  it('uses only the actual newest wording, preserving unknown stages and completed delivery without summary coercion', () => {
    const $ = load(fixture()); const first = $('tbody tr').first(); first.find('td').first().text('Not delivered'); $('.current-status h3').text('Not delivered');
    expect(parseLandmark($.html(), NUMBER)).toMatchObject({ status: 'unknown', last_status_text: 'Not delivered' });
    expect(landmarkStatus('__proto__')).toBeUndefined();
    first.remove(); $('.current-status h3').text('Onboard for delivery'); $('.current-status .time').attr('data-time', $('tbody tr').first().find('.time').attr('data-time')!);
    expect(parseLandmark($.html(), NUMBER)).toMatchObject({ status: 'out_for_delivery' });
  });
  it('deduplicates repeated scans and excludes ambiguous delivery partner references', () => {
    const $ = load(fixture()); $('tbody').append($('tbody tr').first().clone());
    expect(parseLandmark($.html(), NUMBER).events).toHaveLength(4);
    $('.delivery-details-col').append('<h6>Delivery Partner</h6><div>Australia Post<form><input name="id" value="AA000000006AU"></form></div>');
    expect(parseLandmark($.html(), NUMBER)).not.toHaveProperty('delivery_tracking_number');
    for (let i = 0; i < 110; i++) { const row = $('tbody tr').first().clone(); row.find('td').last().text(`Example ${i}`); $('tbody').append(row); }
    expect(parseLandmark($.html(), NUMBER).events).toHaveLength(100);
  });
});

describe('Landmark direct retrieval', () => {
  it('uses one fresh anonymous GET without a bootstrap or API credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(fixture()));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
    await instance.track({ number: 'ltn-00000001 n1' }); await instance.track({ number: NUMBER }); expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [rawUrl, init] of fetcher.mock.calls) {
      const url = new URL(String(rawUrl)); expect(url.origin + url.pathname).toBe('https://track.landmarkglobal.com/');
      expect(Object.fromEntries(url.searchParams)).toEqual({ search: NUMBER, lang: 'en' });
      expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' }); expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).has('Authorization') || new Headers(init?.headers).has('Cookie')).toBe(false);
    }
    expect(normalizeLandmarkNumber('ltn00000001')).toBe('LTN00000001');
  });
  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])('keeps HTTP %s distinct from absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Failure', { status: Number(status) })); await expect(new LandmarkTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('bounds invalid inputs, cancellation, fractional deadlines and response size', async () => {
    const unused = vi.fn<typeof fetch>(); await expect(new LandmarkTracker({ fetcher: unused }).fetch(`${NUMBER}&search=other`)).rejects.toThrow(TypeError);
    await expect(new LandmarkTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow(); expect(unused).not.toHaveBeenCalled();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => { await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => resolve(), { once: true })); init?.signal?.throwIfAborted(); return new Response(''); });
    await expect(new LandmarkTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toThrow();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001))); await expect(new LandmarkTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
  });
});
