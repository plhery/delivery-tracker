import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmazonLogisticsTracker } from './amazonLogistics';
import { secondsUntilNextSync, workerPollDelay } from './background';
import { normalizeCarrierResult, type CarrierResult } from './carrierResult';
import { ColisPriveTracker, ColisPriveTrackingError } from './colisPrive';
import { ColiswebTracker } from './colisweb';
import { CChezVousTracker } from './cChezVous';
import { CiblexTracker } from './ciblex';
import { DPDFranceTracker } from './dpdFrance';
import { GeodisTracker } from './geodis';
import { GLSFranceTracker } from './glsFrance';
import { GLSSwitzerlandTracker } from './glsSwitzerland';
import { HeppnerTracker } from './heppner';
import { IndiaPostTracker } from './indiaPost';
import { LaPosteTracker } from './laPoste';
import { MondialRelayTracker } from './mondialRelay';
import { PaackTracker } from './paack';
import { RelaisColisTracker } from './relaisColis';
import { SwissPostCargoTracker } from './swissPostCargo';
import type { SupabaseServiceClient } from './supabase';
import {
  CarrierTrackingAdapter,
  buildEvents,
  detectSyncAnomalies,
  eventTimestamp,
  fairSyncPackages,
  inferStage,
  isTrackingSyncDue,
  isUnannouncedTrackingError,
  providerEventId,
  resultHasUpdate,
  resultStage,
  TrackingSyncService,
  type TrackingAdapter,
} from './trackingSync';
import type { JsonObject } from './types';

afterEach(() => vi.restoreAllMocks());

