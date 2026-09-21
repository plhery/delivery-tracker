import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingRouter } from './trackingRouting';
import { NotFoundError, ChallengeError } from '@carriers/core/errors';
import * as observability from './observability';

const number = 'LZ000000005CN';
const now = new Date('2026-09-22T12:00:00Z');
const history = { status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-20T10:00:00Z',
  events: [{ time: '2026-09-20T10:00:00Z', description: 'In transit', stage: 'in_transit' }] };
function setup() {
  vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
  const direct = vi.fn().mockRejectedValue(new NotFoundError('direct'));
  const universal = vi.fn().mockResolvedValue(history);
  const health = { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease' }), finishTrackingProvider: vi.fn() };
  return { direct, universal, health, router: new TrackingRouter({ direct, universal, health, now: () => now }) };
}
const parcel = (routing = {}) => ({ carrier: 'china-post', tracking_number: number,
  carrier_data: { routing: { version: 1, configured_carrier: 'china-post', ...routing } } });
afterEach(() => vi.restoreAllMocks());

describe('China Post provider priority', () => {
  it.each([0, 1, 2, 3])('overrides saved affinity and discovery rotation %i without shadow calls', async (discovery_cursor) => {
    const { router, universal } = setup();
    const result = await router.fetch(parcel({ preferred_provider: 'Ship24', discovery_cursor }), true);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['17TRACK']);
    expect(result.result.routing).toMatchObject({ preferred_provider: '17TRACK' });
    universal.mockClear();
    await router.fetch({ ...parcel(), carrier_data: result.result }, true);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['17TRACK']);
  });

  it('falls back after a challenge, respects cooldown, then retries 17TRACK before the saved fallback', async () => {
    const { router, universal } = setup();
    universal.mockRejectedValueOnce(new ChallengeError('17TRACK'));
    const first = await router.fetch(parcel(), false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['17TRACK', 'Ship24']);
    universal.mockClear();
    const second = await router.fetch({ ...parcel(), carrier_data: first.result }, false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['Ship24']);
    universal.mockClear();
    await new TrackingRouter({ ...router.options, now: () => new Date(now.getTime() + 3_600_001) })
      .fetch({ ...parcel(), carrier_data: second.result }, false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['17TRACK']);
  });

  it('respects shared health and keeps UPU last when every richer source fails', async () => {
    const { router, universal, health } = setup();
    health.acquireTrackingProvider.mockImplementation(async (source) => source === '17TRACK'
      ? { token: null, retry_at: new Date(now.getTime() + 60_000).toISOString() } : { token: 'lease' });
    universal.mockImplementation(async (source) => {
      if (source !== 'UPU') throw new NotFoundError(source);
      return history;
    });
    await router.fetch(parcel({ discovery_cursor: 2, preferred_provider: 'Ship24' }), false);
    expect(health.acquireTrackingProvider.mock.calls[0]).toEqual(['17TRACK']);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['Ship24', 'ParcelsApp', 'UPU']);
  });

  it('leaves a selected EMS carrier on its direct adapter', async () => {
    const { router, direct, universal } = setup();
    direct.mockResolvedValue({ result: history, sourceCarrierId: 'ems', swissPostReady: null, handoffFallbackErrorType: null });
    await router.fetch({ carrier: 'ems', tracking_number: 'EB000000005CN' }, false);
    expect(direct).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'ems' }), 'ems');
    expect(universal).not.toHaveBeenCalled();
  });

  it('uses a confirmed destination route and its active number before postal priority', async () => {
    const { router, direct, universal } = setup();
    direct.mockResolvedValue({ result: history, sourceCarrierId: 'usps', swissPostReady: null, handoffFallbackErrorType: null });
    await router.fetch({ carrier: 'usps', tracking_number: number, carrier_data: {
      original_carrier: 'china-post', active_tracking_carrier: 'usps', active_tracking_number: 'USPS1234',
    } }, false);
    expect(direct).toHaveBeenCalledOnce();
    expect(universal).not.toHaveBeenCalled();
  });
});
