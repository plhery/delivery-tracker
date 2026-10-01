import { carrierResult } from '../test/carrierResults';
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CarrierResult } from 'universal-parcel-scraper';
import { TrackingRouter } from './trackingRouting';
import { buildEvents, TrackingSyncService } from './trackingSync';
import type { SupabaseServiceClient } from './supabase';
import { directLocalHistory } from './directLocalHistory';
import * as observability from './observability';

const number = '99000Z000001';
const observedAt = new Date('2026-09-25T12:00:00Z');
const summary: CarrierResult = { status: 'delivered', current_stage: 'delivered',
  last_status_text: 'Entregado', last_update: null, summary_only: true, events: [] };
const parcel = { id: 'synthetic-package', carrier: 'mrw', tracking_number: number };
const health = () => ({ acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'synthetic-lease' }),
  finishTrackingProvider: vi.fn() });

function router(universal: ConstructorParameters<typeof TrackingRouter>[0]['universal']) {
  vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
  return new TrackingRouter({ direct: async () => ({ result: structuredClone(summary), sourceCarrierId: 'mrw',
    swissPostReady: null, handoffFallbackErrorType: null }), universal, health: health(), now: () => observedAt });
}

afterEach(() => vi.restoreAllMocks());

describe('MRW summary fallback', () => {
  it('dispatches native history through the registered factory and keeps its local clocks as evidence', { timeout: 10_000 }, async () => {
    const direct = carrierResult('mrw-delivered');
    expect(direct).toMatchObject({ current_stage: 'delivered', last_update: null, last_update_local: '2026-09-10T19:29:00' });
    expect(direct.events).toHaveLength(5);
    expect(direct.events?.every(event => !event.time && typeof event.local_time === 'string')).toBe(true);
    expect(buildEvents(parcel, direct)).toEqual([]);
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const universal = vi.fn().mockResolvedValue({ status: 'delivered', current_stage: 'delivered',
      last_update: '2026-09-10T17:29:00Z', events: [{ time: '2026-09-10T17:29:00Z', stage: 'delivered' }] });
    const value = await new TrackingRouter({ direct: async () => ({ result: direct, sourceCarrierId: 'mrw',
      swissPostReady: null, handoffFallbackErrorType: null }), universal, health: health(), now: () => observedAt }).fetch(parcel, false);
    expect(universal).toHaveBeenCalledOnce();
    expect(value.result).toMatchObject({ tracking_provider: universal.mock.calls[0][0],
      direct_local_history: { carrier: 'mrw', number, events: direct.events?.map(event => expect.objectContaining({
        local_time: event.local_time, description: event.description, stage: event.stage, location: event.location,
      })) } });
  });

  it('keeps a dated provider timeline when the carrier has only a status summary', async () => {
    const stamp = '2026-09-24T10:00:00Z';
    const events = [{ time: stamp, stage: 'delivered', description: 'Delivered' }];
    const universal = vi.fn().mockResolvedValue({ status: 'delivered', current_stage: 'delivered', last_update: stamp, events });
    const value = await router(universal).fetch(parcel, false);
    expect(universal).toHaveBeenCalledOnce();
    expect(value.result).toMatchObject({ last_update: stamp, events, carrier_answered: true,
      tracking_provider: universal.mock.calls[0][0],
      routing: { last_event_at: '2026-09-24T10:00:00.000Z', direct_retry_at: '2026-09-25T18:00:00.000Z' } });
    expect(value.result).not.toHaveProperty('summary_only');
    expect(value.result).not.toHaveProperty('direct_local_fallback');
  });

  it('returns the bound native summary when providers fail without creating a scan instant', async () => {
    const universal = vi.fn().mockRejectedValue(new Error('Unavailable'));
    const value = await router(universal).fetch(parcel, false);
    expect(universal).toHaveBeenCalled();
    expect(value.result).toMatchObject({ ...summary, direct_local_fallback: true,
      direct_local_history: { carrier: 'mrw', number, events: [] } });
    expect(value.result.routing).not.toHaveProperty('last_event_at', expect.any(String));
    expect(buildEvents({ ...parcel, current_stage: 'pending' }, value.result)).toEqual([]);
    expect(buildEvents({ ...parcel, current_stage: 'pending' }, value.result, 'mrw', observedAt)).toEqual([
      expect.objectContaining({ stage: 'delivered', occurred_at: observedAt.toISOString(),
        raw_data: expect.objectContaining({ observed_without_provider_timestamp: true }) }),
    ]);
  });

  it('preserves richer saved MRW history when a later lookup contains only a summary', async () => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const savedEvents = [{ local_time: '2026-09-24T10:00:00', description: 'En tránsito', stage: 'in_transit' }];
    const client = { ...health(), autoLinkPackages: vi.fn().mockResolvedValue(0), startSyncAttempt: vi.fn(),
      completeSyncAttempt: vi.fn().mockResolvedValue(true), recordTrackingHealth: vi.fn().mockResolvedValue([]),
      ackTrackingHealth: vi.fn(), recordTrackingStatusObservations: vi.fn(), applyTrackingSync: vi.fn().mockResolvedValue(true) };
    const adapter = { fetch: vi.fn().mockResolvedValue(structuredClone(summary)),
      fetchUniversal: vi.fn().mockRejectedValue(new Error('Unavailable')) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => observedAt);
    await service.syncPackage({ ...parcel, current_stage: 'in_transit', last_status_text: 'En tránsito',
      carrier_data: { direct_local_fallback: true, direct_local_history: { carrier: 'mrw', number,
        last_update_local: '2026-09-24T10:00:00', events: savedEvents } } });
    const saved = client.applyTrackingSync.mock.calls.at(-1)!;
    expect(saved[1]).not.toHaveProperty('current_stage');
    expect(saved[1]).not.toHaveProperty('last_status_text');
    expect(saved[2] ?? []).toEqual([]);
    expect(saved[1]).toMatchObject({ carrier_data: { direct_local_history: { carrier: 'mrw', number,
      last_update_local: '2026-09-24T10:00:00', events: savedEvents } } });
  });

  it.each([false, true])('keeps MRW history when an unresolved discovered carrier cannot be adopted (direct retry deferred: %s)', async deferred => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const trackingNumber = '990000000001';
    const archive = { carrier: 'mrw', number: trackingNumber, last_update_local: '2026-09-24T10:00:00',
      events: [{ local_time: '2026-09-24T10:00:00', description: 'En tránsito', stage: 'in_transit' }] };
    const saved = { ...parcel, tracking_number: trackingNumber, carrier_data: { direct_local_history: archive,
      ...(deferred ? { routing: { version: 1, configured_carrier: 'mrw', preferred_provider: 'Ship24',
        direct_retry_at: '2026-09-25T18:00:00Z' } } : {}) } };
    const direct = vi.fn(async (_parcel, carrier: string) => ({ sourceCarrierId: carrier, swissPostReady: null,
      handoffFallbackErrorType: null, result: carrier === 'mrw' ? structuredClone(summary) : {
        status: 'delivered' as const, current_stage: 'delivered', last_update: null,
        events: [{ local_time: '2026-09-24T11:00:00', description: 'Delivered', stage: 'delivered' }],
      } }));
    const universal = vi.fn().mockResolvedValue({ status: 'delivered', current_stage: 'delivered',
      discovered_carrier: 'aramex', last_update: '2026-09-24T10:00:00Z',
      events: [{ time: '2026-09-24T10:00:00Z', stage: 'delivered' }] });
    const value = await new TrackingRouter({ direct, universal, health: health(), now: () => observedAt }).fetch(saved, false);
    expect(direct.mock.calls.some(([, carrier]) => carrier === 'aramex')).toBe(true);
    expect(value.correction).toBeUndefined();
    expect(directLocalHistory(saved, value.result)).toEqual(archive);
  });
});
