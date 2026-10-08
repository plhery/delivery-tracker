import { afterEach, expect, it, vi } from 'vitest';
import { InputRequiredError, NotFoundError, RateLimitedError, type CarrierResult, type UniversalSource } from 'universal-parcel-scraper';
import { UniversalTracker } from 'universal-parcel-scraper/node';
import type { ProviderHealth } from './trackingRouting';
import { preflightInputNeeded, preflightTracking, takePreflightHistory } from './trackingPreflight';
// The host's telemetry: metrics, logs and Sentry.
const telemetry = vi.hoisted(() => ({ step: vi.fn(), lookup: vi.fn() }));
vi.mock('./adapterRegistry', () => ({ hostAdapterEnvironment: () => ({ recorder: telemetry }) }));
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

it('returns one carrier when every available history agrees on its dated movement', async () => {
  vi.spyOn(UniversalTracker.prototype, 'fetchSource').mockResolvedValue({ ...history,
    discovered_carrier: 'dhl-express', reported_carriers: ['DHL Express'] });
  expect(await preflightTracking('1234500201', health())).toMatchObject({ carrier: 'dhl-express', trackingFound: true });
});
it('keeps conflicting provider identities unresolved', async () => {
  vi.spyOn(UniversalTracker.prototype, 'fetchSource').mockImplementation(async (source) => ({ ...history,
    discovered_carrier: source === 'Ship24' ? 'dhl-express' : 'tipsa',
    reported_carriers: [source === 'Ship24' ? 'DHL Express' : 'TIPSA'] }));
  const answer = await preflightTracking('1234500212', health());
  expect(answer.trackingFound).toBe(true);
  expect(answer.carrier).toBeUndefined();
});

it('shares only the same normalized country context and consumes its history once', async () => {
  const lookup = vi.spyOn(UniversalTracker.prototype, 'fetchSource').mockImplementation(async (_source, _number, _timeout, _postcode, _zone, _signal, country) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ...history, destination_country: country ?? undefined };
  });
  await Promise.all([
    preflightTracking('1234500301', health(), undefined, ' fr '),
    preflightTracking('1234500301', health(), undefined, 'FR'),
    preflightTracking('1234500301', health(), undefined, 'CH'),
  ]);
  expect(lookup).toHaveBeenCalledTimes(4);
  expect(lookup.mock.calls.map((call) => call[6])).toEqual(['FR', 'FR', 'CH', 'CH']);
  expect(takePreflightHistory('ParcelsApp', '1234500301', null)).toBeUndefined();
  expect(takePreflightHistory('ParcelsApp', '1234500301', null, 'FR')).toMatchObject({ destination_country: 'FR' });
  expect(takePreflightHistory('ParcelsApp', '1234500301', null, 'FR')).toBeUndefined();
  expect(takePreflightHistory('ParcelsApp', '1234500301', null, 'CH')).toMatchObject({ destination_country: 'CH' });
});

it('keeps provider postcode prompts bound to the country context', async () => {
  vi.spyOn(UniversalTracker.prototype, 'fetchSource').mockImplementation(async (_source, _number, _timeout, _postcode, _zone, _signal, country) => {
    if (country === 'CH') throw new InputRequiredError('ParcelsApp', 'postcode');
    throw new NotFoundError('ParcelsApp');
  });
  await preflightTracking('1234500302', health(), undefined, 'CH');
  await preflightTracking('1234500302', health(), undefined, 'FR');
  expect(preflightInputNeeded('1234500302', 'CH')).toEqual({ provider: 'Ship24', field: 'dpdPostcode' });
  expect(preflightInputNeeded('1234500302', 'FR')).toBeUndefined();
});

/**
 * Providers answering on the fake clock. Like the scraper's runner, each
 * records its lookup to the tracker's telemetry once it ends, cancelled or not.
 */
