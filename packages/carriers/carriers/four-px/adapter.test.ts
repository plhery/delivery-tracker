import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, FourPxTracker, parse } from './adapter';

const NUMBER = '4PX0000000000001CN';
const fixture = (name = 'delivered') => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('4PX result projection', () => {
  it('binds the parcel and uses the displayed clock with its per-scan offset', () => {
    const result = normalizeCarrierResult(parse(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: '2026-03-28T14:30:03-04:00',
      delivered_at: '2026-03-28T14:30:03-04:00', destination_country: 'US', delivery_tracking_number: '4200000000000000000000000000000001' });
    expect(result.events).toHaveLength(26);
    expect(result.events?.[1].stage).toBe('out_for_delivery');
    expect(result.events?.at(-1)).toMatchObject({ stage: 'registered', time: '2026-03-03T14:30:03+08:00' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(result.timezone).toBeUndefined();
  });

  it('retains clock uncertainty and provider order when an offset is absent', () => {
    const payload = fixture();
    payload.data[0].tracks[0].tkTimezone = null;
    const result = parse(payload, NUMBER);
    expect(result.last_update).toBeNull();
    expect(result.events?.[0]).toMatchObject({ local_time: '2026-03-28T14:30:03' });
    expect(result.events?.[0].time).toBeUndefined();
    expect(result.delivered_at).toBeUndefined();
  });

  it('requires an exact unique identity rather than trusting the first parcel', () => {
    const payload = fixture();
    payload.data[0].queryCode = '4PX0000000000002CN';
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    payload.data[0].queryCode = NUMBER;
    payload.data.push(payload.data[0]);
    expect(() => parse(payload, NUMBER)).toThrow('ambiguous');
  });

  it('recognizes only the explicit missing-item signature', () => {
    expect(() => parse(fixture('not-found'), NUMBER)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    const payload = fixture();
    payload.data[0].tracks = [];
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    payload.data[0].status = 7;
    payload.data[0].tracks = null;
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parse({ result: 0, data: [] }, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('rejects multi-package summaries and invalid scans rather than promoting an older event', () => {
    const payload = fixture();
    payload.data[0].mutiPackage = true;
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    payload.data[0].mutiPackage = false;
    payload.data[0].tracks[0].tkDateStr = '2026-02-30 10:00:00';
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    payload.data[0].tracks[0].tkDateStr = '2026-03-01 10:00:00';
    payload.data[0].tracks[0].tkDesc = '';
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('leaves new event codes unmapped and deduplicates repeated scans', () => {
    const payload = fixture();
    payload.data[0].tracks[0].tkCode = 'FPX_NEW';
    payload.data[0].tracks.push(payload.data[0].tracks[0]);
    const result = parse(payload, NUMBER);
    expect(result).toMatchObject({ status: 'unknown', events: expect.any(Array) });
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.[0].stage).toBeUndefined();
    expect(result.events).toHaveLength(26);
  });

  it('proves the declared capabilities using the synthetic response', () => {
    const result = parse(fixture(), NUMBER);
    const checks: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.some((event) => event.location)), delivered_at: Boolean(result.delivered_at) };
    const metadata = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    for (const capability of metadata.capabilities) expect(checks[capability], capability).toBe(true);
  });
});

describe('4PX retrieval', () => {
  it('makes one fresh anonymous bounded request and records the direct step', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(fixture())));
    const recorder = { ...NOOP_RECORDER, step: vi.fn(), lookup: vi.fn() };
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder });
    await instance.track({ number: '4px 0000000000001 cn' });
    await instance.track({ number: NUMBER });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://track.4px.com/track/v2/front/listTrackV3');
    expect(JSON.parse(String(init?.body))).toEqual({ queryCodes: [NUMBER], language: 'en-us', translateLanguage: '' });
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(recorder.step).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'four-px', step: 'direct', outcome: 'ok' }));
  });

  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])('classifies HTTP %s separately from a missing parcel', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('failure', { status: Number(status) }));
    await expect(new FourPxTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('enforces size and budget limits and propagates cancellation', async () => {
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new FourPxTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>((resolve) => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted();
      return new Response('{}');
    });
    await expect(new FourPxTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 10.5 })).rejects.toMatchObject({ kind: 'transport' });
    const unused = vi.fn<typeof fetch>();
    await expect(new FourPxTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    await expect(new FourPxTracker({ fetcher: unused }).fetch('bad&query=number')).rejects.toThrow(TypeError);
    expect(unused).not.toHaveBeenCalled();
  });
});
