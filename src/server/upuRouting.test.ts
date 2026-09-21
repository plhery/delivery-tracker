import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingRouter } from './trackingRouting';
import { NotFoundError } from '@carriers/core/errors';
import * as observability from './observability';

const number = 'EB000000005CN';
const now = new Date('2026-09-21T12:00:00Z');
const history = { status: 'in_transit', current_stage: 'accepted', last_update: null,
  events: [{ local_time: '2026-09-20T10:00:00', description: 'Posting/Collection', stage: 'accepted' }] };
function setup() {
  vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
  const universal = vi.fn().mockImplementation(async (source) => {
    if (source !== 'UPU') throw new NotFoundError(source);
    return history;
  });
  const direct = vi.fn().mockRejectedValue(new NotFoundError('direct'));
  const health = { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease' }), finishTrackingProvider: vi.fn() };
  return { universal, health, router: new TrackingRouter({ universal, direct, health, now: () => now }) };
}
afterEach(() => vi.restoreAllMocks());

describe('UPU fallback routing', () => {
  it.each([0, 1, 2, 3])('stays last even with a saved UPU preference and discovery cursor %i', async (cursor) => {
    const { router, universal } = setup();
    const value = await router.fetch({ carrier: 'unknown', tracking_number: number, carrier_data: { routing: {
      version: 1, configured_carrier: 'unknown', preferred_provider: 'UPU', discovery_cursor: cursor,
    } } }, true);
    const calls = universal.mock.calls.map(([source]) => source);
    expect(calls.at(-1)).toBe('UPU');
    expect(new Set(calls)).toEqual(new Set(['Ship24', 'ParcelsApp', '17TRACK', 'UPU']));
    expect(value.result.routing).toMatchObject({ preferred_provider: undefined, last_event_at: undefined });
    expect(universal.mock.calls.at(-1)?.[2]).toBeLessThanOrEqual(8000);
  });

  it('keeps richer affinity and retries it first when its cooldown expires', async () => {
    const { router, universal } = setup();
    const parcel = { carrier: 'unknown', tracking_number: number, carrier_data: { routing: {
      version: 1, configured_carrier: 'unknown', preferred_provider: 'ParcelsApp', last_event_at: '2026-09-20T12:00:00Z',
    } } };
    const fallback = await router.fetch(parcel, false);
    expect(fallback.result.routing).toMatchObject({ preferred_provider: 'ParcelsApp', last_event_at: '2026-09-20T12:00:00Z' });
    universal.mockClear().mockResolvedValue(history);
    const retry = new TrackingRouter({ ...router.options, now: () => new Date('2026-09-23T12:00:00Z') });
    await retry.fetch({ ...parcel, carrier_data: fallback.result }, false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp']);
  });

  it('never uses UPU as a shadow comparison for a successful richer provider', async () => {
    const { router, universal } = setup();
    universal.mockResolvedValue(history);
    for (let cursor = 0; cursor < 5; cursor++) {
      await router.fetch({ carrier: 'unknown', tracking_number: number, carrier_data: { routing: {
        version: 1, configured_carrier: 'unknown', preferred_provider: 'Ship24', probe_cursor: cursor,
      } } }, true);
    }
    expect(universal.mock.calls.some(([source]) => source === 'UPU')).toBe(false);
  });

  it.each(['12345678901234', 'EB000000006CN'])('skips UPU and its lease for ineligible %s', async (tracking_number) => {
    const { router, health, universal } = setup();
    await expect(router.fetch({ carrier: 'unknown', tracking_number }, false)).rejects.toThrow();
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['Ship24', 'ParcelsApp', '17TRACK']);
    expect(health.acquireTrackingProvider).not.toHaveBeenCalledWith('UPU');
  });
});
