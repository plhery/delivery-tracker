import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingSyncService } from './trackingSync';
import { upuHistory } from './upuHistory';
import { parseUpuResponse } from '@carriers/providers/upu/adapter';
import { NotFoundError } from '@carriers/core/errors';
import type { SupabaseServiceClient } from './supabase';
import { isRecord, type JsonObject } from './types';
import * as observability from './observability';

const number = 'EB000000005CN';
const now = new Date('2026-09-21T12:00:00Z');
const scan = (EventCd: string, EventNm: string, EventDT: string) => ({ EventCd, EventNm, EventDT });
const first = scan('EMA', 'Posting/Collection', '2026-09-18T10:00:00Z');
const second = scan('EMB', 'Arrival at outward office of exchange', '2026-09-19T10:00:00Z');
const third = scan('EMC', 'Departure from outward office of exchange', '2026-09-20T10:00:00Z');
const parse = (Events = [first, second]) => parseUpuResponse([{ ID: number, Events }], number);
afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
  const client = {
    autoLinkPackages: vi.fn().mockResolvedValue(0),
    startSyncAttempt: vi.fn(), completeSyncAttempt: vi.fn().mockResolvedValue(true),
    recordTrackingHealth: vi.fn().mockResolvedValue([]), ackTrackingHealth: vi.fn(), recordTrackingStatusObservations: vi.fn(),
    applyTrackingSync: vi.fn().mockResolvedValue(true),
    acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease' }), finishTrackingProvider: vi.fn(),
  };
  let result = parse();
  const adapter = { fetch: vi.fn().mockRejectedValue(new NotFoundError('direct')),
    fetchUniversal: vi.fn().mockImplementation(async (source) => {
      if (source !== 'UPU') throw new NotFoundError(source);
      return result;
    }) };
  let clock = now;
  const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => clock);
  return { client, service, next: (value: ReturnType<typeof parse>) => { result = value; clock = new Date(clock.getTime() + 3_600_000); },
    saved: () => client.applyTrackingSync.mock.calls.at(-1)![1] as JsonObject,
    events: () => (client.applyTrackingSync.mock.calls.at(-1)![2] ?? []) as JsonObject[],
  };
}

describe('UPU history persistence', () => {
  it('retains omitted scans, deduplicates repeats and keeps the archive through richer-provider recovery', () => {
    const original = upuHistory({ tracking_number: number }, parse(), now)!;
    const parcel = { tracking_number: number, carrier_data: { upu_history: original } };
    const shorter = upuHistory(parcel, parse([second]), new Date('2026-09-22T12:00:00Z'))!;
    expect(shorter).toEqual(original);
    expect(upuHistory(parcel, { tracking_provider: 'Ship24' }, now)).toEqual(original);
    const changedNumber = upuHistory({ tracking_number: 'EB000000014CN', carrier_data: { upu_history: original } }, parse([second]), now)!;
    expect(changedNumber.events).toHaveLength(1);
  });

  it('stores observed progress without fabricating scan instants, including new scans within the same stage', async () => {
    const test = setup();
    let parcel: JsonObject = { id: 'postal', carrier: 'unknown', tracking_number: number, current_stage: 'pending' };
    await expect(test.service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1 });
    expect(test.events()).toMatchObject([{ occurred_at: now.toISOString(), raw_data: {
      observed_without_provider_timestamp: true, local_time: '2026-09-19T10:00:00', provider_code: 'EMB',
    } }]);
    const initialId = test.events()[0].provider_event_id;
    parcel = { ...parcel, ...test.saved() };
    test.next(parse([second]));
    await test.service.syncPackage(parcel);
    expect(test.events()).toEqual([]);
    parcel = { ...parcel, ...test.saved() };
    test.next(parse([third]));
    await test.service.syncPackage(parcel);
    expect(test.events()).toHaveLength(1);
    expect(test.events()[0].provider_event_id).not.toBe(initialId);
    const data = test.saved().carrier_data;
    expect(isRecord(data) && isRecord(data.upu_history) && data.upu_history.events).toHaveLength(3);
    expect(data).toMatchObject({ routing: { last_event_at: undefined }, last_update_local: '2026-09-20T10:00:00' });
    // No descriptions are ever passed for deletion by the postal fallback.
    expect(test.client.applyTrackingSync.mock.calls.every((call) => !call[3]?.length)).toBe(true);
  });

  it.each(['Ship24', undefined])('keeps saved richer progress from %s while retaining UPU evidence', async (provider) => {
    const test = setup();
    const parcel = { id: 'postal', carrier: 'unknown', tracking_number: number, current_stage: 'out_for_delivery',
      last_status_text: 'Out for delivery', carrier_data: { tracking_provider: provider,
        routing: { version: 1, configured_carrier: 'unknown', last_event_at: '2026-09-21T11:00:00Z' } } };
    await test.service.syncPackage(parcel);
    expect(test.saved()).not.toHaveProperty('current_stage');
    expect(test.saved()).not.toHaveProperty('last_status_text');
    expect(test.events()).toEqual([]);
    expect(test.saved().carrier_data).toMatchObject({ tracking_provider: provider,
      routing: { last_event_at: '2026-09-21T11:00:00Z' }, upu_history: { number, events: expect.any(Array) } });
  });

  it('keeps a newer UPU summary when a later response shrinks to an older scan', async () => {
    const test = setup();
    let parcel: JsonObject = { id: 'postal', carrier: 'unknown', tracking_number: number, current_stage: 'pending' };
    await test.service.syncPackage(parcel);
    parcel = { ...parcel, ...test.saved() };
    test.next(parse([first]));
    await test.service.syncPackage(parcel);
    expect(test.saved()).not.toHaveProperty('current_stage');
    expect(test.events()).toEqual([]);
    expect(test.saved().carrier_data).toMatchObject({ last_update_local: '2026-09-19T10:00:00',
      upu_history: { events: expect.arrayContaining([expect.objectContaining({ provider_code: 'EMA' }), expect.objectContaining({ provider_code: 'EMB' })]) } });
  });
});
