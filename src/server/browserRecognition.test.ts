import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserRecognition, TrackingContext } from 'universal-parcel-scraper/node';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('./adapterRegistry', () => ({ createAdapterRegistry: () => ({ for: () => ({ recognizeWithBrowser: lookup }) }) }));
let browser: typeof import('./browserRecognition');
const known = (): BrowserRecognition => ({ known: true, lastActivityAt: new Date().toISOString(),
  result: { status: 'in_transit', events: [{ time: new Date().toISOString(), description: 'Sorted' }] } });
beforeEach(async () => {
  vi.resetModules();
  Reflect.deleteProperty(globalThis, Symbol.for('peek.browserRecognition'));
  lookup.mockReset().mockResolvedValue(known());
  browser = await import('./browserRecognition');
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('shares duplicate work and consumes fresh history only once', async () => {
  const [left, right] = await Promise.all([browser.recognizeBrowser('fedex', '000000000001'), browser.recognizeBrowser('fedex', '000000000001')]);
  expect(lookup).toHaveBeenCalledOnce();
  expect(left).toEqual(right);
  // API and background-worker bundles evaluate this module independently.
  vi.resetModules();
  const worker = await import('./browserRecognition');
  expect(worker.takeBrowserHistory('fedex', '000000000001')).toEqual(left.result);
  expect(browser.takeBrowserHistory('fedex', '000000000001')).toBeUndefined();
  await browser.recognizeBrowser('fedex', '000000000001');
  expect(lookup).toHaveBeenCalledOnce();
  expect(browser.takeBrowserHistory('fedex', '000000000002')).toBeUndefined();
});

it('cancels shared browser work only when its final caller cancels, discarding late history', async () => {
  let reply!: (value: BrowserRecognition) => void;
  let signal!: AbortSignal;
  lookup.mockImplementation((_number: string, context: TrackingContext) => {
    signal = context.signal!;
    return new Promise<BrowserRecognition>((resolve) => { reply = resolve; });
  });
  const left = new AbortController();
  const right = new AbortController();
  const first = browser.recognizeBrowser('fedex', '000000000001', { signal: left.signal });
  const second = browser.recognizeBrowser('fedex', '000000000001', { signal: right.signal });
  await Promise.resolve();
  left.abort();
  await expect(first).rejects.toThrow();
  expect(signal.aborted).toBe(false);
  right.abort();
  await expect(second).rejects.toThrow();
  expect(signal.aborted).toBe(true);
  reply(known());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(browser.takeBrowserHistory('fedex', '000000000001')).toBeUndefined();
});

it('bounds browser concurrency and stops a lookup at the caller deadline', async () => {
  vi.useFakeTimers();
  const signals: AbortSignal[] = [];
  lookup.mockImplementation((_number: string, context: TrackingContext) => {
    signals.push(context.signal!);
    return new Promise((_resolve, reject) => context.signal!.addEventListener('abort', () => reject(context.signal!.reason)));
  });
  const first = browser.recognizeBrowser('fedex', '000000000001', { budgetMs: 10 });
  const second = browser.recognizeBrowser('fedex', '000000000002', { budgetMs: 10 });
  const results = Promise.allSettled([first, second]);
  await expect(browser.recognizeBrowser('fedex', '000000000003')).rejects.toThrow('busy');
  await vi.advanceTimersByTimeAsync(10);
  expect((await results).every((result) => result.status === 'rejected')).toBe(true);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

it('holds failures briefly and never consumes stale shipment history', async () => {
  vi.useFakeTimers();
  lookup.mockRejectedValueOnce(new Error('Unavailable'));
  await expect(browser.recognizeBrowser('fedex', '000000000001')).rejects.toThrow('Unavailable');
  await expect(browser.recognizeBrowser('fedex', '000000000001')).rejects.toThrow('cooling down');
  expect(lookup).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(30_001);
  lookup.mockResolvedValue({ ...known(), lastActivityAt: '2020-01-01T00:00:00Z' });
  await browser.recognizeBrowser('fedex', '000000000001');
  expect(browser.takeBrowserHistory('fedex', '000000000001')).toBeUndefined();
});
