import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, YundaTracker } from './adapter';
import { solveYundaSlider } from './challenge';
import { normalizeYundaNumber, parseYunda } from './parser';
import { yundaStatus } from './status';

const NUMBER = '0000000000001';
const OTHER = '0000000000002';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const challenge = () => JSON.parse(readFileSync(new URL('./fixtures/challenge.json', import.meta.url), 'utf8'));
const rows = (value: ReturnType<typeof fixture>) => value.data.logistic[NUMBER].gn;
const png = async (pixels: Buffer, width: number, height: number) => (await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer()).toString('base64');

describe('Yunda domestic history', () => {
  it('binds every scan, reads China time, preserves partial history and excludes private prose', () => {
    const result = normalizeCarrierResult(parseYunda(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', timezone: 'Asia/Shanghai',
      last_update: '2026-01-03T18:00:00+08:00', delivered_at: '2026-01-03T18:00:00+08:00' });
    expect(result.events?.map(event => event.stage)).toEqual(['delivered', 'ready_for_pickup', 'out_for_delivery', 'in_transit', 'accepted']);
    expect(result.events?.[0]).toMatchObject({ description: 'Delivered', provider_code: '已签收', location: '示例市' });
    expect(JSON.stringify(result)).not.toMatch(/Private synthetic|13000000000|Synthetic address|weight|qianshou/);
    const declared = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')).capabilities as string[];
    const evidence: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.some(event => event.location)) };
    for (const capability of declared) expect(evidence[capability], capability).toBe(true);
  });

  it.each(['order-map', 'history-map', 'mixed-scan', 'missing-scan', 'extra-result'])('rejects %s identity ambiguity', mode => {
    const value = fixture();
    if (mode === 'order-map') { value.data.order[OTHER] = value.data.order[NUMBER]; delete value.data.order[NUMBER]; }
    if (mode === 'history-map') { value.data.logistic[OTHER] = value.data.logistic[NUMBER]; delete value.data.logistic[NUMBER]; }
    if (mode === 'mixed-scan') rows(value)[0].mailNo = OTHER;
    if (mode === 'missing-scan') delete rows(value)[0].mailNo;
    if (mode === 'extra-result') value.data.logistic[OTHER] = value.data.logistic[NUMBER];
    expect(() => parseYunda(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('keeps empty maps, order echoes and absent domestic scans inconclusive', () => {
    for (const data of [{ order: [], logistic: [] }, { order: { [NUMBER]: {} }, logistic: {} },
      { order: {}, logistic: { [NUMBER]: { gn: [], gj: [] } } },
      { order: {}, logistic: { [NUMBER]: { gn: [], gj: [{ status: 'International' }] } } }]) {
      expect(() => parseYunda({ code: 200, data }, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    }
    for (const code of [404, 500]) expect(() => parseYunda({ code, msg: 'Failure' }, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parseYunda({ code: 401, msg: '校验失败' }, NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(() => parseYunda({ code: 400, msg: '验证码错误' }, NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
  });

  it.each([null, {}, { code: '200' }, { code: 200, data: null }, { code: 200, data: { order: [1], logistic: [] } }])('rejects malformed envelope %s', value => {
    expect(() => parseYunda(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['NEW', '__proto__', 'constructor', 'toString'])('keeps unrecognized label %s unknown', label => {
    const value = fixture(); rows(value).at(-1).status = label;
    const result = normalizeCarrierResult(parseYunda(value, NUMBER));
    expect(yundaStatus(label)).toBeNull();
    expect(result).toMatchObject({ status: 'unknown', last_status_text: label });
    expect(result).not.toHaveProperty('current_stage'); expect(result).not.toHaveProperty('delivered_at');
    expect(result.events?.[0]).not.toHaveProperty('stage');
  });

  it.each(['2026-02-30 18:00:00', '2026-01-03', '2026-01-03 25:00:00', 'unknown', ''])('keeps newest unresolved clock %s without borrowing an older instant', clock => {
    const value = fixture(); rows(value).at(-1).scanTm = clock;
    const result = parseYunda(value, NUMBER);
    expect(result.last_update).toBeNull(); expect(result.delivered_at).toBeUndefined();
    expect(result.events?.[0].time).toBeUndefined(); expect(result.events?.[0].provider_time_text).toBe(clock || undefined);
    expect(result.events?.[1].time).toBe('2026-01-03T12:00:00+08:00');
  });

  it('keeps return movement active and only sender delivery terminal', () => {
    const value = fixture(); rows(value)[1].trackRecord = '【示例市】退回件扫描';
    const returned = parseYunda(value, NUMBER);
    expect(returned).toMatchObject({ status: 'exception', current_stage: 'returned' });
    expect(returned).not.toHaveProperty('delivered_at');
    expect(returned.events?.map(event => event.stage)).toEqual(['returned', 'ready_for_pickup', 'out_for_delivery', 'in_transit', 'accepted']);
    expect(returned.events?.slice(0, 4).every(event => event.provider_leg === 'return')).toBe(true);
    rows(value).pop();
    expect(parseYunda(value, NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'ready_for_pickup' });
    rows(value).pop();
    expect(parseYunda(value, NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'out_for_delivery' });
    rows(value).pop();
    expect(parseYunda(value, NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'in_transit' });
  });

  it('recognizes an explicit sender signature without treating boilerplate return advice as a leg', () => {
    const value = fixture(); rows(value).at(-1).trackRecord = '【示例市】签收人是寄件人';
    expect(parseYunda(value, NUMBER).current_stage).toBe('returned');
    rows(value).at(-1).trackRecord = '【示例市】如需退回请联系派件员';
    expect(parseYunda(value, NUMBER).current_stage).toBe('delivered');
    rows(value).at(-1).trackRecord = 'Contact courier at Private synthetic address';
    expect(parseYunda(value, NUMBER).events?.[0]).not.toHaveProperty('location');
  });

  it('rejects malformed history and bounds output while retaining newest duplicates', () => {
    for (const row of [null, {}, { mailNo: NUMBER, status: '' }]) {
      const value = fixture(); rows(value).push(row);
      expect(() => parseYunda(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
    const value = fixture(); rows(value).unshift(rows(value).at(-1));
    expect(parseYunda(value, NUMBER).events).toHaveLength(5);
    expect(parseYunda(value, NUMBER).current_stage).toBe('delivered');
    for (let i = 0; i < 110; i++) rows(value).push({ ...rows(value).at(-1), status: `Unknown ${i}` });
    expect(parseYunda(value, NUMBER).events).toHaveLength(100);
    expect(parseYunda(value, NUMBER).last_status_text).toBe('Unknown 109');
    value.data.logistic[NUMBER].gn = Array(1001).fill(rows(value)[0]);
    expect(() => parseYunda(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
});

describe('Yunda bounded verification', () => {
  it('matches a synthetic transparent outline in native coordinates', async () => {
    await expect(solveYundaSlider(challenge().data)).resolves.toEqual({ x: 80, y: 40 });
  });

  it('does not submit a guessed coordinate for a missing or ambiguous gap', async () => {
    const value = challenge().data;
    const big = Buffer.alloc(344 * 152 * 4, 255);
    value.big = await png(big, 344, 152);
    await expect(solveYundaSlider(value)).rejects.toMatchObject({ kind: 'challenge' });
    for (let i = 0; i < big.length; i += 4) big.set([70, 90, 110, 255], i);
    value.big = await png(big, 344, 152);
    await expect(solveYundaSlider(value)).rejects.toMatchObject({ kind: 'challenge' });
  });

  it('supports the deployed x=300 boundary but rejects the client-excluded right edge', async () => {
    const value = challenge().data;
    const small = await sharp(Buffer.from(value.small, 'base64')).ensureAlpha().raw().toBuffer();
    const big = Buffer.alloc(344 * 152 * 4);
    const at = async (x: number) => {
      for (let i = 0; i < big.length; i += 4) big.set([70, 90, 110, 255], i);
      for (let row = 0; row < 40; row++) for (let col = 0; col < 40; col++) {
        if (small[(row * 40 + col) * 4 + 3] > 127) big.set([255, 255, 255, 255], ((row + value.y) * 344 + x + col) * 4);
      }
      return { ...value, big: await png(big, 344, 152) };
    };
    await expect(solveYundaSlider(await at(300))).resolves.toEqual({ x: 300, y: 40 });
    await expect(solveYundaSlider(await at(304))).rejects.toMatchObject({ kind: 'challenge' });
  });

  it.each([null, {}, { y: -1 }, { y: 113 }, { y: 1.5 }, { y: 40, big: 'not-png', small: 'AA==' }])('rejects malformed challenge %s', value => {
    return expect(solveYundaSlider(value)).rejects.toMatchObject({ kind: 'schema' });
  });

  it('rejects changed image geometry, oversized input and cancellation', async () => {
    const value = challenge().data;
    value.small = await png(Buffer.alloc(41 * 40 * 4), 41, 40);
    await expect(solveYundaSlider(value)).rejects.toMatchObject({ kind: 'challenge' });
    value.big = 'A'.repeat(700_001);
    await expect(solveYundaSlider(value)).rejects.toMatchObject({ kind: 'schema' });
    await expect(solveYundaSlider(challenge().data, AbortSignal.abort())).rejects.toThrow();
  });
});

describe('Yunda anonymous retrieval', () => {
  const transport = () => vi.fn<typeof fetch>().mockImplementation(async url => {
    if (String(url).includes('/captcha_type?')) {
      const response = new Response(JSON.stringify({ code: 200, data: 1 }), { headers: { 'Set-Cookie': 'PHPSESSID=synthetic-session; Path=/; Secure' } });
      Object.defineProperty(response, 'url', { value: String(url) }); return response;
    }
    if (String(url).includes('/captcha?')) return new Response(JSON.stringify(challenge()));
    return new Response(JSON.stringify(fixture()));
  });

  it('signs the actual three-request session and validates backend acceptance', async () => {
    const fetcher = transport();
    const instance = adapter({ fetcher, recorder: NOOP_RECORDER, env: {}, trawl: null, browserExecutablePath: null });
    expect(instance.id).toBe('yunda'); expect(instance.steps).toEqual(['direct']);
    expect(normalizeYundaNumber('000-0000000001')).toBe(NUMBER);
    await instance.track({ number: NUMBER }); await instance.track({ number: NUMBER });
    expect(fetcher).toHaveBeenCalledTimes(6);
    for (let offset = 0; offset < 6; offset += 3) {
      const [type, captcha, search] = fetcher.mock.calls.slice(offset, offset + 3);
      const parameters = new URL(String(type[0])).searchParams;
      expect(parameters.get('wid')).toBe('22');
      const signed = createHash('md5').update(createHash('sha1').update(parameters.get('randomStr') + '2024YdWeb' + parameters.get('timeStamp')).digest('hex')).digest('hex').toUpperCase();
      expect(parameters.get('signature')).toBe(signed);
      expect(new Headers(type[1]?.headers).has('Cookie')).toBe(false);
      expect(String(captcha[0])).toContain('/index.php/api/order.record/captcha?');
      expect(new Headers(captcha[1]?.headers).get('Cookie')).toBe('PHPSESSID=synthetic-session');
      expect(search[0]).toBe('https://web.yundaex.com/index.php/api/v2.record/search');
      // fetch-cookie implements the original redirect:error policy by asking
      // the injected transport for a manual response before inspecting it.
      expect(search[1]).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'manual' });
      const body = search[1]?.body as FormData;
      expect(Object.fromEntries(body)).toEqual({ ...Object.fromEntries(parameters), x: '80', y: '40', tm: NUMBER });
      expect(new Headers(search[1]?.headers).get('Cookie')).toBe('PHPSESSID=synthetic-session');
      expect(search[1]?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('randomStr')).not.toBe(new URL(String(fetcher.mock.calls[3][0])).searchParams.get('randomStr'));
  });

  it('never follows a session redirect to another site', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 302, headers: { Location: 'https://example.invalid/login' } }));
    await expect(new YundaTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'transport' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['123', '7700000000001', '7600000000001', '0000000000001,OTHER'])('rejects unsupported number %s before I/O', async number => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new YundaTracker({ fetcher }).fetch(number)).rejects.toMatchObject({ kind: 'input_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops on unsupported verification, uncertainty or backend rejection with no candidate retry', async () => {
    const unsupported = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code: 200, data: 2 })));
    await expect(new YundaTracker({ fetcher: unsupported }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'challenge' });
    expect(unsupported).toHaveBeenCalledTimes(1);
    const rejected = transport().mockImplementationOnce(async () => new Response(JSON.stringify({ code: 200, data: 1 })))
      .mockImplementationOnce(async () => new Response(JSON.stringify(challenge())))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ code: 401, msg: '验证失败' })));
    await expect(new YundaTracker({ fetcher: rejected }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'challenge' });
    expect(rejected).toHaveBeenCalledTimes(3);
  });

  it.each([[401, 'challenge'], [403, 'challenge'], [404, 'transport'], [410, 'transport'], [429, 'rate_limited'], [503, 'maintenance']])('keeps HTTP %s separate from absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Failure', { status: Number(status) }));
    await expect(new YundaTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
  });

  it('propagates cancellation, fractional deadlines and response limits', async () => {
    const unused = vi.fn<typeof fetch>();
    await expect(new YundaTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted(); return new Response('{}');
    });
    await expect(new YundaTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toThrow();
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new YundaTracker({ fetcher: oversized }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
  });
});