function scripted(script: Partial<Record<UniversalSource, { at: number; result?: CarrierResult; error?: Error }>>) {
  const signals = new Map<UniversalSource, AbortSignal>();
  vi.spyOn(UniversalTracker.prototype, 'fetchSource').mockImplementation(async function (this: UniversalTracker, source, _number, _timeout, _postcode, _zone, signal) {
    signals.set(source, signal!);
    const record = (error?: unknown) => this.options.environment?.recorder?.lookup({ carrier: source, finalStep: 'api', outcome: error ? 'error' : 'ok',
      errorType: error ? 'AbortError' : null, durationMs: 0, attempts: 1 });
    const answer = script[source];
    try {
      const result = await new Promise<CarrierResult>((resolve, reject) => {
        const timer = answer ? setTimeout(() => answer.error ? reject(answer.error) : resolve(answer.result!), answer.at) : undefined;
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      });
      record();
      return result;
    } catch (error) { record(error); throw error; }
  });
  return signals;
}
const named = (carrier: string, name: string): CarrierResult => ({ ...history, discovered_carrier: carrier, reported_carriers: [name] });
function settling(answer: Promise<unknown>) {
  const state = { settled: false };
  void answer.finally(() => { state.settled = true; }).catch(() => undefined);
  return state;
}

it('answers once one provider has dated history and cancels the other a second later, without counting it as failing', async () => {
  vi.useFakeTimers(); telemetry.lookup.mockClear();
  const signals = scripted({ ParcelsApp: { at: 1_500, result: named('dhl-express', 'DHL Express') } });
  const service = health();
  const answer = preflightTracking('1234500401', service);
  const wait = settling(answer);
  await vi.advanceTimersByTimeAsync(1_500 + 999);
  expect(wait.settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  // Ship24 might have named another carrier, so none is named.
  expect(await answer).toEqual({ providers: [{ provider: 'ParcelsApp', outcome: 'history' }], trackingFound: true });
  expect(signals.get('Ship24')?.aborted).toBe(true);
  expect(service.finishTrackingProvider.mock.calls.map(([provider, , kind]) => [provider, kind]))
    .toEqual([['ParcelsApp', null], ['Ship24', 'not_found']]);
  expect(telemetry.lookup.mock.calls.map(([record]) => [record.carrier, record.outcome])).toEqual([['ParcelsApp', 'ok']]);
  expect(takePreflightHistory('Ship24', '1234500401', null)).toBeUndefined();
  expect(takePreflightHistory('ParcelsApp', '1234500401', null)).toMatchObject({ discovered_carrier: 'dhl-express' });
});

it('keeps what the other provider answers within that second: its outcome, its history and its carrier', async () => {
  vi.useFakeTimers();
  scripted({ ParcelsApp: { at: 1_000, result: named('dhl-express', 'DHL Express') }, Ship24: { at: 1_800, result: named('tipsa', 'TIPSA') } });
  const answer = preflightTracking('1234500402', health());
  await vi.advanceTimersByTimeAsync(1_800);
  expect(await answer).toEqual({ trackingFound: true, providers: [{ provider: 'Ship24', outcome: 'history' }, { provider: 'ParcelsApp', outcome: 'history' }] });
  expect(takePreflightHistory('Ship24', '1234500402', null)).toMatchObject({ discovered_carrier: 'tipsa' });
  expect(takePreflightHistory('ParcelsApp', '1234500402', null)).toMatchObject({ discovered_carrier: 'dhl-express' });

  scripted({ ParcelsApp: { at: 1_000, result: history }, Ship24: { at: 1_200, error: new InputRequiredError('Ship24', 'postcode') } });
  const prompt = preflightTracking('1234500403', health());
  await vi.advanceTimersByTimeAsync(1_200);
  expect(await prompt).toEqual({ trackingFound: true, providers: [{ provider: 'Ship24', outcome: 'input_required' }, { provider: 'ParcelsApp', outcome: 'history' }] });
});

it('waits for both providers while neither has dated history', async () => {
  vi.useFakeTimers();
  // A status without a dated scan proves little: the other provider may have the history.
  scripted({ ParcelsApp: { at: 500, result: { status: 'in_transit', events: [] } }, Ship24: { at: 6_000, result: history } });
  const answer = preflightTracking('1234500404', health());
  const wait = settling(answer);
  await vi.advanceTimersByTimeAsync(5_999);
  expect(wait.settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await answer).toEqual({ trackingFound: true, providers: [{ provider: 'Ship24', outcome: 'history' }, { provider: 'ParcelsApp', outcome: 'history' }] });

  scripted({ ParcelsApp: { at: 500, error: new NotFoundError('ParcelsApp') }, Ship24: { at: 6_000, result: history } });
  const after = preflightTracking('1234500405', health());
  const later = settling(after);
  await vi.advanceTimersByTimeAsync(5_999);
  expect(later.settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await after).toMatchObject({ trackingFound: true, providers: [{ provider: 'Ship24', outcome: 'history' }, { provider: 'ParcelsApp', outcome: 'no_history' }] });
});
