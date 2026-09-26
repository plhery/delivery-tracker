import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOOP_RECORDER } from '@carriers/core/telemetry';
import { createAdapterRegistry } from './adapterRegistry';
import { buildEvents, CarrierTrackingAdapter, TrackingSyncService } from './trackingSync';
import { TrackingRouter } from './trackingRouting';
import type { UniversalTracker } from './universalTracking';
import type { SupabaseServiceClient } from './supabase';
import type { JsonObject } from './types';
import { directLocalHistory, directLocalSnapshotIsOlder } from './directLocalHistory';
import * as observability from './observability';

const cases = [
  { carrier: 'japan-post', number: 'CN000000005JP', fixture: 'positive',
    latestLocal: '2026-09-04T11:43:00', stage: 'delivered' },
  { carrier: 'evri', number: 'H000000000000001', fixture: 'international',
    latestLocal: '2026-06-08T12:08:00', stage: 'failed_attempt' },
];
const observedAt = new Date('2026-09-26T12:00:00Z');

function setup(carrier: string, fixtureName: string, unknownRegions: 'all' | 'destination' | 'none' = 'all') {
  let html = readFileSync(new URL(`../../packages/carriers/carriers/${carrier}/fixtures/${fixtureName}.html`, import.meta.url), 'utf8');
  // Japan's known single-zone labels can be resolved; a multi-zone country
  // alone cannot establish the offset for these boundary cases.
  if (carrier === 'japan-post' && unknownRegions !== 'none') {
    html = html.replaceAll('MALTA', 'USA');
    if (unknownRegions === 'all') html = html.replaceAll('OSAKA', 'USA').replaceAll('KANAGAWA', 'USA');
  }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(html));
  const universal = { fetch: vi.fn().mockRejectedValue(new Error('Unexpected universal lookup')) };
  const registry = createAdapterRegistry({ fetcher, trawl: null, browserExecutablePath: null,
    env: {}, recorder: NOOP_RECORDER });
  const adapter = new CarrierTrackingAdapter(universal as unknown as UniversalTracker, registry, NOOP_RECORDER);
  return { adapter, fetcher, universal, registry };
}

afterEach(() => vi.restoreAllMocks());

