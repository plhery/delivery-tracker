import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, YtoTracker } from './adapter';
import { normalizeYtoNumber, parseYto } from './parser';

const NUMBER = 'YT0000000000001';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));

describe('YTO domestic parser', () => {
  it('returns identity-bound scans in China time and excludes expanded private details', () => {
    const result = normalizeCarrierResult(parseYto(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', timezone: 'Asia/Shanghai',
      last_update: '2026-01-03T18:00:00+08:00', delivered_at: '2026-01-03T18:00:00+08:00' });
    expect(result.events).toHaveLength(6);
    expect(result.events?.map(event => event.stage)).toEqual(['delivered', 'ready_for_pickup', 'out_for_delivery', 'in_transit', 'in_transit', 'accepted']);
    expect(result.events?.[0]).toMatchObject({ description: 'Delivered', provider_code: '745', location: 'Example destination depot' });
    expect(JSON.stringify(result)).not.toMatch(/13000000000|Private synthetic|Example recipient|Synthetic address|signPic|weight/);
  });

  it.each(['wrong', 'echo-only', 'duplicate', 'mixed-row'])('rejects %s identity evidence', mode => {
    const value = fixture();
    if (mode === 'wrong') value[0].waybillNo = 'YT9999999999999';
    if (mode === 'echo-only') { value[0].requested = NUMBER; delete value[0].waybillNo; }
    if (mode === 'duplicate') value.push(value[0]);
    if (mode === 'mixed-row') value[0].waybillProcessInfo[0].waybillNo = 'YT9999999999999';
    expect(() => parseYto(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('keeps empty or archived replies indeterminate rather than inventing absence', () => {
    for (const value of [[], [{ waybillNo: NUMBER }], [{ waybillNo: NUMBER, waybillProcessInfo: [] }]]) {
      expect(() => parseYto(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    }
    for (const value of [null, {}, [{ waybillNo: NUMBER, waybillProcessInfo: {} }]]) {
      expect(() => parseYto(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('retains return dispatch through subsequent movement, pickup and signature scans', () => {
    const value = fixture();
    value[0].waybillProcessInfo.splice(4, 0, { ...value[0].waybillProcessInfo[4],
      opCode: '835', opName: '退回件扫描', opTime: '2026-01-02 19:00:00', ioTypeName: '退回一次' });
    const result = parseYto(value, NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned' });
    expect(result.delivered_at).toBeUndefined();
    expect(result.events?.slice(0, 5).map(event => event.stage)).toEqual(['returned', 'ready_for_pickup', 'out_for_delivery', 'in_transit', 'exception']);
    expect(result.events?.slice(0, 5).every(event => event.provider_leg === 'return')).toBe(true);
    expect(result.events?.slice(5).every(event => event.provider_leg === undefined)).toBe(true);
  });

  it('keeps return transit open until confirmed sender delivery', () => {
    const value = fixture();
    value[0].waybillProcessInfo.splice(4, 0, { ...value[0].waybillProcessInfo[4],
      opCode: '835', opName: '退回件扫描', opTime: '2026-01-02 19:00:00' });
    value[0].waybillProcessInfo.shift();
    expect(parseYto(value, NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'ready_for_pickup' });
    value[0].waybillProcessInfo.shift();
    expect(parseYto(value, NUMBER)).toMatchObject({ status: 'out_for_delivery', current_stage: 'out_for_delivery' });
    value[0].waybillProcessInfo.shift();
    expect(parseYto(value, NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'in_transit' });
    value[0].waybillProcessInfo.shift();
    expect(parseYto(value, NUMBER)).toMatchObject({ status: 'exception', current_stage: 'exception', last_status_text: 'Return to the sender started' });
  });

  it.each(['return-type', 'signature'])('recognizes explicit %s return evidence without exposing its description', mode => {
    const value = fixture();
    if (mode === 'return-type') value[0].waybillProcessInfo[0].ioTypeName = '退回一次';
    else value[0].waybillProcessInfo[0].description = '您的快件已投递，收件人: 退回。Private synthetic courier 13000000000';
    const result = parseYto(value, NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned' });
    expect(result.events?.[0]).toMatchObject({ stage: 'returned', provider_leg: 'return' });
    expect(result.delivered_at).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/13000000000|Private synthetic/);
  });

  it('does not treat arrival at a collection point or station dispatch as recipient delivery', () => {
    const value = fixture(); value[0].waybillProcessInfo.shift();
    expect(parseYto(value, NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'ready_for_pickup' });
    value[0].waybillProcessInfo[0].extTrack.signType = '1';
    expect(parseYto(value, NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'in_transit' });
    expect(parseYto(value, NUMBER).delivered_at).toBeUndefined();
  });

  it('leaves unknown operations unmapped even when earlier history was delivered', () => {
    const value = fixture();
    value[0].waybillProcessInfo.unshift({ ...value[0].waybillProcessInfo[0], opCode: 'NEW', opName: 'New operation', opTime: '2026-01-04 10:00:00' });
    const result = parseYto(value, NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_status_text: 'New operation' });
    expect(result.current_stage).toBeUndefined(); expect(result.events?.[0].stage).toBeUndefined();
    expect(result.delivered_at).toBeUndefined();
  });

  it.each(['2026-02-30 18:00:00', '2026-01-03', '2026-01-03 25:00:00', 'unknown', ''])('keeps clock uncertainty %s without borrowing an older scan instant', clock => {
    const value = fixture(); value[0].waybillProcessInfo[0].opTime = clock;
    const result = parseYto(value, NUMBER);
    expect(result.last_update).toBeNull(); expect(result.delivered_at).toBeUndefined();
    expect(result.events?.[0].time).toBeUndefined();
    expect(result.events?.[0].provider_time_text).toBe(clock || undefined);
    expect(result.events?.[1].time).toBe('2026-01-03T12:00:00+08:00');
  });

  it.each([null, {}, { waybillNo: NUMBER, opCode: '745' }])('rejects malformed scans %s without dropping them', scan => {
    const value = fixture(); value[0].waybillProcessInfo.unshift(scan);
    expect(() => parseYto(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('deduplicates exact rows and bounds output while preserving the newest evidence', () => {
    const value = fixture(); value[0].waybillProcessInfo.push(value[0].waybillProcessInfo[0]);
    const deduplicated = parseYto(value, NUMBER);
    expect(deduplicated.events).toHaveLength(6);
    expect(deduplicated.current_stage).toBe('delivered');
    expect(deduplicated.events?.[0].provider_code).toBe('745');
    expect(deduplicated.events?.[0].time).toBe('2026-01-03T18:00:00+08:00');
    for (let i = 0; i < 110; i++) value[0].waybillProcessInfo.unshift({ ...value[0].waybillProcessInfo[0], opOrgName: `Example depot ${i}` });
    expect(parseYto(value, NUMBER).events).toHaveLength(100);
    expect(parseYto(value, NUMBER).events?.[0].location).toBe('Example depot 109');
    value[0].waybillProcessInfo = Array.from({ length: 1001 }, () => value[0].waybillProcessInfo[0]);
    expect(() => parseYto(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('backs the declared capabilities with synthetic history', () => {
    const capabilities = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')).capabilities as string[];
    const result = parseYto(fixture(), NUMBER);
    const supported: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.some(event => event.location)) };
    for (const capability of capabilities) expect(supported[capability], capability).toBe(true);
  });
});

describe('YTO domestic retrieval', () => {
  it('uses the actual anonymous JSON-array request without session bootstrap', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(fixture())));
    const instance = adapter({ fetcher, recorder: NOOP_RECORDER, env: {}, trawl: null, browserExecutablePath: null });
    expect(instance.id).toBe('yto'); expect(instance.steps).toEqual(['direct']);
    expect(normalizeYtoNumber('yt-0000000000001')).toBe(NUMBER);
    await instance.track({ number: NUMBER }); await instance.track({ number: NUMBER });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('https://www.yto.net.cn/ec/order/gwWaybillInfoList');
      expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error', body: JSON.stringify([NUMBER]) });
      const headers = new Headers(init?.headers);
      expect(headers.get('Content-Type')).toBe('application/json'); expect(headers.get('source')).toBe('PC');
      expect(headers.has('Cookie')).toBe(false); expect(headers.has('jwt-token')).toBe(false);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each(['123', 'YT0000000000001,OTHER', 'YT0000000000001&query=OTHER'])('rejects invalid input %s before I/O', async number => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new YtoTracker({ fetcher }).fetch(number)).rejects.toMatchObject({ kind: 'input_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[401, 'challenge'], [403, 'challenge'], [404, 'transport'], [410, 'transport'], [429, 'rate_limited'], [503, 'maintenance']])('keeps endpoint HTTP %s separate from parcel absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Failure', { status: Number(status) }));
    await expect(new YtoTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
  });

  it('propagates cancellation, fractional deadlines and streaming limits', async () => {
    const unused = vi.fn<typeof fetch>();
    await expect(new YtoTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted(); return new Response(JSON.stringify(fixture()));
    });
    await expect(new YtoTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toThrow();
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new YtoTracker({ fetcher: oversized }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
  });
});
