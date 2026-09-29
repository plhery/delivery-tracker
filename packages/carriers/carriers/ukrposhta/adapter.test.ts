import { readFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, UKRPOSHTA_API, UkrposhtaTracker, ukrposhtaTrackingUrl } from './adapter';
import { normalizeUkrposhtaNumber, parseUkrposhtaHistory, parseUkrposhtaOverview, ukrposhtaWallClock } from './parser';

const NUMBER = '0000000000091';
const fixture = (name = 'returned') => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const parsed = (pair = fixture(), number = NUMBER) => normalizeCarrierResult(parseUkrposhtaHistory(pair.history, parseUkrposhtaOverview(pair.overview, number)));

afterEach(() => vi.restoreAllMocks());

describe('Ukrposhta native history projection', () => {
  it('requires the exact barcode-bound overview and complete matching full history', () => {
    const result = parsed();
    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned', last_update: null });
    expect(result.events).toHaveLength(5);
    expect(result.events?.[0]).toMatchObject({ local_time: '2026-03-29T16:03:00', stage: 'returned', provider_leg: 'return' });
    expect(result.events?.[1]).toMatchObject({ stage: 'ready_for_pickup', provider_leg: 'return' });
    expect(result.events?.[2]).toMatchObject({ stage: 'in_transit', provider_leg: 'return' });
    expect(result.events?.[3]).toMatchObject({ stage: 'exception', provider_leg: 'return' });
    expect(result.events?.[4]).toMatchObject({ stage: 'registered' });
    expect(result.events?.[4].provider_leg).toBeUndefined();
    expect(result.delivered_at).toBeUndefined();
    expect(result.expected_delivery).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('keeps international delivered history local rather than assigning the home zone', () => {
    const result = parsed(fixture('delivered'), 'RR000000005UA');
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: null });
    expect(result.events?.[1].stage).toBe('out_for_delivery');
    expect(result.events?.every(event => event.local_time && !event.time)).toBe(true);
    expect(result.delivered_at).toBeUndefined();
  });

  it.each(['identity', 'duplicate', 'count', 'code', 'label', 'location', 'country', 'date'])('rejects an overview/history %s mismatch', mode => {
    const pair = fixture(), row = pair.overview.result[0];
    if (mode === 'identity') row.barcode = '0000000000092';
    if (mode === 'duplicate') pair.overview.result.push(row);
    if (mode === 'count') row.step++;
    if (mode === 'code') row.event = '48000';
    if (mode === 'label') row.eventName = 'Final delivery';
    if (mode === 'location') row.name = 'Different facility';
    if (mode === 'country') row.country = 'Different country';
    if (mode === 'date') row.date = '2026-03-29T16:04:00';
    expect(() => parsed(pair)).toThrow();
  });

  it.each(['top', 'row'])('requires any optional %s history identity to agree', mode => {
    const pair = fixture();
    if (mode === 'top') pair.history.nod_barcode = '0000000000092';
    else pair.history.result[2].nod_barcode = '0000000000092';
    expect(() => parsed(pair)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('does not turn a return decision or later transport into completed return', () => {
    const pair = fixture();
    pair.history.result.shift(); pair.overview.result[0] = { ...pair.overview.result[0], step: 4,
      date: '2026-03-28T13:32:44', event: '21700', eventName: 'Return: Arrived to the Branch' };
    expect(parsed(pair)).toMatchObject({ status: 'in_transit', current_stage: 'ready_for_pickup' });
    pair.history.result.shift(); pair.overview.result[0] = { ...pair.overview.result[0], step: 3,
      date: '2026-03-28T11:27:44', event: '20800', eventName: 'Return: Departed from the Logistics Center' };
    expect(parsed(pair)).toMatchObject({ status: 'in_transit', current_stage: 'in_transit' });
    pair.history.result.shift(); pair.overview.result[0] = { ...pair.overview.result[0], step: 2,
      date: '2026-03-27T10:34:44', event: '31200', eventName: "Returned to Sender (Due to Recipient's Refusal)" };
    expect(parsed(pair)).toMatchObject({ status: 'exception', current_stage: 'exception' });
  });

  it.each(['invalid', 'missing'])('preserves an unresolved %s latest clock and native current-first order', mode => {
    const pair = fixture(), value = mode === 'invalid' ? 'not a date' : '';
    pair.overview.result[0].date = pair.history.result[0].gtt_date = value;
    const result = parsed(pair);
    expect(result.last_update).toBeNull();
    expect(result.events?.[0]).toMatchObject({ provider_code: '41000', stage: 'returned' });
    expect(result.events?.[0].local_time).toBeUndefined();
    if (mode === 'invalid') expect(result.events?.[0].provider_time_text).toBe(value);
    expect(result.events?.[1].provider_code).toBe('21700');
  });

  it.each(['31.02.2026 12:00', '29.03.2026 24:00', '2026-03-29T12:60:00', '2026-03-29T12:00:00Z', '29.03.2026'])('never normalizes malformed or unsupported clock %s', value => {
    expect(ukrposhtaWallClock(value)).toBeNull();
  });

  it('preserves a current unknown code without borrowing older delivered progress', () => {
    const pair = fixture();
    pair.overview.result[0].event = pair.history.result[0].gtt_event = 'constructor';
    const result = parsed(pair);
    expect(result.status).toBe('unknown');
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.[0].stage).toBeUndefined();
  });

  it.each(['multiple', 'empty', 'malformed date flag', 'malformed rows', 'malformed clock', 'too many'])('rejects %s without inventing absence', mode => {
    const pair = fixture();
    if (mode === 'multiple') pair.history.from_to.ISSEVERALPLACES = 1;
    if (mode === 'empty') pair.history.result = [];
    if (mode === 'malformed date flag') pair.history.date_by_barcode = 'false';
    if (mode === 'malformed rows') pair.history.result[4] = null;
    if (mode === 'malformed clock') pair.history.result[4].gtt_date = {};
    if (mode === 'too many') { pair.history.result = Array(501).fill(pair.history.result[0]); pair.overview.result[0].step = 501; }
    expect(() => parsed(pair)).toThrow();
  });

  it('keeps unbound not-found and verification replies distinct', () => {
    expect(() => parseUkrposhtaOverview(fixture('unknown'), NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parseUkrposhtaOverview({ code: 'captcha_failed' }, NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(() => parseUkrposhtaOverview({ result: {} }, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('deduplicates only fully projected repeats after validating the native count', () => {
    const pair = fixture(); pair.history.result.splice(2, 0, pair.history.result[2]); pair.overview.result[0].step++;
    expect(parsed(pair).events).toHaveLength(5);
  });

  it('caps projected output after validating every row and preserving older return cues', () => {
    const pair = fixture();
    pair.history.result.splice(1, 0, ...Array.from({ length: 101 }, (_, index) => ({ ...pair.history.result[2],
      gtt_event_name: `Return: Departed from example facility ${index}` })));
    pair.overview.result[0].step = pair.history.result.length;
    expect(parsed(pair).events).toHaveLength(100);
    pair.history.result.at(-1).gtt_event_name = {};
    expect(() => parsed(pair)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('validates input before any browser operation and preserves exact output identities', () => {
    expect(normalizeUkrposhtaNumber(' 000 0000 0000 91 ')).toBe(NUMBER);
    expect(normalizeUkrposhtaNumber('rr000000005ua')).toBe('RR000000005UA');
    expect(() => normalizeUkrposhtaNumber('RR000000009UA')).toThrow(TypeError);
    expect(() => normalizeUkrposhtaNumber('1234567890123&extra=1')).toThrow(TypeError);
  });
});

function browserSeam(pair = fixture()) {
  const frame = {}, replies = [pair.overview, pair.history];
  let current = 0;
  const page = {
    mainFrame: () => frame,
    waitForResponse: vi.fn(async () => {
      const index = current++;
      const input = index === 0 ? `${NUMBER},${NUMBER}` : NUMBER;
      return { url: () => UKRPOSHTA_API, status: (): number => 200, headers: () => ({}),
        request: () => ({ method: () => 'POST', frame: () => frame, postDataJSON: () => ({ barcode: input, lang: 'EN' }) }),
        body: async () => Buffer.from(JSON.stringify(replies[index])) };
    }),
    goto: vi.fn(async (url: string, options?: unknown) => { void url; void options; return { status: (): number => 200 }; }),
  };
  const context = { route: vi.fn(), newPage: vi.fn(async () => page) };
  const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => {}) };
  const launch = vi.spyOn(chromium, 'launch').mockResolvedValue(browser as never);
  return { page, context, browser, launch };
}

describe('Ukrposhta bounded anonymous browser retrieval', () => {
  it('uses a fresh context and two native requests inside one recorded lookup', async () => {
    const seam = browserSeam(), recorder = { ...NOOP_RECORDER, step: vi.fn(), lookup: vi.fn() };
    const instance = adapter({ browserExecutablePath: '/synthetic/chromium', trawl: null, recorder, env: {} });
    await expect(instance.track({ number: NUMBER }, { budgetMs: 5000 })).resolves.toMatchObject({ current_stage: 'returned' });
    expect(seam.page.goto.mock.calls.map(call => call[0])).toEqual([ukrposhtaTrackingUrl(`${NUMBER},${NUMBER}`), ukrposhtaTrackingUrl(NUMBER)]);
    expect(Object.keys(seam.launch.mock.calls[0]![0]!.env!)).toEqual(['PATH', 'HOME', 'LANG']);
    expect(seam.browser.newContext).toHaveBeenCalledWith({ locale: 'en-US', acceptDownloads: false, serviceWorkers: 'block' });
    expect(seam.browser.close).toHaveBeenCalledOnce();
    expect(recorder.step).toHaveBeenCalledWith(expect.objectContaining({ step: 'browser', outcome: 'ok' }));
  });

  it('stops after an inconclusive overview without requesting history', async () => {
    const seam = browserSeam({ overview: fixture('unknown'), history: fixture().history });
    await expect(new UkrposhtaTracker({ executablePath: '/synthetic/chromium' }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
    expect(seam.page.goto).toHaveBeenCalledOnce();
    expect(seam.browser.close).toHaveBeenCalledOnce();
  });

  it('does not begin the second request after the lookup deadline', async () => {
    const seam = browserSeam(), clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    seam.page.goto.mockImplementation(async () => { clock.mockReturnValue(5001); return { status: () => 200 }; });
    await expect(new UkrposhtaTracker({ executablePath: '/synthetic/chromium' }).fetch(NUMBER, { budgetMs: 5000 })).rejects.toMatchObject({ kind: 'budget' });
    expect(seam.page.goto).toHaveBeenCalledOnce();
  });

  it('rejects a captured response submitted for another parcel', async () => {
    const seam = browserSeam();
    const original = await seam.page.waitForResponse();
    seam.page.waitForResponse.mockResolvedValue({ ...original, request: () => ({ ...original.request(), postDataJSON: () => ({ barcode: '0000000000092', lang: 'EN' }) }) });
    await expect(new UkrposhtaTracker({ executablePath: '/synthetic/chromium' }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });

  it.each([404, 410, 429])('keeps native API HTTP %s separate from parcel absence', async status => {
    const seam = browserSeam(), original = await seam.page.waitForResponse();
    seam.page.waitForResponse.mockResolvedValue({ ...original, status: () => status, headers: () => ({ 'retry-after': '7' }) });
    await expect(new UkrposhtaTracker({ executablePath: '/synthetic/chromium' }).fetch(NUMBER)).rejects.toMatchObject({ status,
      kind: status === 429 ? 'rate_limited' : 'transport' });
  });

  it.each([404, 410])('treats tracking page HTTP %s as a transport failure', async status => {
    const seam = browserSeam(); seam.page.goto.mockResolvedValue({ status: () => status });
    await expect(new UkrposhtaTracker({ executablePath: '/synthetic/chromium' }).fetch(NUMBER)).rejects.toMatchObject({ status, kind: 'transport' });
    expect(seam.browser.close).toHaveBeenCalledOnce();
  });

  it.each(['declared size', 'actual size', 'invalid JSON'])('rejects a captured %s before returning progress', async mode => {
    const seam = browserSeam(), original = await seam.page.waitForResponse();
    seam.page.waitForResponse.mockResolvedValue({ ...original,
      headers: () => mode === 'declared size' ? { 'content-length': '1000001' } : {},
      body: async () => mode === 'actual size' ? Buffer.alloc(1000001) : Buffer.from('invalid JSON') });
    await expect(new UkrposhtaTracker({ executablePath: '/synthetic/chromium' }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
    expect(seam.browser.close).toHaveBeenCalledOnce();
  });

  it('closes the browser when a pending native response is cancelled', async () => {
    const seam = browserSeam(), controller = new AbortController();
    let submitted!: () => void;
    const ready = new Promise<void>(resolve => { submitted = resolve; });
    seam.page.waitForResponse.mockImplementation(() => new Promise(() => {}));
    seam.page.goto.mockImplementation(async () => { submitted(); return { status: () => 200 }; });
    const pending = new UkrposhtaTracker({ executablePath: '/synthetic/chromium' }).fetch(NUMBER, { signal: controller.signal });
    await ready; controller.abort(new Error('Synthetic cancellation'));
    await expect(pending).rejects.toThrow('Synthetic cancellation');
    expect(seam.browser.close).toHaveBeenCalled();
  });

  it('rejects launch cancellation promptly and closes a late browser before releasing the lock', async () => {
    const seam = browserSeam(), controller = new AbortController();
    let resolveLaunch!: (browser: Browser) => void;
    let resolveClose!: () => void;
    seam.launch.mockImplementation(() => new Promise(resolve => { resolveLaunch = resolve; }));
    seam.browser.close.mockImplementation(() => new Promise(resolve => { resolveClose = resolve; }));
    const tracker = new UkrposhtaTracker({ executablePath: '/synthetic/chromium' });
    const pending = tracker.fetch(NUMBER, { signal: controller.signal });
    controller.abort(new Error('Cancelled during launch'));
    await expect(pending).rejects.toThrow('Cancelled during launch');
    await expect(tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'transport' });
    expect(seam.launch).toHaveBeenCalledOnce();
    resolveLaunch(seam.browser as never);
    await vi.waitFor(() => expect(seam.browser.close).toHaveBeenCalledOnce());
    await expect(tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'transport' });
    expect(seam.browser.newContext).not.toHaveBeenCalled();
    resolveClose();
    await vi.waitFor(async () => {
      seam.launch.mockResolvedValue(seam.browser as never);
      seam.browser.close.mockResolvedValue();
      await expect(tracker.fetch(NUMBER)).resolves.toMatchObject({ current_stage: 'returned' });
    });
  });

  it.each(['context', 'page'])('rejects cancellation during %s setup and closes its browser', async phase => {
    const seam = browserSeam(), controller = new AbortController();
    let began!: () => void;
    const ready = new Promise<void>(resolve => { began = resolve; });
    if (phase === 'context') seam.browser.newContext.mockImplementation(() => { began(); return new Promise(() => {}); });
    else seam.context.newPage.mockImplementation(() => { began(); return new Promise(() => {}); });
    const pending = new UkrposhtaTracker({ executablePath: '/synthetic/chromium' }).fetch(NUMBER, { signal: controller.signal });
    await ready; controller.abort(new Error(`Cancelled during ${phase} setup`));
    await expect(pending).rejects.toThrow(`Cancelled during ${phase} setup`);
    expect(seam.browser.close).toHaveBeenCalledOnce();
    expect(seam.page.goto).not.toHaveBeenCalled();
  });

  it('requires a configured runtime and performs no browser work for invalid or pre-aborted input', async () => {
    const seam = browserSeam();
    expect(() => new UkrposhtaTracker().fetch(NUMBER)).toThrow(expect.objectContaining({ kind: 'challenge' }));
    expect(() => new UkrposhtaTracker({ executablePath: '/synthetic/chromium' }).fetch('invalid')).toThrow(TypeError);
    await expect(new UkrposhtaTracker({ executablePath: '/synthetic/chromium' }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(seam.launch).not.toHaveBeenCalled();
  });
});
