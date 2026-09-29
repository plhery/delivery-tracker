import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, GofoTracker } from './adapter';
import { normalizeGofoNumber, parseGofo } from './parser';
import { gofoStatus } from './status';

const NUMBER = 'GFUS00000000000001';
const OTHER = 'GFUS00000000000002';
const SHIPPER = 'AA-0000000000000000000-0';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const counterFixture = () => JSON.parse(readFileSync(new URL('./fixtures/public-counter.json', import.meta.url), 'utf8'));
const item = (value: ReturnType<typeof fixture>) => value.data.success[0];
const bind = (value: ReturnType<typeof fixture>) => { item(value).lastTrackEvent = { ...item(value).trackEventList[0] }; item(value).trackEventCount = item(value).trackEventList.length; };

describe('GOFO US history', () => {
  it('accepts a larger counter while the public list runs from label creation to the current summary', () => {
    const result = parseGofo(counterFixture(), NUMBER);
    expect(result.events).toHaveLength(14);
    expect(result).toMatchObject({ status: 'delivered', last_update: '2026-01-20T15:00:00-08:00', delivered_at: '2026-01-20T15:00:00-08:00' });
    expect(result.events?.[2]).toMatchObject({ description: 'Delivery Exception, Business Closed.', provider_code: '206' });
    expect(result.events?.at(-1)).toMatchObject({ stage: 'registered', time: '2026-01-14T04:30:00-08:00' });
    for (const field of ['processContent', 'processDeptId', 'processSecondCode', 'processTimeZone']) {
      const wrongSummary = counterFixture(); item(wrongSummary).lastTrackEvent[field] = 'Different';
      expect(() => parseGofo(wrongSummary, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const wrongIdentity = counterFixture(); item(wrongIdentity).trackEventList.at(-1).trackingNumber = OTHER;
    expect(() => parseGofo(wrongIdentity, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
  it('keeps a larger counter inconclusive when the list is cut at either end', () => {
    const oldest = counterFixture(); item(oldest).trackEventList.pop();
    const older = counterFixture(); item(older).trackEventList.splice(-5);
    const newest = counterFixture(); item(newest).trackEventList.splice(0, 2);
    for (const value of [oldest, older, newest]) expect(() => parseGofo(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    const counted = counterFixture(); item(counted).trackEventList.pop(); item(counted).trackEventCount = 13;
    expect(parseGofo(counted, NUMBER).events).toHaveLength(13);
  });
  it.each([undefined, '15', 3, 0, -1, 4.5, Number.NaN, Number.POSITIVE_INFINITY, 501])('rejects contradictory or unbounded public counter %s', count => {
    const value = fixture(); item(value).trackEventCount = count;
    expect(() => parseGofo(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
  });
  it('binds both identities and uses per-scan offsets without projecting private delivery text or unlabelled weight', () => {
    const result = normalizeCarrierResult(parseGofo(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: '2026-01-04T12:00:00-08:00', delivered_at: '2026-01-04T12:00:00-08:00', expected_delivery: null, destination_country: 'US' });
    expect(result.events).toHaveLength(4);
    expect(result.events?.[0]).toMatchObject({ time: result.last_update, description: 'Delivered', location: 'Example City, EX' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|weight|processDept|proof/);
    const metadata = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    const evidence: Record<string, boolean> = { history: !!result.events?.length, location: !!result.events?.some(event => event.location), delivered_at: !!result.delivered_at };
    for (const capability of metadata.capabilities) expect(evidence[capability], capability).toBe(true);
  });

  it('rejects mismatched, duplicate and per-scan identities', () => {
    const waybill = fixture(); item(waybill).waybillNo = OTHER;
    const tracking = fixture(); item(tracking).trackingNumber = OTHER;
    const duplicate = fixture(); duplicate.data.success.push(item(duplicate));
    const scan = fixture(); item(scan).trackEventList[1].trackingNumber = OTHER;
    for (const value of [null, {}, waybill, tracking, duplicate, scan]) expect(() => parseGofo(value, NUMBER)).toThrow();
  });

  it('binds the waybill when GOFO shows the shipper reference as the tracking number', () => {
    const value = fixture(); item(value).trackingNumber = SHIPPER; item(value).trackEventList[1].trackingNumber = SHIPPER;
    const result = parseGofo(value, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', delivered_at: '2026-01-04T12:00:00-08:00' });
    expect(JSON.stringify(result)).not.toContain(SHIPPER);
    for (const reference of [OTHER, 'gfus-0000 0000 0000 02', '', ' ', null, 42]) {
      const other = fixture(); item(other).trackingNumber = reference;
      expect(() => parseGofo(other, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
    const scan = fixture(); item(scan).trackingNumber = SHIPPER; item(scan).trackEventList[1].trackingNumber = NUMBER;
    expect(() => parseGofo(scan, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('requires the observed numeric envelope and exact US absence, keeping reroutes and empty replies uncertain', () => {
    const negative = { success: 1, code: 200, data: { success: [], error: { errorCount: 1, us: [NUMBER] } } };
    expect(() => parseGofo(negative, NUMBER)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    for (const error of [{ errorCount: 0 }, { errorCount: 1, us: [OTHER] }, { errorCount: 1, fr: [NUMBER] }, { errorCount: 1, us: [NUMBER], fr: [OTHER] }]) {
      expect(() => parseGofo({ ...negative, data: { success: [], error } }, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    }
    for (const success of [true, '1', 0]) { const value = fixture(); value.success = success; expect(() => parseGofo(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' })); }
  });

  it('rejects incomplete histories and summaries even when dates or descriptions coincide', () => {
    for (const field of ['processDate', 'processCode', 'processContent', 'processCity', 'processProvince']) {
      const value = fixture(); item(value).lastTrackEvent[field] = 'Different';
      expect(() => parseGofo(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const count = fixture(); item(count).trackEventCount--;
    const empty = fixture(); item(empty).trackEventList = []; bind(empty);
    for (const value of [count, empty]) expect(() => parseGofo(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    const excessive = fixture(); item(excessive).trackEventList = Array(501).fill(item(excessive).trackEventList[0]); bind(excessive);
    expect(() => parseGofo(excessive, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['2026-01-04T12:00:00+99:99', '2026-01-04T12:00:00+14:01', '2026-01-04T12:00:00+12:60', '2026-02-30T12:00:00Z', '2026-01-04T24:00:00Z'])('rejects invalid explicit clock %s', processDate => {
    const value = fixture(); item(value).trackEventList[0].processDate = processDate; bind(value);
    expect(() => parseGofo(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('reads the requested Pacific clocks and expresses each scan in its own zone', () => {
    const value = fixture();
    item(value).trackEventList[0].processTimeZone = 'America/New_York';
    item(value).trackEventList[1].processTimeZone = 'America/Denver';
    item(value).trackEventList[2].processTimeZone = 'PT';
    item(value).trackEventList[3].processTimeZone = 'US/Pacific'; bind(value);
    const result = parseGofo(value, NUMBER);
    expect(result).toMatchObject({ last_update: '2026-01-04T15:00:00-05:00', delivered_at: '2026-01-04T15:00:00-05:00' });
    expect(result.events?.map(event => event.time)).toEqual(['2026-01-04T15:00:00-05:00', '2026-01-04T09:00:00-07:00', '2026-01-03T18:00:00-08:00', '2026-01-01T12:00:00-08:00']);
    const summer = fixture(); Object.assign(item(summer).trackEventList[0], { processDate: '2026-08-10T13:58:30.000-0700', processTimeZone: 'America/Chicago' }); bind(summer);
    expect(parseGofo(summer, NUMBER).delivered_at).toBe('2026-08-10T15:58:30-05:00');
    for (const [processDate, time] of [['2026-11-01T01:30:00.000-0700', '2026-11-01T01:30:00-07:00'], ['2026-11-01T01:30:00.000-0800', '2026-11-01T01:30:00-08:00']]) {
      const repeated = fixture(); item(repeated).trackEventList[1].processDate = processDate;
      expect(parseGofo(repeated, NUMBER).events?.[1].time).toBe(time);
    }
    for (const processDate of ['2026-01-04T12:00:00.000-0700', '2026-08-10T16:58:30.000-0400', '2026-01-04T20:00:00Z']) {
      const shifted = fixture(); item(shifted).trackEventList[0].processDate = processDate; bind(shifted);
      expect(() => parseGofo(shifted, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('retains an unresolved newest clock without borrowing an older delivery or using a summary estimate', () => {
    const value = fixture(); item(value).trackEventList[0].processDate = '2026-01-04T12:00:00.000'; item(value).estimatedArrivalTime = '2026-01-08'; bind(value);
    const result = parseGofo(value, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', last_update: null, last_update_local: '2026-01-04T12:00:00', expected_delivery: null });
    expect(result.events?.[0]).not.toHaveProperty('time'); expect(result).not.toHaveProperty('delivered_at');
    item(value).trackEventList[0].processDate = 'Jan 4'; bind(value);
    expect(parseGofo(value, NUMBER).events?.[0]).toMatchObject({ provider_time_text: 'Jan 4' });
    item(value).trackEventList.shift(); bind(value);
    expect(parseGofo(value, NUMBER)).toMatchObject({ status: 'out_for_delivery', expected_delivery: null });
  });

  it('requires affirmative delivered wording and preserves unknown scans, equal clocks and provider order', () => {
    const negative = fixture(); item(negative).trackEventList[0].processContent = 'Not delivered'; bind(negative);
    expect(() => parseGofo(negative, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    const value = fixture(); item(value).trackEventList.unshift({ ...item(value).trackEventList[0], processCode: '__proto__', processContent: 'Awaiting review' }); bind(value);
    expect(parseGofo(value, NUMBER)).toMatchObject({ status: 'unknown', last_status_text: 'Awaiting review' });
    expect(parseGofo(value, NUMBER).events?.[1].description).toBe('Delivered');
    expect(gofoStatus('__proto__')).toBeUndefined();
    item(value).trackEventList.push(item(value).trackEventList[0]); bind(value);
    expect(parseGofo(value, NUMBER).events).toHaveLength(5);
    for (let i = 0; i < 110; i++) item(value).trackEventList.push({ ...item(value).trackEventList[0], processCity: `Example ${i}` }); bind(value);
    expect(parseGofo(value, NUMBER).events).toHaveLength(100);
  });
});

describe('GOFO direct retrieval', () => {
  it('uses one fresh anonymous US POST and passes the request signal', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(fixture())));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
    await instance.track({ number: 'gfus-00000000 000001' }); await instance.track({ number: NUMBER });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('https://www.gofo.com/us/cnee-api/consignee/track/query/page');
      expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
      expect(JSON.parse(String(init?.body))).toEqual({ numberList: [NUMBER] });
      const headers = new Headers(init?.headers); expect(headers.get('User-Time-Zone')).toBe('America/Los_Angeles');
      expect(headers.has('Cookie') || headers.has('Authorization')).toBe(false); expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(normalizeGofoNumber('gfus00000000000001')).toBe(NUMBER);
  });
  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])('keeps HTTP %s separate from absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Failure', { status: Number(status) }));
    await expect(new GofoTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind }); expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects invalid input, cancellation, oversized and malformed responses within a fractional budget', async () => {
    const unused = vi.fn<typeof fetch>();
    await expect(new GofoTracker({ fetcher: unused }).fetch(`${NUMBER}&other=1`)).rejects.toThrow(TypeError);
    await expect(new GofoTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow(); expect(unused).not.toHaveBeenCalled();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => { await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => resolve(), { once: true })); init?.signal?.throwIfAborted(); return new Response('{}'); });
    await expect(new GofoTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toThrow();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001))); await expect(new GofoTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Failure</html>')); await expect(new GofoTracker({ fetcher: malformed }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });
});