describe('new direct adapters through the host', () => {
  it.each(cases)('$carrier preserves unresolved clocks through registry dispatch and event normalization', async (entry) => {
    const test = setup(entry.carrier, entry.fixture);
    expect(test.registry.adapterIdFor(entry.carrier)).toBe(entry.carrier);
    const result = await test.adapter.fetch(entry.carrier, entry.number, null);
    expect(test.fetcher).toHaveBeenCalledOnce();
    expect(test.universal.fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ current_stage: entry.stage, last_update: null, last_update_local: entry.latestLocal });
    expect(result.events?.every((event) => !event.time && typeof event.local_time === 'string')).toBe(true);

    const parcel = { id: 'example-package', carrier: entry.carrier, current_stage: 'pending' };
    // A wall clock cannot enter the timestamptz timeline as an invented instant.
    expect(buildEvents(parcel, result)).toEqual([]);
    const observations = buildEvents(parcel, result, entry.carrier, observedAt);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ stage: entry.stage, occurred_at: observedAt.toISOString(),
      raw_data: { observed_without_provider_timestamp: true } });
    expect(buildEvents({ ...parcel, current_stage: entry.stage }, result, entry.carrier, observedAt)).toEqual([]);
  });

  it.each(cases)('$carrier cannot advance the routing freshness watermark with local clocks', async (entry) => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const test = setup(entry.carrier, entry.fixture);
    const universal = vi.fn().mockRejectedValue(new Error('Unexpected universal lookup'));
    const router = new TrackingRouter({
      direct: async (parcel, carrier) => ({
        result: await test.adapter.fetch(carrier, String(parcel.tracking_number), null), sourceCarrierId: carrier,
        swissPostReady: null, handoffFallbackErrorType: null,
      }),
      universal,
      health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'example-lease' }), finishTrackingProvider: vi.fn() },
      now: () => observedAt,
    });
    const parcel: JsonObject = { id: 'example-package', carrier: entry.carrier, tracking_number: entry.number };
    const first = await router.fetch(parcel, false);
    expect(first.result).toMatchObject({ direct_local_fallback: true,
      direct_local_history: { carrier: entry.carrier, number: entry.number, last_update_local: entry.latestLocal } });
    expect(first.result.routing).not.toHaveProperty('last_event_at', expect.any(String));

    const previousWatermark = '2026-05-01T10:00:00Z';
    const saved = await router.fetch({ ...parcel, carrier_data: { routing: {
      version: 1, configured_carrier: entry.carrier, confirmed_carrier: entry.carrier,
      confirmed_number: entry.number, last_event_at: previousWatermark,
    } } }, false);
    expect(saved.result.routing).toMatchObject({ last_event_at: previousWatermark });
    expect(universal).toHaveBeenCalled();
  });

  it.each(cases)('$carrier keeps richer universal results and preserves the direct local history', async (entry) => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const test = setup(entry.carrier, entry.fixture);
    const stamp = '2026-09-25T10:00:00Z';
    const universal = vi.fn().mockResolvedValue({ status: 'out_for_delivery', current_stage: 'out_for_delivery',
      last_update: stamp, events: [{ time: stamp, description: 'Out for delivery', stage: 'out_for_delivery' }] });
    const router = new TrackingRouter({
      direct: async (parcel, carrier) => ({ result: await test.adapter.fetch(carrier, String(parcel.tracking_number), null),
        sourceCarrierId: carrier, swissPostReady: null, handoffFallbackErrorType: null }),
      universal,
      health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'example-lease' }), finishTrackingProvider: vi.fn() },
      now: () => observedAt,
    });
    const value = await router.fetch({ id: 'example-package', carrier: entry.carrier, tracking_number: entry.number }, false);
    expect(universal).toHaveBeenCalledOnce();
    expect(value.sourceCarrierId).toBe('unknown');
    expect(value.correction).toBeUndefined();
    expect(value.result).toMatchObject({ last_update: stamp, current_stage: 'out_for_delivery',
      direct_local_history: { carrier: entry.carrier, number: entry.number, events: expect.any(Array) },
      routing: { last_event_at: new Date(stamp).toISOString(), preferred_provider: 'Ship24' } });
    expect(value.result.direct_local_fallback).toBeUndefined();
  });

  it.each(cases)('$carrier retains richer saved progress when only local direct evidence remains', async (entry) => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const test = setup(entry.carrier, entry.fixture);
    const direct = await test.adapter.fetch(entry.carrier, entry.number, null);
    const client = {
      autoLinkPackages: vi.fn().mockResolvedValue(0), startSyncAttempt: vi.fn(), completeSyncAttempt: vi.fn().mockResolvedValue(true),
      recordTrackingHealth: vi.fn().mockResolvedValue([]), ackTrackingHealth: vi.fn(), recordTrackingStatusObservations: vi.fn(),
      applyTrackingSync: vi.fn().mockResolvedValue(true), acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'example-lease' }),
      finishTrackingProvider: vi.fn(),
    };
    const adapter = { fetch: vi.fn().mockResolvedValue(direct), fetchUniversal: vi.fn().mockRejectedValue(new Error('Unavailable')) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => observedAt);
    const parcel = { id: 'example-package', carrier: entry.carrier, tracking_number: entry.number, current_stage: 'out_for_delivery',
      last_status_text: 'Out for delivery', carrier_data: { tracking_provider: 'Ship24',
        routing: { version: 1, configured_carrier: entry.carrier, last_event_at: '2026-09-25T10:00:00Z' } } };
    await service.syncPackage(parcel);
    const saved = client.applyTrackingSync.mock.calls.at(-1)!;
    expect(saved[1]).not.toHaveProperty('current_stage');
    expect(saved[1]).not.toHaveProperty('last_status_text');
    expect(saved[2] ?? []).toEqual([]);
    expect(saved[1]).toMatchObject({ carrier_data: { tracking_provider: 'Ship24', direct_local_history: {
      carrier: entry.carrier, number: entry.number, events: expect.any(Array),
    } } });
  });

  it('keeps a bounded archive across shorter responses and later provider recovery', () => {
    const archive = { carrier: 'evri', number: 'H000000000000001', events: [
      { local_time: '2026-09-25T10:00:00', description: 'Latest scan' },
      { local_time: '2026-09-24T10:00:00', description: 'Earlier scan' },
    ] };
    const parcel = { tracking_number: archive.number, carrier_data: { direct_local_history: archive } };
    expect(directLocalHistory(parcel, { tracking_provider: 'Ship24' })).toEqual(archive);
    expect(directLocalHistory(parcel, { direct_local_history: { ...archive, events: archive.events.slice(0, 1) } })?.events).toHaveLength(2);
    expect(directLocalHistory(parcel, { direct_local_history: { ...archive, events: archive.events.slice(1) } })?.events).toEqual(archive.events);
    expect(directLocalSnapshotIsOlder(archive, { events: archive.events.slice(1) })).toBe(true);
    expect(directLocalSnapshotIsOlder(archive, { events: [{ local_time: '2026-09-24T09:00:00', description: 'New scan in a different timezone' }] })).toBe(false);
    expect(directLocalHistory({ ...parcel, tracking_number: 'H000000000000002' }, { tracking_provider: 'Ship24' })).toBeUndefined();
    const many = { ...archive, events: Array.from({ length: 105 }, (_, index) => ({ local_time: `example-${index}` })) };
    expect(directLocalHistory(parcel, { direct_local_history: many })?.events).toHaveLength(100);
  });

  it('tries richer history when Japan has resolved origin scans but unresolved destination progress', async () => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const test = setup('japan-post', 'positive', 'destination');
    const direct = await test.adapter.fetch('japan-post', 'CN000000005JP', null);
    expect(direct.events?.some((event) => event.time)).toBe(true);
    expect(direct.last_update).toBeNull();
    const universal = vi.fn().mockResolvedValue({ status: 'delivered', current_stage: 'delivered',
      last_update: '2026-09-04T09:43:00Z', events: [{ time: '2026-09-04T09:43:00Z', stage: 'delivered' }] });
    const router = new TrackingRouter({
      direct: async () => ({ result: direct, sourceCarrierId: 'japan-post', swissPostReady: null, handoffFallbackErrorType: null }),
      universal, health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'example-lease' }), finishTrackingProvider: vi.fn() },
      now: () => observedAt,
    });
    const value = await router.fetch({ carrier: 'japan-post', tracking_number: 'CN000000005JP' }, false);
    expect(universal).toHaveBeenCalledOnce();
    expect(value.result).toMatchObject({ tracking_provider: 'Ship24', direct_local_history: { events: expect.any(Array) } });
    expect(value.result.direct_local_fallback).toBeUndefined();
  });

  it('does not promote an unresolved discovered carrier over a dated provider result', async () => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const test = setup('evri', 'international');
    const direct = await test.adapter.fetch('evri', 'H000000000000001', null);
    const router = new TrackingRouter({
      direct: async () => ({ result: direct, sourceCarrierId: 'evri', swissPostReady: null, handoffFallbackErrorType: null }),
      universal: async () => ({ status: 'out_for_delivery', current_stage: 'out_for_delivery', discovered_carrier: 'evri',
        last_update: '2026-09-25T10:00:00Z', events: [{ time: '2026-09-25T10:00:00Z', stage: 'out_for_delivery' }] }),
      health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'example-lease' }), finishTrackingProvider: vi.fn() },
      now: () => observedAt,
    });
    const value = await router.fetch({ carrier: 'unknown', tracking_number: 'H000000000000001' }, false);
    expect(value.correction).toBeUndefined();
    expect(value.result).toMatchObject({ tracking_provider: 'Ship24', current_stage: 'out_for_delivery',
      direct_local_history: { carrier: 'evri', number: 'H000000000000001' } });
  });

  it('binds an existing delivery-leg archive to the returned carrier and active tracking number', async () => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const test = setup('evri', 'international');
    const direct = await test.adapter.fetch('evri', 'H000000000000001', null);
    const router = new TrackingRouter({
      direct: async () => ({ result: direct, sourceCarrierId: 'evri', swissPostReady: null, handoffFallbackErrorType: null }),
      universal: async () => ({ status: 'out_for_delivery', last_update: '2026-09-25T10:00:00Z',
        events: [{ time: '2026-09-25T10:00:00Z', stage: 'out_for_delivery' }] }),
      health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'example-lease' }), finishTrackingProvider: vi.fn() },
      now: () => observedAt,
    });
    const parcel = { carrier: 'dhl', tracking_number: '0000000001', carrier_data: {
      original_carrier: 'dhl', active_tracking_carrier: 'evri', active_tracking_number: 'H000000000000001',
    } };
    const value = await router.fetch(parcel, false);
    const archive = directLocalHistory(parcel, value.result);
    expect(archive).toMatchObject({ carrier: 'evri', number: 'H000000000000001', events: expect.any(Array) });
    expect(directLocalHistory({ ...parcel, carrier_data: { ...parcel.carrier_data,
      active_tracking_number: 'H000000000000002' } }, value.result)).toBeUndefined();
  });
});