describe('dedicated carrier dispatch', () => {
  it('routes every dedicated regional carrier to its isolated adapter', async () => {
    const laPoste = vi.spyOn(LaPosteTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const glsFrance = vi.spyOn(GLSFranceTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const colisPrive = vi.spyOn(ColisPriveTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const geodis = vi.spyOn(GeodisTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const dpdFrance = vi.spyOn(DPDFranceTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const mondialRelay = vi.spyOn(MondialRelayTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const relaisColis = vi.spyOn(RelaisColisTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const swissPostCargo = vi.spyOn(SwissPostCargoTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const glsSwitzerland = vi.spyOn(GLSSwitzerlandTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const colisweb = vi.spyOn(ColiswebTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const cChezVous = vi.spyOn(CChezVousTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const heppner = vi.spyOn(HeppnerTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const ciblex = vi.spyOn(CiblexTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const paack = vi.spyOn(PaackTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const amazonLogistics = vi.spyOn(AmazonLogisticsTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const indiaPost = vi.spyOn(IndiaPostTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit' });
    const adapter = new CarrierTrackingAdapter();

    await adapter.fetch('la-poste', '8G12345678901', null);
    await adapter.fetch('chronopost', 'PZ123456785JF', null);
    await adapter.fetch('gls-fr', '00AB12CD', null);
    await adapter.fetch('colis-prive', '99112233445575012', null);
    await adapter.fetch('geodis', '1G123GEODIS0', null);
    await adapter.fetch('dpd-fr', '250123456789012', null);
    await adapter.fetch('mondial-relay', '76434219', null, '59650');
    await adapter.fetch('relais-colis', 'CC200000000401', null);
    await adapter.fetch('swiss-post-cargo', '1234ABC789', null);
    await adapter.fetch('gls-ch', '993990103198', null, '8000');
    await adapter.fetch('colisweb', '12345678', null);
    await adapter.fetch('c-chez-vous', 'FGRC45BKLM', null);
    await adapter.fetch('heppner', '23456789', null, '75001');
    await adapter.fetch('ciblex', '12345678901234', null);
    await adapter.fetch('paack', 'ORDER1234', null, '75001');
    await adapter.fetch('amazon-logistics', 'FR1234567890', null);
    await adapter.fetch('india-post', 'JN067614884IN', null);

    expect(laPoste).toHaveBeenNthCalledWith(1, '8G12345678901');
    expect(laPoste).toHaveBeenNthCalledWith(2, 'PZ123456785JF');
    expect(glsFrance).toHaveBeenCalledWith('00AB12CD');
    expect(colisPrive).toHaveBeenCalledWith('99112233445575012');
    expect(geodis).toHaveBeenCalledWith('1G123GEODIS0');
    expect(dpdFrance).toHaveBeenCalledWith('250123456789012');
    expect(mondialRelay).toHaveBeenCalledWith('76434219', '59650');
    expect(relaisColis).toHaveBeenCalledWith('CC200000000401');
    expect(swissPostCargo).toHaveBeenCalledWith('1234ABC789');
    expect(glsSwitzerland).toHaveBeenCalledWith('993990103198', '8000');
    expect(colisweb).toHaveBeenCalledWith('12345678');
    expect(cChezVous).toHaveBeenCalledWith('FGRC45BKLM');
    expect(heppner).toHaveBeenCalledWith('23456789', '75001');
    expect(ciblex).toHaveBeenCalledWith('12345678901234');
    expect(paack).toHaveBeenCalledWith('ORDER1234', '75001');
    expect(amazonLogistics).toHaveBeenCalledWith('FR1234567890');
    expect(indiaPost).toHaveBeenCalledWith('JN067614884IN');
  });
});

describe('tracking event normalization', () => {
  it.each(['2026-09-07', '2026-09-07T12:32:00Z'])('preserves the precision of a status-only timestamp: %s', (time) => {
    const events = buildEvents({ id: 'package-1', carrier: 'dpd' }, {
      status: 'delivered', last_status_text: 'Delivered', last_update: time,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.raw_data).toEqual({ time });
  });

  it('prioritizes exception and final-stage phrases before broad delivery words', () => {
    expect(inferStage('Delivery attempt failed')).toBe('failed_attempt');
    expect(inferStage('Return to sender')).toBe('returned');
    expect(inferStage('Parcel handed to DPD')).toBe('accepted');
    expect(inferStage('To be delivered')).toBe('in_transit');
  });

  it('normalizes zoneless carrier timestamps into UTC', () => {
    expect(eventTimestamp('15.07.2026 10:00', 'Europe/Zurich'))
      .toBe('2026-07-15T08:00:00Z');
    expect(eventTimestamp('not-a-date', 'Europe/Zurich')).toBeNull();
  });

  it('does not label unrecognized historical scans with the current delivered status', () => {
    const events = buildEvents({ id: 'package-1', carrier: 'ups' }, {
      status: 'delivered', last_status_text: 'Delivered',
      events: [
        { time: '2026-07-15T12:00:00Z', description: 'Delivered' },
        { time: '2026-07-14T12:00:00Z', description: 'Carrier-specific scan' },
        { time: '2026-07-13T12:00:00Z', description: 'Shipper created a label, UPS has not received the package yet.' },
      ],
    });
    expect(events.map((event) => event.stage)).toEqual(['delivered', 'in_transit', 'registered']);
  });

  it.each([
    ['Sorting - forwarding', 'in_transit'],
    ['REPORTED', 'registered'],
    ['Paket wurde elektronisch angekündigt', 'registered'],
    ['Import Scan', 'in_transit'],
    ['Your package is on the way', 'in_transit'],
    ['Delivery will be delayed by one business day.', 'in_transit'],
    ['Your package has been released by a government agency.', 'in_transit'],
    ['The parcel has not been released by customs.', 'customs'],
    ["Your package is pending release from a Government Agency. We'll notify the receiver or sender if information is needed.", 'customs'],
    ['Deposited in the MyPost24 machine', 'ready_for_pickup'],
    ['Delivered to the mailbox/letter box', 'delivered'],
  ])('classifies %s independently of a final fallback', (description, stage) => {
    expect(inferStage(description, 'delivered')).toBe(stage);
  });

  it('uses the summary for an observed update rather than borrowing an unrelated history description', () => {
    const events = buildEvents({ id: 'package-1', carrier: 'ups', current_stage: 'in_transit' }, {
      status: 'delivered', last_status_text: 'Delivered',
      events: [{ time: '2026-07-14T12:00:00Z', description: 'Carrier-specific scan' }],
    }, undefined, new Date('2026-07-15T12:00:00Z'));
    expect(events.map(({ stage, description }) => ({ stage, description }))).toEqual([
      { stage: 'in_transit', description: 'Carrier-specific scan' },
      { stage: 'delivered', description: 'Delivered' },
    ]);
  });

  it('creates stable provider ids and drops events without usable timestamps', () => {
    const result: CarrierResult = {
      status: 'in_transit',
      events: [
        { time: '2026-07-15T08:00:00Z', description: 'Sorted', location: 'Härkingen' },
        { time: '', description: 'No time' },
      ],
    };
    const rows = buildEvents({ id: 'package-1', carrier: 'dpd' }, result);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      package_id: 'package-1',
      stage: 'in_transit',
      location: 'Härkingen',
      occurred_at: '2026-07-15T08:00:00Z',
    });
    expect(rows[0]?.provider_event_id).toBe(
      providerEventId('dpd', '2026-07-15T08:00:00Z', 'Härkingen', 'Sorted'),
    );
  });

  it('records an observed event when a timestamp-less current state changes', () => {
    const observedAt = new Date('2026-08-30T13:00:00Z');
    const result: CarrierResult = {
      status: 'out_for_delivery',
      last_status_text: 'En cours de livraison',
      events: [{
        description: 'En cours de livraison',
        stage: 'out_for_delivery',
      }],
    };
    const changed = buildEvents({
      id: 'package-current',
      carrier: 'c-chez-vous',
      current_stage: 'in_transit',
    }, result, undefined, observedAt);
    expect(changed).toEqual([
      expect.objectContaining({
        stage: 'out_for_delivery',
        description: 'En cours de livraison',
        occurred_at: '2026-08-30T13:00:00.000Z',
        raw_data: { observed_without_provider_timestamp: true },
      }),
    ]);

    expect(buildEvents({
      id: 'package-current',
      carrier: 'c-chez-vous',
      current_stage: 'out_for_delivery',
    }, result, undefined, observedAt)).toEqual([]);

    expect(buildEvents({
      id: 'package-registered',
      carrier: 'c-chez-vous',
      current_stage: 'pending',
    }, {
      status: 'pending',
      last_status_text: 'Commande enregistrée',
      events: [{ description: 'Commande enregistrée', stage: 'registered' }],
    }, undefined, observedAt)).toEqual([
      expect.objectContaining({ stage: 'registered', occurred_at: observedAt.toISOString() }),
    ]);
  });

  it('recognizes usable event progress even when a carrier summary is pending', () => {
    expect(resultHasUpdate({
      status: 'pending',
      events: [{ description: 'Accepted at depot' }],
    })).toBe(true);
    expect(resultHasUpdate({ status: 'pending', events: [] })).toBe(false);
  });

  it('uses a validated adapter stage instead of reverse-translating display text', () => {
    expect(resultStage({
      status: 'exception',
      current_stage: 'returned',
      last_status_text: 'Livraison annulée',
    })).toBe('returned');
    expect(resultStage({
      status: 'in_transit',
      current_stage: 'accepted',
      last_status_text: 'Shipment collected',
    })).toBe('accepted');
    expect(() => normalizeCarrierResult({
      status: 'in_transit',
      current_stage: 'private_internal_state',
    })).toThrow('invalid current stage');
  });

  it('recognizes 404s through an error cause chain', () => {
    const cause = Object.assign(new Error('provider response'), { status: 404 });
    expect(isUnannouncedTrackingError(new Error('lookup failed', { cause }))).toBe(true);
    expect(isUnannouncedTrackingError(new Error('network down'))).toBe(false);
  });
});

describe('fair scheduling', () => {
  it('round-robins owners and caps each account', () => {
    const packages = [
      { id: 'a1', user_id: 'a' },
      { id: 'a2', user_id: 'a' },
      { id: 'a3', user_id: 'a' },
      { id: 'b1', user_id: 'b' },
      { id: 'b2', user_id: 'b' },
    ];
    expect(fairSyncPackages(packages, 2).map((parcel) => parcel.id))
      .toEqual(['a1', 'b1', 'a2', 'b2']);
    expect(() => fairSyncPackages(packages, 0)).toThrow('positive');
  });

  it('aligns daytime checks to ten minutes and overnight checks to the hour', () => {
    expect(secondsUntilNextSync(new Date('2026-07-15T07:03:30Z'))).toBe(390);
    expect(secondsUntilNextSync(new Date('2026-07-15T20:15:00Z'))).toBe(2_700);
    expect(() => secondsUntilNextSync(new Date('invalid'))).toThrow('valid');
  });

  it('backs off boundedly when the job store is unavailable', () => {
    expect(workerPollDelay(1_000, 0)).toBe(1_000);
    expect(workerPollDelay(1_000, 1)).toBe(1_000);
    expect(workerPollDelay(1_000, 4)).toBe(8_000);
    expect(workerPollDelay(1_000, 20)).toBe(60_000);
    expect(() => workerPollDelay(0, 1)).toThrow('positive');
    expect(() => workerPollDelay(1_000, -1)).toThrow('non-negative');
  });
});

function fakeClient(packages: JsonObject[] = []) {
  const client = {
    listActivePackages: vi.fn().mockResolvedValue(packages),
    updatePackage: vi.fn().mockResolvedValue(undefined),
    insertEvents: vi.fn().mockResolvedValue(undefined),
    deleteEventsByDescriptions: vi.fn().mockResolvedValue(undefined),
    startSyncAttempt: vi.fn().mockResolvedValue(undefined),
    completeSyncAttempt: vi.fn().mockResolvedValue(true),
  };
  return {
    ...client,
    applyTrackingSync: vi.fn(async (
      parcel: JsonObject, values: JsonObject, events: JsonObject[] = [], descriptions: string[] = [],
    ) => {
      if (events.length) await client.insertEvents(events);
      if (descriptions.length) await client.deleteEventsByDescriptions(parcel.id, new Set(descriptions));
      await client.updatePackage(parcel.id, values);
      return true;
    }),
  };
}

describe('TrackingSyncService', () => {
  it.each([
    { responseSender: undefined, expected: 'Example sender' },
    { responseSender: 'Updated sender', expected: 'Updated sender' },
    { responseSender: null, expected: undefined },
  ])('retains omitted sender information and accepts explicit changes: $responseSender', async ({ responseSender, expected }) => {
    const parcel: JsonObject = {
      id: 'sender-parcel', carrier: 'swiss-post', tracking_number: 'TEST1234',
      carrier_data: { sender_name: 'Example sender', obsolete: 'old response data' },
    };
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit', sender_name: responseSender }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ checked: 1, updated: 1 });
    const values = client.updatePackage.mock.calls.at(-1)?.[1];
    expect(values.carrier_data.sender_name).toBe(expected);
    expect(values.carrier_data.obsolete).toBeUndefined();
  });

  it('refreshes the delivery carrier and retains linked original tracking', async () => {
    const identity = {
      original_carrier: 'gls-de', original_tracking_number: '12345678901',
      original_tracking_url: 'https://www.gls-pakete.de/reach-sendungsverfolgung?match=12345678901',
      original_package_id: 'original-id',
    };
    const parcel: JsonObject = {
      id: 'delivery-parcel', carrier: 'swiss-post', tracking_number: '993412345612345678',
      carrier_data: identity,
    };
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'out_for_delivery', expected_delivery: '2026-09-10' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await service.syncPackage(parcel);
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('swiss-post', parcel.tracking_number, null, null);
    expect(client.updatePackage.mock.calls.at(-1)?.[1]).toMatchObject({
      carrier_data: identity, current_stage: 'out_for_delivery', expected_delivery: '2026-09-10',
    });
  });

  it.each(['gls-de', 'gls-ch', 'gls-fr'])(
    'checks %s hourly and waits four hours after failures', (carrier) => {
      const parcel = { carrier, last_synced_at: '2026-09-09T10:00:00Z', sync_status: 'ok' };
      expect(isTrackingSyncDue({ carrier }, new Date('2026-09-09T10:00:00Z'))).toBe(true);
      expect(isTrackingSyncDue(parcel, new Date('2026-09-09T10:59:59.999Z'))).toBe(false);
      expect(isTrackingSyncDue(parcel, new Date('2026-09-09T11:00:00Z'))).toBe(true);
      expect(isTrackingSyncDue({ ...parcel, sync_status: 'error' }, new Date('2026-09-09T13:59:59Z'))).toBe(false);
      expect(isTrackingSyncDue({ ...parcel, sync_status: 'error' }, new Date('2026-09-09T14:00:00Z'))).toBe(true);
      expect(isTrackingSyncDue({ ...parcel, last_synced_at: 'invalid' }, new Date())).toBe(true);
    },
  );

  it.each(['ok', 'error'])('keeps PostNL on the regular schedule after %s checks', async (syncStatus) => {
    const parcel = {
      id: 'postnl', carrier: 'spring-gds', tracking_number: 'LX123456785NL',
      last_synced_at: '2026-09-09T10:00:00Z', sync_status: syncStatus,
    };
    const client = fakeClient([parcel]);
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      adapter, null, () => new Date('2026-09-09T10:10:00Z'));
    await expect(service.sync()).resolves.toMatchObject({ checked: 1, updated: 1 });
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ checked: 1, updated: 1 });
    expect(adapter.fetch).toHaveBeenCalledTimes(2);
  });

  it('filters cooldowns before the per-owner quota without delaying other carriers', async () => {
    const parcels = Array.from({ length: 5 }, (_, index) => ({
      id: `cooling-${index}`, user_id: 'owner', carrier: 'gls-de',
      last_synced_at: '2026-09-09T10:00:00Z', sync_status: 'error',
    }));
    const client = fakeClient([...parcels, {
      id: 'due', user_id: 'owner', carrier: 'dpd', tracking_number: 'TEST1234',
      last_synced_at: '2026-09-09T10:00:00Z',
    }]);
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      adapter, null, () => new Date('2026-09-09T10:10:00Z'));
    await expect(service.sync()).resolves.toMatchObject({ checked: 1, updated: 1 });
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('dpd', 'TEST1234', null, null);
    expect(client.startSyncAttempt).toHaveBeenCalledOnce();
  });

  it('uses persisted failures across service restarts and manual refreshes', async () => {
    const parcel: JsonObject = {
      id: 'gls-retry', carrier: 'gls-de', tracking_number: 'TEST1234', current_stage: 'in_transit',
    };
    const client = fakeClient();
    client.updatePackage.mockImplementation(async (_id, values) => { Object.assign(parcel, values); });
    const adapter = { fetch: vi.fn().mockRejectedValue(new Error('Provider unavailable')) };
    let now = new Date('2026-09-09T10:00:00Z');
    const service = () => new TrackingSyncService(client as unknown as SupabaseServiceClient,
      adapter, null, () => now);
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ checked: 1, errors: 1 });
    now = new Date('2026-09-09T13:59:59Z');
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ checked: 0, errors: 0 });
    expect(adapter.fetch).toHaveBeenCalledOnce();
    now = new Date('2026-09-09T14:00:00Z');
    adapter.fetch.mockResolvedValue({ status: 'in_transit' });
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ checked: 1, updated: 1 });
    now = new Date('2026-09-09T14:59:59Z');
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ checked: 0 });
    now = new Date('2026-09-09T15:00:00Z');
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ checked: 1, updated: 1 });
    expect(adapter.fetch).toHaveBeenCalledTimes(3);
  });

  it.each(['unknown', 'pending'] as const)(
    'preserves DHL progress and delivery details when the provider returns empty %s data', async (status) => {
      const parcel: JsonObject = {
        id: 'dhl-progress', carrier: 'dhl', tracking_number: 'TEST1234', current_stage: 'customs',
        last_status_text: 'At customs', expected_delivery: '2026-09-10',
        carrier_data: { status: 'in_transit', current_stage: 'customs' },
      };
      const client = fakeClient();
      const adapter = { fetch: vi.fn().mockResolvedValue({
        status, last_status_text: 'No tracking information yet', events: status === 'pending'
          ? [{ stage: 'pending', description: 'Pending', time: '2026-09-09T14:00:00Z' }] : [],
      }) };
      const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter);
      await expect(service.syncPackage(parcel)).resolves.toMatchObject({ errors: 1, waiting: 0 });
      const saved = client.updatePackage.mock.calls.at(-1)![1];
      expect(saved).toEqual({
        last_synced_at: expect.any(String), sync_status: 'error',
        sync_error: 'The carrier temporarily returned no tracking progress. Previous tracking details have been kept.',
      });
      expect(client.insertEvents).not.toHaveBeenCalled();
      expect(client.completeSyncAttempt).toHaveBeenCalledWith(expect.any(String),
        expect.objectContaining({ outcome: 'error', anomaly_codes: ['progress_disappeared'] }), expect.any(Array));
      adapter.fetch.mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit',
        last_status_text: 'Departed customs', events: [] });
      await expect(service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1, errors: 0 });
      expect(client.updatePackage).toHaveBeenLastCalledWith(parcel.id, expect.objectContaining({
        sync_status: 'ok', sync_error: null, current_stage: 'in_transit', last_status_text: 'Departed customs',
      }));
    },
  );

  it.each(['result', 'error', 'unannounced'] as const)(
    'discards a late %s after the tracking configuration changes', async (outcome) => {
      const parcel = {
        id: 'corrected-package', carrier: 'ups', tracking_number: '1Z999AA10123456784',
        current_stage: 'pending', tracking_generation: 'old-generation',
      };
      let generation = parcel.tracking_generation;
      const savedEvents: JsonObject[] = [];
      let state: JsonObject = {};
      const client = fakeClient();
      client.applyTrackingSync.mockImplementation(async (snapshot, values, events = []) => {
        if (snapshot.tracking_generation !== generation) return false;
        state = { ...state, ...values };
        savedEvents.push(...events);
        return true;
      });
      const adapter = { fetch: vi.fn(async (): Promise<CarrierResult> => {
        // Simulate the SQL carrier reset while the old request is in flight.
        generation = 'new-generation';
        state = { current_stage: 'pending', sync_status: 'pending' };
        if (outcome === 'error') throw new Error('Old carrier unavailable');
        if (outcome === 'unannounced') throw Object.assign(new Error('not found'), { status: 404 });
        return {
          status: 'delivered' as const,
          events: [{ time: '2026-09-06T12:00:00Z', description: 'Delivered by old carrier' }],
        };
      }) };
      const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter);

      await expect(service.syncPackage(parcel)).resolves.toMatchObject({ superseded: 1, updated: 0, errors: 0 });
      expect(savedEvents).toEqual([]);
      expect(state).toEqual({ current_stage: 'pending', sync_status: 'pending' });
      expect(client.completeSyncAttempt).toHaveBeenLastCalledWith(
        expect.any(String), expect.objectContaining({ outcome: 'superseded' }), expect.any(Array),
      );

      adapter.fetch.mockResolvedValue({ status: 'in_transit', events: [] });
      await expect(service.syncPackage({ ...parcel, tracking_generation: generation }))
        .resolves.toMatchObject({ updated: 1, superseded: 0 });
      expect(state).toMatchObject({ current_stage: 'in_transit', sync_status: 'ok' });
    },
  );

  it.each(['ups', 'dhl'])('rejects a superseded %s check before fetching or changing status', async (carrier) => {
    const client = fakeClient();
    client.applyTrackingSync.mockResolvedValue(false);
    const adapter = { fetch: vi.fn() };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter);
    await expect(service.syncPackage({ id: 'old-snapshot', carrier }))
      .resolves.toMatchObject({ superseded: 1 });
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(client.updatePackage).not.toHaveBeenCalled();
  });

  it('stores normalized events and advances the package stage', async () => {
    const parcel = {
      id: 'package-1',
      user_id: 'user-1',
      carrier: 'dpd',
      tracking_number: '06086514587082',
      current_stage: 'pending',
    };
    const client = fakeClient([parcel]);
    const adapter: TrackingAdapter = {
      fetch: vi.fn().mockResolvedValue({
        status: 'delivered',
        last_status_text: 'Delivered',
        last_update: '2026-08-04T12:38:28Z',
        events: [{
          time: '2026-08-04T12:38:28Z',
          location: 'Zürich',
          description: 'Delivered',
        }],
      }),
    };
    const service = new TrackingSyncService(
      client as unknown as SupabaseServiceClient,
      adapter,
      null,
      () => new Date('2026-08-04T13:00:00Z'),
    );

    await expect(service.sync()).resolves.toMatchObject({ checked: 1, updated: 1, errors: 0 });
    expect(client.insertEvents).toHaveBeenCalledWith([
      expect.objectContaining({ stage: 'delivered', package_id: 'package-1' }),
    ]);
    expect(client.updatePackage).toHaveBeenLastCalledWith('package-1', expect.objectContaining({
      current_stage: 'delivered',
      sync_status: 'ok',
      sync_error: null,
    }));
    expect(client.startSyncAttempt).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      package_id: 'package-1',
      trigger: 'scheduled',
      configured_carrier: 'dpd',
    }));
    expect(client.completeSyncAttempt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        outcome: 'updated',
        provider_status: 'delivered',
        selected_stage: 'delivered',
        events_received: 1,
        events_normalized: 1,
      }),
      expect.arrayContaining([
        expect.objectContaining({ step: 'fetch', status: 'succeeded' }),
        expect.objectContaining({ step: 'normalize', status: 'succeeded' }),
        expect.objectContaining({ step: 'persist_events', status: 'succeeded' }),
        expect.objectContaining({ step: 'persist_package', status: 'succeeded' }),
        expect.objectContaining({ step: 'complete', status: 'succeeded' }),
      ]),
    );
  });

  it('prefers an explicit current failure over an older timestamped milestone', async () => {
    const parcel = {
      id: 'package-current-failure',
      carrier: 'colisweb',
      tracking_number: '10000000',
      current_stage: 'in_transit',
    };
    const client = fakeClient();
    const adapter: TrackingAdapter = {
      fetch: vi.fn().mockResolvedValue({
        status: 'exception',
        last_status_text: 'Incident de livraison',
        last_update: '2026-08-28T11:30:00+02:00',
        events: [{
          description: 'Incident de livraison',
          stage: 'failed_attempt',
        }, {
          time: '2026-08-28T11:30:00+02:00',
          description: 'Colis pris en charge',
          stage: 'in_transit',
        }],
      }),
    };
    const service = new TrackingSyncService(
      client as unknown as SupabaseServiceClient,
      adapter,
      null,
      () => new Date('2026-08-30T13:00:00Z'),
    );

    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1, errors: 0 });
    expect(client.insertEvents).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ stage: 'in_transit' }),
      expect.objectContaining({
        stage: 'failed_attempt',
        occurred_at: '2026-08-30T13:00:00.000Z',
      }),
    ]));
    expect(client.updatePackage).toHaveBeenLastCalledWith(
      'package-current-failure',
      expect.objectContaining({
        current_stage: 'failed_attempt',
        last_status_text: 'Incident de livraison',
        sync_status: 'ok',
      }),
    );
  });

  it('keeps timed progress ahead of a pending provider summary', async () => {
    const parcel = {
      id: 'package-pending-summary',
      carrier: 'paack',
      tracking_number: 'PAACK12345',
      current_stage: 'pending',
    };
    const client = fakeClient();
    const adapter: TrackingAdapter = {
      fetch: vi.fn().mockResolvedValue({
        status: 'pending',
        last_status_text: 'Shipment registered',
        events: [{
          time: '2026-08-28T11:30:00+02:00',
          description: 'Received at hub',
          stage: 'in_transit',
        }],
      }),
    };
    const service = new TrackingSyncService(
      client as unknown as SupabaseServiceClient,
      adapter,
    );

    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1, errors: 0 });
    expect(client.updatePackage).toHaveBeenLastCalledWith(
      'package-pending-summary',
      expect.objectContaining({
        current_stage: 'in_transit',
        sync_status: 'ok',
      }),
    );
  });

  it('keeps a newly unannounced shipment waiting without showing an error', async () => {
    const parcel = {
      id: 'package-2',
      carrier: 'dpd',
      tracking_number: '06086514587082',
      current_stage: 'pending',
    };
    const client = fakeClient();
    const adapter: TrackingAdapter = {
      fetch: vi.fn().mockRejectedValue(Object.assign(new Error('not live'), { status: 404 })),
    };
    const service = new TrackingSyncService(
      client as unknown as SupabaseServiceClient,
      adapter,
      null,
      () => new Date('2026-08-04T13:00:00Z'),
    );

    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ waiting: 1, errors: 0 });
    expect(client.updatePackage).toHaveBeenLastCalledWith('package-2', {
      last_synced_at: '2026-08-04T13:00:00.000Z',
      sync_status: 'waiting',
      sync_error: null,
    });
    expect(client.completeSyncAttempt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outcome: 'waiting', error_type: null }),
      expect.arrayContaining([
        expect.objectContaining({
          step: 'fetch',
          status: 'succeeded',
          details: { disposition: 'unannounced' },
        }),
        expect.objectContaining({ step: 'normalize', status: 'skipped' }),
      ]),
    );
  });

  it('preserves progressed shipment data when a carrier later reports not found', async () => {
    const parcel = {
      id: 'package-progressed',
      carrier: 'colis-prive',
      tracking_number: '99112233445575012',
      current_stage: 'in_transit',
      last_status_text: 'En cours d’acheminement',
    };
    const client = fakeClient();
    const adapter: TrackingAdapter = {
      fetch: vi.fn().mockRejectedValue(new ColisPriveTrackingError()),
    };
    const service = new TrackingSyncService(
      client as unknown as SupabaseServiceClient,
      adapter,
      null,
      () => new Date('2026-08-04T13:00:00Z'),
    );

    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ errors: 1, waiting: 0 });
    expect(client.updatePackage).toHaveBeenLastCalledWith('package-progressed', {
      last_synced_at: '2026-08-04T13:00:00.000Z',
      sync_status: 'error',
      sync_error: 'Colis Privé could not locate the shipment',
    });
    expect(client.completeSyncAttempt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outcome: 'error', error_type: 'ColisPriveTrackingError' }),
      expect.arrayContaining([
        expect.objectContaining({
          step: 'fetch',
          status: 'failed',
          error_type: 'ColisPriveTrackingError',
        }),
      ]),
    );
  });

  it('marks link-only carriers unsupported without pretending they were checked', async () => {
    const client = fakeClient();
    const adapter: TrackingAdapter = { fetch: vi.fn() };
    const service = new TrackingSyncService(
      client as unknown as SupabaseServiceClient,
      adapter,
    );

    await expect(service.syncPackage({ id: 'package-3', carrier: 'fedex' }))
      .resolves.toMatchObject({ unsupported: 1, checked: 1 });
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(client.updatePackage).toHaveBeenCalledWith('package-3', expect.objectContaining({
      sync_status: 'unsupported',
      last_synced_at: null,
    }));
  });

  it('keeps tracking operational when the private audit store is unavailable', async () => {
    const parcel = {
      id: 'package-audit-outage',
      carrier: 'dpd',
      tracking_number: '06086514587082',
      current_stage: 'pending',
    };
    const client = fakeClient();
    client.startSyncAttempt.mockRejectedValue(new Error('audit table unavailable'));
    client.completeSyncAttempt.mockRejectedValue(new Error('audit table unavailable'));
    const adapter: TrackingAdapter = {
      fetch: vi.fn().mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit' }),
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const service = new TrackingSyncService(
      client as unknown as SupabaseServiceClient,
      adapter,
    );

    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1, errors: 0 });
    expect(client.updatePackage).toHaveBeenLastCalledWith(
      'package-audit-outage',
      expect.objectContaining({ sync_status: 'ok', current_stage: 'in_transit' }),
    );
  });
});

describe('tracking anomaly detection', () => {
  it('records malformed, future, synthetic, and contradictory carrier evidence', () => {
    const now = new Date('2026-08-31T12:00:00Z');
    expect(detectSyncAnomalies(
      { current_stage: 'delivered' },
      {
        status: 'delivered',
        events: [{ time: 'not-a-time', description: 'Delivered' }],
      },
      [{
        occurred_at: '2026-09-03T12:00:00Z',
        raw_data: { observed_without_provider_timestamp: true },
      }],
      'dpd',
      'in_transit',
      now,
    )).toEqual(expect.arrayContaining([
      'invalid_event_timestamp',
      'future_event_timestamp',
      'observed_without_timestamp',
      'terminal_stage_regression',
      'delivered_status_conflict',
    ]));
  });

  it('flags a progressed parcel when a provider suddenly returns no evidence', () => {
    expect(detectSyncAnomalies(
      { current_stage: 'in_transit' },
      { status: 'unknown', events: [] },
      [],
      'colis-prive',
      null,
      new Date('2026-08-31T12:00:00Z'),
    )).toContain('progress_disappeared');
  });
});
