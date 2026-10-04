import { afterEach, expect, it, vi } from 'vitest';
import { InputRequiredError, NotFoundError, RateLimitedError } from 'universal-parcel-scraper';
import { UniversalTracker } from 'universal-parcel-scraper/node';
import type { ProviderHealth } from './trackingRouting';
import { preflightTracking, takePreflightHistory } from './trackingPreflight';
vi.mock('./adapterRegistry', () => ({ hostAdapterEnvironment: () => ({}) }));
const health = () => ({
  acquireTrackingProvider: vi.fn<ProviderHealth['acquireTrackingProvider']>(async () => ({ token: 'synthetic-lease', retry_at: '' })),
  finishTrackingProvider: vi.fn<ProviderHealth['finishTrackingProvider']>(async () => undefined),
});
const history = { status: 'delivered' as const, events: [{ time: '2026-10-01T12:00:00Z', description: 'Delivered', stage: 'delivered' as const }] };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it('shares concurrent work and lets one caller cancel while another reuses anonymous history once', async () => {
  const lookup = vi.spyOn(UniversalTracker.prototype, 'fetchSource').mockImplementation(async (_source, _number, _timeout, _postcode, _zone, signal) => {
    await new Promise((resolve) => setTimeout(resolve, 5)); signal?.throwIfAborted(); return history;
  });
  const service = health(); const controller = new AbortController();
  const cancelled = preflightTracking('1234567891', service, controller.signal);
  const retained = preflightTracking('1234567891', service);
  controller.abort();
  await expect(cancelled).rejects.toThrow();
  expect(await retained).toMatchObject({ trackingFound: true, providers: [{ provider: 'Ship24', outcome: 'history' }, { provider: 'ParcelsApp', outcome: 'history' }] });
  expect(await preflightTracking('1234567891', service)).toMatchObject({ trackingFound: true });
  expect(lookup).toHaveBeenCalledTimes(2);
  expect(takePreflightHistory('Ship24', '1234567891', '8000')).toBeUndefined();
  expect(takePreflightHistory('Ship24', '1234567880', null)).toBeUndefined();
  expect(takePreflightHistory('Ship24', '1234567891', null)).toMatchObject(history);
  expect(takePreflightHistory('Ship24', '1234567891', null)).toBeUndefined();
});
it('keeps input requirements actionable without opening the provider circuit', async () => {
  vi.spyOn(UniversalTracker.prototype, 'fetchSource').mockImplementation(async (source) => {
    if (source === 'ParcelsApp') throw new InputRequiredError(source, 'postcode');
    throw new NotFoundError(source);
  });
  const service = health();
  expect(await preflightTracking('9876000046', service)).toEqual({ providers: [{ provider: 'Ship24', outcome: 'no_history' }, { provider: 'ParcelsApp', outcome: 'input_required' }] });
  expect(service.finishTrackingProvider.mock.calls.map((call) => call[2])).toEqual(['not_found', 'not_found']);
});
it('distinguishes service failures and shared cooldowns from an empty answer', async () => {
  vi.spyOn(UniversalTracker.prototype, 'fetchSource').mockRejectedValue(new RateLimitedError('Ship24'));
  const service = health(); service.acquireTrackingProvider.mockResolvedValueOnce({ token: null, retry_at: '2026-10-05T12:00:00Z' });
  expect(await preflightTracking('1234500002', service)).toEqual({ providers: [{ provider: 'Ship24', outcome: 'deferred' }, { provider: 'ParcelsApp', outcome: 'unavailable' }] });
});
it('starts no upstream work for a cancelled request', async () => {
  const lookup = vi.spyOn(UniversalTracker.prototype, 'fetchSource'); const service = health();
  await expect(preflightTracking('1234500013', service, AbortSignal.abort())).rejects.toThrow();
  expect(lookup).not.toHaveBeenCalled(); expect(service.acquireTrackingProvider).not.toHaveBeenCalled();
});
it('cancels abandoned work without counting a provider outage or retaining history', async () => {
  const lookup = vi.spyOn(UniversalTracker.prototype, 'fetchSource').mockImplementation(() => new Promise(() => undefined));
  const service = health(); const controller = new AbortController();
  const result = preflightTracking('1234500099', service, controller.signal);
  await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
  controller.abort();
  await expect(result).rejects.toThrow();
  await vi.waitFor(() => expect(service.finishTrackingProvider).toHaveBeenCalledTimes(2));
  expect(service.finishTrackingProvider.mock.calls.map((call) => call[2])).toEqual(['not_found', 'not_found']);
  expect(takePreflightHistory('Ship24', '1234500099', null)).toBeUndefined();
});
