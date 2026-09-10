import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamHttpError } from './boundedFetch';
import { freshnessWindow, RoutingDeferred, routingState, TrackingRouter, type RoutedResult } from './trackingRouting';
import type { JsonObject } from './types';
import type { CarrierResult } from './carrierResult';
import * as monitoring from './observability';
import { universalCarrierHints } from './universalCarrierHints';

const time = new Date('2026-09-10T12:00:00Z');
const history = (stamp = '2026-09-10T11:00:00Z'): CarrierResult => ({ status: 'in_transit', current_stage: 'in_transit',
  last_update: stamp, events: [{ time: stamp, description: 'In transit', stage: 'in_transit' }] });
const directValue = (carrier = 'ups'): RoutedResult => ({ result: history(), sourceCarrierId: carrier, swissPostReady: null, handoffFallbackErrorType: null });
const parcel = (overrides: JsonObject = {}): JsonObject => ({ id: 'parcel', carrier: 'unknown', tracking_number: 'TEST1234', ...overrides });
const state = (extra: JsonObject = {}) => ({ version: 1, configured_carrier: 'unknown', failures: {}, probe_cursor: 0, discovery_cursor: 0, ...extra });
function setup(now = time) {
  const direct = vi.fn().mockResolvedValue(directValue());
  const universal = vi.fn().mockResolvedValue(history());
  const health = {
    acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
    finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
  };
  return { direct, universal, health, router: new TrackingRouter({ direct, universal, health, now: () => now }) };
}
beforeEach(() => vi.spyOn(monitoring, 'reportRoutingEvent').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe('persistent tracking routing', () => {
  it('uses a direct carrier without contacting a universal provider', async () => {
    const { router, universal } = setup();
    const result = await router.fetch(parcel({ carrier: 'ups' }), false);
    expect(result.result.routing).toMatchObject({ confirmed_carrier: 'ups', last_success_at: time.toISOString() });
    expect(universal).not.toHaveBeenCalled();
  });
  it('discovers in default order and remembers the working provider across instances', async () => {
    const first = setup();
    first.universal.mockRejectedValueOnce(new Error('down'));
    const result = await first.router.fetch(parcel(), false);
    expect(first.universal.mock.calls.map(([source]) => source)).toEqual(['17TRACK', 'ParcelsApp']);
    const second = setup(new Date('2026-09-10T12:20:00Z'));
    await second.router.fetch(parcel({ carrier_data: result.result }), false);
    expect(second.universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp']);
  });
  it('records original direct failure before a successful fallback', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new Error('upstream token SECRET'));
    universal.mockImplementation(async () => {
      expect(monitoring.reportRoutingEvent).toHaveBeenCalledWith('provider_failed', expect.objectContaining({ provider: 'dhl' }));
      return history();
    });
    const result = await router.fetch(parcel({ carrier: 'dhl' }), false);
    expect(result.result.routing).toMatchObject({ preferred_provider: '17TRACK' });
    expect(JSON.stringify(vi.mocked(monitoring.reportRoutingEvent).mock.calls)).not.toContain('SECRET');
  });
  it.each(['fedex', 'unknown'])('uses universals for %s and still keeps the user selection', async (carrier) => {
    const { router, direct } = setup();
    const result = await router.fetch(parcel({ carrier }), false);
    expect(direct).not.toHaveBeenCalled();
    expect(result.result.routing).toMatchObject({ configured_carrier: carrier, preferred_provider: '17TRACK' });
  });
  it('confirms a strong supported-carrier correction before adopting it', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValueOnce(Object.assign(new Error('missing'), { status: 404 }));
    const result = await router.fetch(parcel({ carrier: 'dhl', tracking_number: '1Z999AA10123456784' }), false);
    expect(direct.mock.calls.map(([, carrier]) => carrier)).toEqual(['dhl', 'ups']);
    expect(result.result.routing).toMatchObject({ confirmed_carrier: 'ups', configured_carrier: 'dhl' });
    expect(universal).not.toHaveBeenCalled();
  });
  it('uses a universal carrier hint only after a matching direct lookup succeeds', async () => {
    const { router, direct } = setup();
    const result = await router.fetch(parcel({ carrier_data: { routing: state({ discovered_carrier: 'ups' }) } }), false);
    expect(direct).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'ups' }), 'ups');
    expect(result.result.routing).toMatchObject({ confirmed_carrier: 'ups' });
  });
  it('does not borrow verification inputs from another carrier', async () => {
    const { router, direct, universal } = setup();
    await router.fetch(parcel({ dpd_postcode: '8000', carrier_data: { routing: state({ discovered_carrier: 'mondial-relay' }) } }), false);
    expect(direct).not.toHaveBeenCalled();
    expect(universal).toHaveBeenCalledOnce();
    expect(monitoring.reportRoutingEvent).toHaveBeenCalledWith('carrier_input_required', expect.anything());
  });
  it.each([
    ['2026-09-10T12:00:00Z', '2026-09-10T11:01:00Z', true],
    ['2026-09-10T12:00:00Z', '2026-09-10T11:00:00Z', false],
    ['2026-09-10T23:00:00Z', '2026-09-10T20:01:00Z', true],
    ['2026-09-10T23:00:00Z', '2026-09-10T20:00:00Z', false],
  ])('defers a 429 at %s only for a successful retrieval at %s', async (now, success, fresh) => {
    const { router, direct, universal } = setup(new Date(now));
    direct.mockRejectedValue(new UpstreamHttpError('UPS', 429, 2 * 3_600_000));
    const task = router.fetch(parcel({ carrier: 'ups', carrier_data: { routing: state({ configured_carrier: 'ups', last_success_at: success }) } }), false);
    if (fresh) {
      await expect(task).rejects.toMatchObject({ name: 'RoutingDeferred', stale: false });
      expect(universal).not.toHaveBeenCalled();
    } else await expect(task).resolves.toMatchObject({ result: { tracking_provider: '17TRACK' } });
  });
  it('does not confuse a recent failed attempt with a successful retrieval', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new UpstreamHttpError('UPS', 429));
    await router.fetch(parcel({ carrier: 'ups', last_synced_at: '2026-09-10T11:59:00Z', sync_status: 'error' }), false);
    expect(universal).toHaveBeenCalledOnce();
  });
  it('skips a shared provider cooldown and tries a healthy provider', async () => {
    const { router, health, universal } = setup();
    health.acquireTrackingProvider.mockResolvedValueOnce({ token: null, retry_at: '2026-09-10T13:00:00Z' });
    await router.fetch(parcel(), false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp']);
  });
  it('retains provider-specific Retry-After and stops cascading on a fresh universal 429', async () => {
    const { router, universal, health } = setup();
    universal.mockRejectedValue(new UpstreamHttpError('17TRACK', 429, 2 * 3_600_000));
    await expect(router.fetch(parcel({ carrier_data: { routing: state({ preferred_provider: '17TRACK', last_success_at: '2026-09-10T11:30:00Z' }) } }), false))
      .rejects.toMatchObject({ stale: false, routing: { failures: { '17TRACK': { retry_at: '2026-09-10T14:00:00.000Z' } } } });
    expect(universal).toHaveBeenCalledOnce();
    expect(health.finishTrackingProvider).toHaveBeenCalledWith('17TRACK', 'lease', 'rate_limited', 7_200_000, expect.any(Number));
  });
  it('bounds failed discovery and advances to Ship24 on the next check', async () => {
    const first = setup(); first.universal.mockRejectedValue(new Error('down'));
    const failed = await first.router.fetch(parcel(), false).catch((error) => error as RoutingDeferred);
    if (!(failed instanceof RoutingDeferred)) throw new Error('Expected deferred discovery');
    expect(first.universal).toHaveBeenCalledTimes(2);
    const second = setup();
    await second.router.fetch(parcel({ carrier_data: { routing: failed.routing } }), false);
    expect(second.universal.mock.calls[0][0]).toBe('Ship24');
  });
  it('does one daily scheduled comparison and switches only for newer data', async () => {
    const { router, universal } = setup();
    universal.mockResolvedValueOnce(history('2026-09-10T10:00:00Z')).mockResolvedValueOnce(history('2026-09-10T11:00:00Z'));
    const result = await router.fetch(parcel({ carrier_data: { routing: state({ preferred_provider: '17TRACK', last_probe_at: '2026-09-08T12:00:00Z' }) } }), true);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['17TRACK', 'ParcelsApp']);
    expect(result.result.routing).toMatchObject({ preferred_provider: 'ParcelsApp', probe_cursor: 1 });
  });
  it.each([false, true])('keeps affinity on older alternative data (scheduled=%s)', async (scheduled) => {
    const { router, universal } = setup();
    universal.mockResolvedValueOnce(history()).mockResolvedValueOnce(history('2026-09-09T11:00:00Z'));
    const result = await router.fetch(parcel({ carrier_data: { routing: state({ preferred_provider: 'Ship24', last_probe_at: '2026-09-08T12:00:00Z' }) } }), scheduled);
    expect(result.result.routing).toMatchObject({ preferred_provider: 'Ship24' });
    expect(universal).toHaveBeenCalledTimes(scheduled ? 2 : 1);
  });
  it('does not throw away successful history when a shadow check fails', async () => {
    const { router, universal } = setup();
    universal.mockResolvedValueOnce(history()).mockRejectedValueOnce(new UpstreamHttpError('ParcelsApp', 429));
    await expect(router.fetch(parcel({ carrier_data: { routing: state({ preferred_provider: '17TRACK', last_probe_at: '2026-09-08T12:00:00Z', last_success_at: '2026-09-10T11:50:00Z' }) } }), true))
      .resolves.toMatchObject({ result: { tracking_provider: '17TRACK' } });
  });
  it('tries a new manual carrier, then recovers the previous confirmed route and its own inputs', async () => {
    const { router, direct } = setup(); direct.mockRejectedValueOnce(new Error('down'));
    const result = await router.fetch(parcel({ carrier: 'dhl', carrier_data: { routing: state({ configured_carrier: 'dpd',
      confirmed_carrier: 'dpd', confirmed_number: 'TEST1234', confirmed_postcode: '8000', last_success_at: '2026-09-10T11:00:00Z' }) } }), false);
    expect(direct.mock.calls.map(([, carrier]) => carrier)).toEqual(['dhl', 'dpd']);
    expect(direct.mock.calls[1][0].dpd_postcode).toBe('8000');
    expect(result.result.routing).toMatchObject({ configured_carrier: 'dhl', confirmed_carrier: 'dpd' });
  });
  it('keeps a prior confirmed route when the new choice has no direct support', async () => {
    const { router, direct, universal } = setup();
    await router.fetch(parcel({ carrier: 'fedex', carrier_data: { routing: state({ configured_carrier: 'ups', confirmed_carrier: 'ups', confirmed_number: 'TEST1234' }) } }), false);
    expect(direct.mock.calls.map(([, carrier]) => carrier)).toEqual(['ups']);
    expect(universal).not.toHaveBeenCalled();
  });
  it('does not adopt an old route for a different tracking number', async () => {
    const { router, direct } = setup();
    await router.fetch(parcel({ carrier_data: { routing: state({ confirmed_carrier: 'ups', confirmed_number: 'OTHER123' }) } }), false);
    expect(direct).not.toHaveBeenCalled();
  });
  it('uses the confirmed delivery-leg number for universal recovery', async () => {
    const { router, direct, universal } = setup(); direct.mockRejectedValue(new Error('delivery unavailable'));
    await router.fetch(parcel({ carrier: 'dhl', carrier_data: { original_carrier: 'dhl', active_tracking_carrier: 'swiss-post',
      active_tracking_number: 'LOCAL1234' } }), false);
    expect(universal).toHaveBeenCalledWith('17TRACK', 'LOCAL1234', expect.any(Number));
  });
  it('fails closed when shared coordination is unavailable, with a persisted retry', async () => {
    const { router, health, universal } = setup(); health.acquireTrackingProvider.mockRejectedValue(new Error('db down'));
    await expect(router.fetch(parcel(), false)).rejects.toMatchObject({ routing: { next_check_at: '2026-09-10T12:15:00.000Z' } });
    expect(universal).not.toHaveBeenCalled();
  });
  it('keeps valid data if the health completion write fails', async () => {
    const { router, health } = setup(); health.finishTrackingProvider.mockRejectedValue(new Error('db down'));
    await expect(router.fetch(parcel(), false)).resolves.toMatchObject({ result: { tracking_provider: '17TRACK' } });
  });
  it('checks cancellation before contacting a provider', async () => {
    const { router, universal } = setup();
    await expect(router.fetch(parcel(), false, AbortSignal.abort())).rejects.toThrow();
    expect(universal).not.toHaveBeenCalled();
  });
  it('computes Zurich day/night windows across DST and resets config-specific cooldowns', () => {
    expect(freshnessWindow(new Date('2026-12-10T06:59:00Z'))).toBe(10_800_000);
    expect(freshnessWindow(new Date('2026-12-10T07:00:00Z'))).toBe(3_600_000);
    expect(routingState(parcel({ carrier: 'ups', carrier_data: { routing: state({ next_check_at: '2027-01-01T00:00:00Z' }) } })).next_check_at).toBeUndefined();
  });
  it('does not guess a regional carrier from a brand or cross-border provider list', () => {
    expect(universalCarrierHints(['DHL']).discovered_carrier).toBeUndefined();
    expect(universalCarrierHints(['UPS', 'Swiss Post']).discovered_carrier).toBeUndefined();
    expect(universalCarrierHints(['UPS'])).toMatchObject({ discovered_carrier: 'ups' });
    expect(universalCarrierHints(['https://private/token'])).toEqual({ reported_carriers: [] });
  });
});
