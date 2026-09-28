import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { TrawlClient, type TrawlScrapeResponse } from '../../core/transport';
import { adapter, parse, parseCaptured, YunExpressTracker } from './adapter';

const NUMBER = 'YT0000000000000001';
const API = 'https://services.yuntrack.com/Track/Query';
const fixture = (name = 'in-transit') => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const captured = (body = fixture()): TrawlScrapeResponse => ({ url: 'https://www.yuntrack.com/parcelTracking', html: '<div>Tracking results</div>', tier: 2,
  statusCode: 200, userAgent: null, cookies: [], raw: {}, capturedResponses: [{ url: API, status: 200, headers: {}, body: JSON.stringify(body), base64Encoded: false, truncated: false, error: null }] });

describe('YunExpress captured response projection', () => {
  it('binds both result identities and preserves per-event clock evidence', () => {
    const result = normalizeCarrierResult(parse(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'in_transit', current_stage: 'customs', last_update: '2026-03-20T13:39:00-04:00',
      destination_country: 'US', delivery_tracking_number: '9000000000000000000001' });
    expect(result.events).toHaveLength(14);
    expect(result.events?.[0]).toMatchObject({ time: '2026-03-20T13:39:00-04:00', location: 'Example facility' });
    expect(result.events?.[1]).toMatchObject({ local_time: '2026-03-19T13:39:00' });
    expect(result.events?.[1].time).toBeUndefined();
    expect(result.events?.at(-1)?.stage).toBe('registered');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('requires the latest offset record to match that exact scan', () => {
    const payload = fixture();
    payload.ResultList[0].TrackInfo.LastTrackEvent.ProcessContent = 'Different description';
    const result = parse(payload, NUMBER);
    expect(result.last_update).toBeNull();
    expect(result.events?.[0]).toMatchObject({ local_time: '2026-03-20T13:39:00' });
    expect(result.events?.[0].time).toBeUndefined();
  });

  it('maps an explicit delivered latest-event code without promoting earlier partner scans', () => {
    const payload = fixture();
    const item = payload.ResultList[0];
    item.Status = item.TrackInfo.TrackingStatus = item.TrackInfo.LastTrackEvent.TrackingStatus = 50;
    item.TrackInfo.LastTrackEvent.ProcessContent = 'Delivered by Mailbox, synthetic delivery note';
    item.TrackData.ProcessGroupList[0].ProcessDetailList[0].ProcessContent = 'Delivered by Mailbox, synthetic delivery note----Example facility';
    const result = parse(payload, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', delivered_at: '2026-03-20T13:39:00-04:00' });
    expect(result.events?.[1].stage).toBe('in_transit');
    item.TrackInfo.LastTrackEvent.ProcessContent = 'Different description';
    expect(parse(payload, NUMBER).status).toBe('unknown');
  });

  it('requires a unique returned number and matching waybill identity', () => {
    const payload = fixture();
    payload.ResultList[0].TrackInfo.WaybillNumber = 'YT0000000000000002';
    expect(() => parse(payload, NUMBER)).toThrow('identity');
    payload.ResultList[0].TrackInfo.WaybillNumber = NUMBER;
    payload.ResultList.push(payload.ResultList[0]);
    expect(() => parse(payload, NUMBER)).toThrow('ambiguous');
  });

  it('recognizes only explicit missing-item records and separates interactive verification', () => {
    expect(() => parse(fixture('not-found'), NUMBER)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    const payload = fixture();
    payload.ResultList[0].TrackData.ProcessGroupList = [];
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parse({ Code: 1003 }, NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(() => parse({ ResultList: [] }, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['date', 'description', 'group'])('rejects invalid latest %s instead of promoting older progress', (mode) => {
    const payload = fixture();
    const groups = payload.ResultList[0].TrackData.ProcessGroupList;
    if (mode === 'date') groups[0].ProcessDetailList[0].ProcessDate = '2026-02-30T12:00:00';
    if (mode === 'description') groups[0].ProcessDetailList[0].ProcessContent = '';
    if (mode === 'group') groups[0].ProcessDetailList = null;
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('uses the final capture and propagates failures rather than replaying an older success', () => {
    const page = captured();
    page.capturedResponses.push({ ...page.capturedResponses[0], status: 403 });
    expect(() => parseCaptured(page, NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    page.capturedResponses.at(-1)!.status = 200;
    page.capturedResponses.at(-1)!.body = JSON.stringify({ ResultList: [] });
    expect(() => parseCaptured(page, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('separates a missing, truncated or failed capture from an explicit unknown parcel', () => {
    const page = captured();
    page.capturedResponses[0].truncated = true;
    expect(() => parseCaptured(page, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    page.capturedResponses[0].truncated = false;
    page.capturedResponses[0].body = 'invalid JSON';
    expect(() => parseCaptured(page, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    page.capturedResponses = [];
    expect(() => parseCaptured(page, NUMBER)).toThrow(expect.objectContaining({ kind: 'transport' }));
  });

  it('decodes an explicitly base64 encoded capture and proves each declared capability', () => {
    const page = captured();
    page.capturedResponses[0].body = Buffer.from(page.capturedResponses[0].body!).toString('base64');
    page.capturedResponses[0].base64Encoded = true;
    const result = parseCaptured(page, NUMBER);
    const checks: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.some((event) => event.location)) };
    const metadata = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    for (const capability of metadata.capabilities) expect(checks[capability], capability).toBe(true);
  });
});

describe('YunExpress browser execution', () => {
  it('selects configured local Chromium without attempting incompatible Trawl capture', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const recorder = { ...NOOP_RECORDER, step: vi.fn(), lookup: vi.fn() };
    const launch = vi.spyOn(chromium, 'launch').mockRejectedValue(new Error('Synthetic browser launch failure'));
    try {
      const instance = adapter({ trawl: new TrawlClient('http://127.0.0.1:8191', fetcher), browserExecutablePath: '/synthetic/chromium',
        fetcher, env: {}, recorder });
      expect(instance.steps).toEqual(['browser', 'trawl']);
      await expect(instance.track({ number: NUMBER })).rejects.toThrow('Synthetic browser launch failure');
      expect(launch).toHaveBeenCalledTimes(1);
      expect(fetcher).not.toHaveBeenCalled();
      expect(recorder.step).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ step: 'browser', outcome: 'error' }));
      expect(recorder.lookup).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1, stepsAvailable: 1 }));
    } finally { launch.mockRestore(); }
  });

  it('requests Trawl capture with a fresh page and bounded cancellation-aware timeout', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(captured())));
    const recorder = { ...NOOP_RECORDER, step: vi.fn(), lookup: vi.fn() };
    const instance = adapter({ trawl: new TrawlClient('http://127.0.0.1:8191', fetcher), browserExecutablePath: null, fetcher, env: {}, recorder });
    await expect(instance.track({ number: NUMBER }, { budgetMs: 10_000.5 })).resolves.toMatchObject({ current_stage: 'customs' });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:8191/scrape');
    expect(JSON.parse(String(init?.body))).toMatchObject({ url: `https://www.yuntrack.com/parcelTracking?id=${NUMBER}`, skipHttp: true,
      maxTier: 2, captureResponses: [API], settleTimeout: 5_000 });
    expect(Number.isInteger(JSON.parse(String(init?.body)).maxTimeout)).toBe(true);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(recorder.step).toHaveBeenCalledWith(expect.objectContaining({ step: 'trawl', outcome: 'ok' }));
  });

  it('does not fabricate a direct result when browser runtime is unavailable', async () => {
    await expect(new YunExpressTracker().fetch(NUMBER)).rejects.toMatchObject({ kind: 'challenge' });
  });

  it('rejects unsupported input and pre-abort before contacting Trawl', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const tracker = new YunExpressTracker({ trawl: new TrawlClient('http://127.0.0.1:8191', fetcher) });
    await expect(tracker.fetch('bad&number')).rejects.toThrow(TypeError);
    await expect(tracker.fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
