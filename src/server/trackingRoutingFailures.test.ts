import { afterEach, expect, it, vi } from 'vitest';
import { UpstreamHttpError } from 'universal-parcel-scraper/node';
import { RoutingDeferred, routingState, TrackingRouter } from './trackingRouting';
import type { JsonObject } from './types';
import * as monitoring from './observability';

const HOUR = 3_600_000;
const success = '2026-09-10T10:00:00.000Z';
const parcel = (routing: JsonObject = {}): JsonObject => ({
  id: 'hourly', carrier: 'ups', tracking_number: 'TEST1234', current_stage: 'in_transit',
  sync_status: 'ok', last_synced_at: success,
  carrier_data: { routing: { version: 1, configured_carrier: 'ups', last_success_at: success, ...routing } },
});
function setup(time = '2026-09-10T11:00:00.000Z') {
  vi.spyOn(monitoring, 'reportRoutingEvent').mockImplementation(() => undefined);
  let now = new Date(time);
  const direct = vi.fn().mockRejectedValue(new Error('carrier down'));
  const universal = vi.fn().mockRejectedValue(new Error('provider down'));
  const health = {
    acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: time }),
    finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
  };
  const router = () => new TrackingRouter({ direct, universal, health, now: () => now });
  return { direct, universal, health, router, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}
async function missed(router: TrackingRouter, snapshot: JsonObject): Promise<RoutingDeferred> {
  try { await router.fetch(snapshot, false); }
  catch (error) { if (error instanceof RoutingDeferred) return error; throw error; }
  throw new Error('Expected every source to fail');
}
afterEach(() => vi.restoreAllMocks());

it('keeps an hourly parcel clear after one missed check, shows the chip after two, and clears on recovery', async () => {
  const run = setup();
  const first = await missed(run.router(), parcel());
  expect(first).toMatchObject({ stale: false, attempted: 4, routing: { consecutive_failures: 1, last_success_at: success } });
  run.advance(HOUR);
  const second = await missed(run.router(), parcel(first.routing));
  expect(second).toMatchObject({ stale: true, routing: { consecutive_failures: 2, last_success_at: success } });
  run.advance(HOUR);
  run.direct.mockResolvedValue({ result: { status: 'in_transit', current_stage: 'in_transit' },
    sourceCarrierId: 'ups', swissPostReady: null, handoffFallbackErrorType: null });
  const recovered = await run.router().fetch(parcel(second.routing), false);
  expect(recovered.result.routing).toMatchObject({ consecutive_failures: 0, last_success_at: '2026-09-10T13:00:00.000Z' });
  run.advance(HOUR);
  run.direct.mockRejectedValue(new Error('carrier down'));
  expect(await missed(run.router(), parcel(recovered.result.routing as JsonObject)))
    .toMatchObject({ stale: false, routing: { consecutive_failures: 1 } });
});

it.each([
  ['2026-09-10T10:15:00Z', '2026-09-10T10:00:00Z', HOUR],
  ['2026-09-10T23:15:00Z', '2026-09-10T23:00:00Z', 3 * HOUR],
])('keeps the freshness window for frequently checked parcels at %s', async (start, lastSuccess, window) => {
  const run = setup(start);
  let snapshot = parcel({ last_success_at: lastSuccess });
  for (let elapsed = 15 * 60_000; elapsed < window; elapsed += 15 * 60_000) {
    // Clear provider cooldowns so this models actual checks at the chosen cadence.
    const error = await missed(run.router(), snapshot);
    expect(error.stale).toBe(false);
    snapshot = parcel({ ...error.routing, failures: {} });
    run.advance(15 * 60_000);
  }
  expect(await missed(run.router(), snapshot)).toMatchObject({ stale: true });
});

it.each([0, 1, 2])('leaves a streak of %s unchanged when no source is contacted', async (streak) => {
  const run = setup();
  const failures = Object.fromEntries(['ups', 'ParcelsApp', 'Ship24', '17TRACK'].map(source => [source,
    { count: 1, kind: 'transport', retry_at: '2026-09-10T13:00:00Z' }]));
  expect(await missed(run.router(), parcel({ consecutive_failures: streak, failures })))
    .toMatchObject({ stale: streak >= 2, attempted: 0, routing: { consecutive_failures: streak } });
  expect(run.direct).not.toHaveBeenCalled();
  expect(run.universal).not.toHaveBeenCalled();
});

it('counts an early rate-limit deferral and resets the streak when a fallback succeeds', async () => {
  const run = setup('2026-09-10T10:15:00Z');
  run.direct.mockRejectedValue(new UpstreamHttpError('UPS', 429));
  const first = await missed(run.router(), parcel());
  expect(first).toMatchObject({ stale: false, attempted: 1, routing: { consecutive_failures: 1 } });
  expect(run.universal).not.toHaveBeenCalled();
  run.advance(HOUR);
  run.universal.mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit' });
  expect((await run.router().fetch(parcel(first.routing), false)).result.routing)
    .toMatchObject({ consecutive_failures: 0 });
});

it('gives a parcel with no previous success one missed check of grace', async () => {
  const run = setup();
  expect(await missed(run.router(), { id: 'new', carrier: 'ups', tracking_number: 'TEST1234', current_stage: 'pending' }))
    .toMatchObject({ stale: false, routing: { consecutive_failures: 1 } });
});

it.each([undefined, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1])('starts malformed or absent streaks from zero: %s', (streak) => {
  expect(routingState(parcel({ consecutive_failures: streak })).consecutive_failures).toBe(0);
});

it('resets a streak when the configured carrier changes', () => {
  expect(routingState(parcel({ configured_carrier: 'dhl', consecutive_failures: 2 })).consecutive_failures).toBe(0);
});
