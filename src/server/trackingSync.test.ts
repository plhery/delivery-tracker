import { AmazonShippingHistoryExpiredError, AmazonShippingTracker } from '@carriers/carriers/amazon-shipping/adapter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { secondsUntilNextSync, workerPollDelay } from './background';
import { normalizeCarrierResult, type CarrierResult } from '@carriers/core/result';
import { ColisPriveTracker, ColisPriveTrackingError } from '@carriers/carriers/colis-prive/adapter';
import { ColiswebTracker } from '@carriers/carriers/colisweb/adapter';
import { CChezVousTracker } from '@carriers/carriers/c-chez-vous/adapter';
import { CiblexTracker } from '@carriers/carriers/ciblex/adapter';
import { DPDFranceTracker } from '@carriers/carriers/dpd-fr/adapter';
import { GeodisTracker } from '@carriers/carriers/geodis/adapter';
import { GLSFranceTracker } from '@carriers/carriers/gls-fr/adapter';
import { GLSSwitzerlandTracker } from '@carriers/carriers/gls-ch/adapter';
import { HeppnerTracker } from '@carriers/carriers/heppner/adapter';
import { IndiaPostTracker } from '@carriers/carriers/india-post/adapter';
import { LaPosteTracker } from '@carriers/carriers/la-poste/adapter';
import { MondialRelayTracker } from '@carriers/carriers/mondial-relay/adapter';
import { PaackTracker } from '@carriers/carriers/paack/adapter';
import { RelaisColisTracker } from '@carriers/carriers/relais-colis/adapter';
import { SwissPostCargoTracker } from '@carriers/carriers/swiss-post-cargo/adapter';
import type { SupabaseServiceClient } from './supabase';
import { AdapterRegistry, type AdapterEnvironment } from '@carriers/core/adapter';
import type { StepRecorder } from '@carriers/core/telemetry';
import type { UniversalTracker } from '@carriers/providers/universal';
import { eventTimestamp } from './eventTime';
import {
  CarrierTrackingAdapter,
  buildEvents,
  classifyStage,
  collectStatusObservations,
  detectSyncAnomalies,
  fairSyncPackages,
  inferStage,
  MAX_STATUS_OBSERVATIONS_PER_SYNC,
  isTrackingSyncDue,
  isUnannouncedTrackingError,
  providerEventId,
  resultHasUpdate,
  resultStage,
  TrackingSyncService,
  type TrackingAdapter,
} from './trackingSync';
import type { JsonObject } from './types';
import * as observability from './observability';
import { UniversalTrackingError } from '@carriers/providers/universal';
import { UpstreamHttpError } from '@carriers/core/transport';
import cainiaoDeliveredFixture from '../../packages/carriers/carriers/aliexpress/fixtures/delivered.json';
import dpdDeliveredFixture from '../../packages/carriers/carriers/dpd/fixtures/delivered-verified.json';
import { parseDPDTrackingApi } from '@carriers/carriers/dpd/adapter';
import { adapter as cainiaoAdapter, parseCainiaoTrackingResponse } from '@carriers/carriers/aliexpress/adapter';
import { adapter as postNLAdapter, parsePostNLTrackingResponse } from '@carriers/carriers/spring-gds/adapter';
import { NOOP_RECORDER } from '@carriers/core/telemetry';
import { IndeterminateError, NotFoundError, SchemaError } from '@carriers/core/errors';

afterEach(() => vi.restoreAllMocks());

describe('dedicated carrier dispatch', () => {
  it('dispatches Royal Mail through universal providers despite retaining its experimental adapter file', async () => {
    const universal = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    const adapter = new CarrierTrackingAdapter(universal as unknown as UniversalTracker);

    await expect(adapter.fetch('royal-mail', 'SG999999999GB', null)).resolves.toMatchObject({ status: 'in_transit' });
    expect(universal.fetch).toHaveBeenCalledExactlyOnceWith('SG999999999GB', null);
    expect(adapter.registry.has('royal-mail')).toBe(false);
  });

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
    expect(indiaPost).toHaveBeenCalledWith('JN067614884IN');
  });
});

describe('tracking event normalization', () => {
  it.each(['2026-09-07', '2026-09-07T12:32:00Z'])('preserves the precision of a status-only timestamp: %s', (time) => {
    const events = buildEvents({ id: 'package-1', carrier: 'dpd' }, {
      status: 'delivered', last_status_text: 'Delivered', last_update: time,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.raw_data).toEqual({ time, stage_source: 'wording:language' });
  });

  it('prioritizes exception and final-stage phrases before broad delivery words', () => {
    expect(inferStage('Delivery attempt failed')).toBe('failed_attempt');
    expect(inferStage('Return to sender')).toBe('returned');
    expect(inferStage('Parcel handed to DPD')).toBe('accepted');
    expect(inferStage('To be delivered')).toBe('in_transit');
  });

  it('records where every event stage came from', () => {
    const rows = buildEvents({ id: 'package-1', carrier: 'ctt' }, {
      status: 'unknown',
      events: [
        { time: '2026-09-10T09:00:00Z', description: 'Objeto entregue', stage: 'delivered' },
        { time: '2026-09-10T08:00:00Z', description: 'Return to sender' },
        { time: '2026-09-10T07:00:00Z', description: 'Confirmation of receipt' },
        { time: '2026-09-10T06:00:00Z', description: 'Estado interno 99' },
      ],
    });
    expect(rows.map((row) => [row.stage, (row.raw_data as JsonObject).stage_source])).toEqual([
      ['delivered', 'carrier_map'],
      ['returned', 'wording:language'],
      ['delivered', 'wording:delivered'],
      ['in_transit', 'none'],
    ]);
    // The raw provider event is still stored next to the recorded source.
    expect(rows[3]?.raw_data).toEqual({
      time: '2026-09-10T06:00:00Z', description: 'Estado interno 99', stage_source: 'none',
    });
  });

  it('keeps the classifier stage and its rule id in step', () => {
    expect(classifyStage('Delivery attempt failed'))
      .toEqual({ stage: 'failed_attempt', source: 'wording:language' });
    expect(classifyStage('Confirmation of receipt'))
      .toEqual({ stage: 'delivered', source: 'wording:delivered' });
    expect(classifyStage('Estado interno 99', 'pending'))
      .toEqual({ stage: 'pending', source: 'none' });
    expect(inferStage('Estado interno 99', 'pending')).toBe('pending');
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

  it('keeps a verified DPD delivery delivered: the proof-of-delivery scan is not the newest row', () => {
    const result = normalizeCarrierResult(parseDPDTrackingApi(dpdDeliveredFixture, '06080000000001', true));
    const rows = buildEvents(
      { id: 'package-1', carrier: 'dpd', current_stage: 'out_for_delivery' },
      result,
      'dpd',
      new Date('2026-07-16T12:00:00Z'),
    );

    expect(resultStage(result)).toBe('delivered');
    expect(rows.map((row) => [
      row.occurred_at, row.stage, row.location, (row.raw_data as JsonObject).stage_source,
    ])).toEqual([
      ['2026-07-16T08:12:00Z', 'delivered', 'Urdorf, CH', 'carrier_map'],
      ['2026-07-16T04:10:45Z', 'out_for_delivery', 'Urdorf, CH', 'carrier_map'],
      ['2026-07-16T01:48:00Z', 'in_transit', 'Urdorf, CH', 'carrier_map'],
      ['2026-07-15T16:05:12Z', 'in_transit', 'Urdorf, CH', 'wording:language'],
      ['2026-07-15T14:30:00Z', 'in_transit', null, 'carrier_map'],
    ]);
    expect(rows[0]?.provider_event_id).toBe(providerEventId(
      'dpd', '2026-07-16T10:12:00+02:00', 'Urdorf, CH', 'Your parcel has been delivered successfully',
    ));
    // Only the unmapped depot-arrival scan is recorded for review.
    expect(collectStatusObservations(rows, 'dpd').map((observation) => [
      observation.provider_code, observation.chosen_stage,
    ])).toEqual([['ORI', 'in_transit']]);
  });

  it('adds no observed DPD row when the newest verified scan is the depot arrival', () => {
    // The enumeration beside ORI (PARCEL_HANDED) has no stage, so the result
    // stage comes from the scan's wording; the scan must agree with it.
    const scans = (dpdDeliveredFixture.parcelEvents as JsonObject[]);
    const history = (dpdDeliveredFixture.parcelHistory as JsonObject[]);
    for (const eventTypes of [['ORI'], ['ORI', 'CCO']]) {
      const result = normalizeCarrierResult(parseDPDTrackingApi({
        ...dpdDeliveredFixture,
        status: { ...history[0], description: 'PARCEL_HANDED' },
        parcelHistory: history.filter((entry) => entry.description === 'PARCEL_HANDED'),
        parcelEvents: scans.filter((scan) => eventTypes.includes(String(scan.eventType))),
      }, '06080000000001', true));
      for (const previousStage of ['pending', 'registered', 'accepted']) {
        const rows = buildEvents(
          { id: 'package-1', carrier: 'dpd', current_stage: previousStage },
          result,
          'dpd',
          new Date('2026-07-15T20:00:00Z'),
        );

        expect(resultStage(result)).toBe('in_transit');
        expect(rows.map((row) => [row.stage, (row.raw_data as JsonObject).observed_without_provider_timestamp ?? false]))
          .toEqual(eventTypes.map(() => ['in_transit', false]));
      }
    }
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
        raw_data: { observed_without_provider_timestamp: true, stage_source: 'carrier_map' },
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
    // A carrier problem that is neither a missed attempt nor a return keeps
    // its own stage instead of promising a delivery round.
    expect(resultStage({
      status: 'exception',
      current_stage: 'exception',
      last_status_text: 'Parcel damaged in transit',
    })).toBe('exception');
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

  it('aligns daytime checks to two minutes and overnight checks to the hour', () => {
    expect(secondsUntilNextSync(new Date('2026-07-15T07:03:30Z'))).toBe(30);
    expect(secondsUntilNextSync(new Date('2026-07-15T07:04:00Z'))).toBe(120);
    expect(secondsUntilNextSync(new Date('2026-07-15T19:59:30Z'))).toBe(30);
    expect(secondsUntilNextSync(new Date('2026-07-15T20:00:00Z'))).toBe(3_600);
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

describe('status observation collection', () => {
  it('keeps wording no carrier map resolved, deduplicated per carrier and code', () => {
    const rows = buildEvents({ id: 'package-1', carrier: 'ctt' }, {
      status: 'unknown',
      events: [
        { time: '2026-09-10T09:00:00Z', description: 'Objeto entregue', stage: 'delivered', provider_code: '5' },
        { time: '2026-09-10T08:00:00Z', description: '  Estado   INTERNO 99 ', provider_code: '99' },
        { time: '2026-09-10T07:00:00Z', description: 'Estado interno 99', provider_code: '99' },
      ],
    });
    const observations = collectStatusObservations(rows, 'ctt');
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      carrier: 'ctt',
      provider_code: '99',
      description_normalized: 'estado interno 99',
      language_guess: null,
      stage_source: 'none',
      chosen_stage: 'in_transit',
      package_id: 'package-1',
    });
    expect(observations[0]?.observation_key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('attributes each wording to the carrier that served it and bounds one sync', () => {
    const merged = collectStatusObservations([
      {
        package_id: 'package-1', stage: 'in_transit', description: 'Unknown German wording',
        provider_event_id: 'gls-de:abc', raw_data: { stage_source: 'none' },
      },
      {
        package_id: 'package-1', stage: 'in_transit', description: 'Unknown Swiss wording',
        provider_event_id: '', raw_data: { stage_source: 'wording:in_transit' },
      },
    ], 'swiss-post');
    expect(merged.map((observation) => observation.carrier)).toEqual(['gls-de', 'swiss-post']);

    const many = Array.from({ length: MAX_STATUS_OBSERVATIONS_PER_SYNC + 8 }, (_, index) => ({
      package_id: 'package-1', stage: 'in_transit', description: `Unknown wording ${index}`,
      provider_event_id: `ctt:${index}`, raw_data: { stage_source: 'none' },
    }));
    expect(collectStatusObservations(many, 'ctt')).toHaveLength(MAX_STATUS_OBSERVATIONS_PER_SYNC);
  });

  it('skips events whose stage came from the carrier map', () => {
    expect(collectStatusObservations([{
      package_id: 'package-1', stage: 'delivered', description: 'Objeto entregue',
      provider_event_id: 'ctt:abc', raw_data: { stage_source: 'carrier_map' },
    }], 'ctt')).toEqual([]);
  });

  it('records unresolved wording after the events are persisted', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({
      status: 'in_transit',
      last_status_text: 'Estado interno 99',
      last_update: '2026-09-10T11:00:00Z',
      events: [{ time: '2026-09-10T11:00:00Z', description: 'Estado interno 99', provider_code: '99' }],
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await expect(service.syncPackage({ id: 'observed', carrier: 'ctt', tracking_number: 'TEST1234' }))
      .resolves.toMatchObject({ updated: 1 });
    expect(client.recordTrackingStatusObservations).toHaveBeenCalledOnce();
    expect(client.recordTrackingStatusObservations.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        carrier: 'ctt', provider_code: '99', description_normalized: 'estado interno 99',
        stage_source: 'none', chosen_stage: 'in_transit',
      }),
    ]);
    expect(client.recordTrackingStatusObservations.mock.invocationCallOrder[0])
      .toBeGreaterThan(client.insertEvents.mock.invocationCallOrder[0]);
  });

  it('swallows an observation write failure and reports it once', async () => {
    const captured = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const logged = vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => undefined);
    const client = {
      ...fakeClient(),
      recordTrackingStatusObservations: vi.fn().mockRejectedValue(new Error('observations unavailable')),
    };
    const adapter = { fetch: vi.fn().mockResolvedValue({
      status: 'in_transit',
      last_status_text: 'Estado interno 99',
      last_update: '2026-09-10T11:00:00Z',
      events: [{ time: '2026-09-10T11:00:00Z', description: 'Estado interno 99' }],
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    const parcel = { id: 'observed', carrier: 'ctt', tracking_number: 'TEST1234' };
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1, errors: 0 });
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1, errors: 0 });
    expect(client.recordTrackingStatusObservations).toHaveBeenCalledTimes(2);
    expect(logged.mock.calls.filter(([event]) => event === 'tracking_status_observation_write_failed'))
      .toHaveLength(2);
    expect(captured).toHaveBeenCalledOnce();
  });
});

function fakeClient(packages: JsonObject[] = []) {
  const client = {
    listActivePackages: vi.fn().mockResolvedValue(packages),
    autoLinkPackages: vi.fn().mockResolvedValue(0),
    updatePackage: vi.fn().mockResolvedValue(undefined),
    insertEvents: vi.fn().mockResolvedValue(undefined),
    deleteEventsByDescriptions: vi.fn().mockResolvedValue(undefined),
    startSyncAttempt: vi.fn().mockResolvedValue(undefined),
    completeSyncAttempt: vi.fn().mockResolvedValue(true),
    recordTrackingHealth: vi.fn().mockResolvedValue([]),
    ackTrackingHealth: vi.fn().mockResolvedValue(undefined),
    recordTrackingStatusObservations: vi.fn().mockResolvedValue(undefined),
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
  it('clears the displayed universal provider after successful direct recovery', async () => {
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const progress = { status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-10T11:00:00Z' };
    const adapter = { fetch: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(progress),
      fetchUniversal: vi.fn().mockResolvedValue(progress) };
    const parcel = { id: 'link-recovery', carrier: 'dhl', tracking_number: 'TEST1234', current_stage: 'pending' };
    let now = new Date('2026-09-10T12:00:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    await service.syncPackage(parcel);
    const saved = client.updatePackage.mock.calls.at(-1)![1];
    expect(saved.carrier_data.tracking_provider).toBe('Ship24');
    now = new Date('2026-09-10T13:00:00Z');
    await service.syncPackage({ ...parcel, ...saved });
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.tracking_provider).toBeUndefined();
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.active_tracking_carrier).toBe('dhl');
  });

  it('atomically persists a verified correction and retains its timestamp on later syncs', async () => {
    const report = vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockRejectedValueOnce(new Error('wrong carrier')).mockResolvedValue({
      status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-10T11:00:00Z',
      events: [{ time: '2026-09-10T11:00:00Z', description: 'Confirmed UPS history', stage: 'in_transit' }],
    }), fetchUniversal: vi.fn() };
    const parcel = { id: 'correction', carrier: 'dhl', tracking_number: '1Z999AA10123456784', current_stage: 'pending' };
    let now = new Date('2026-09-10T12:00:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1 });
    const saved = client.updatePackage.mock.calls.at(-1)![1];
    expect(saved).toMatchObject({ carrier: 'ups', tracking_url: null, dpd_postcode: null, carrier_data: {
      auto_changed_from: 'dhl', auto_changed_to: 'ups', auto_changed_at: now.toISOString(),
    } });
    expect(client.applyTrackingSync.mock.calls.at(-1)?.[2]).toHaveLength(1);
    expect(report).toHaveBeenCalledWith('carrier_auto_swapped', expect.objectContaining({ carrier: 'dhl', provider: 'ups' }));
    now = new Date('2026-09-10T13:00:00Z');
    await service.syncPackage({ ...parcel, ...saved });
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.auto_changed_at).toBe('2026-09-10T12:00:00.000Z');
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier).toBeUndefined();
    expect(adapter.fetchUniversal).not.toHaveBeenCalled();
  });

  it('persists routing for a universal-only carrier and respects it on the next manual check', async () => {
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = { fetch: vi.fn(), fetchUniversal: vi.fn().mockResolvedValue({ status: 'in_transit',
      current_stage: 'in_transit', last_update: '2026-09-10T11:00:00Z', events: [] }) };
    const parcel = { id: 'routed', carrier: 'fedex', tracking_number: 'TEST1234', current_stage: 'pending' };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1 });
    const saved = client.updatePackage.mock.calls.at(-1)![1];
    expect(saved.carrier_data.routing).toMatchObject({ preferred_provider: 'Ship24', last_success_at: '2026-09-10T12:00:00.000Z' });
    await expect(service.syncPackage({ ...parcel, ...saved })).resolves.toMatchObject({ checked: 0 });
    expect(adapter.fetchUniversal).toHaveBeenCalledOnce();
  });

  it('keeps last-good progress and persisted success time when a recent direct fetch is rate limited', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockRejectedValue(new UpstreamHttpError('UPS', 429)), fetchUniversal: vi.fn() };
    const parcel = { id: 'rate-limited', carrier: 'ups', tracking_number: 'TEST1234', current_stage: 'in_transit',
      sync_status: 'ok', last_synced_at: '2026-09-10T11:30:00Z', carrier_data: { last_status_text: 'On the way' } };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ waiting: 1, errors: 0 });
    const values = client.updatePackage.mock.calls.at(-1)![1];
    expect(values).toMatchObject({ sync_status: 'ok', carrier_data: { last_status_text: 'On the way', routing: {
      last_success_at: '2026-09-10T11:30:00Z', next_check_at: '2026-09-10T12:15:00.000Z',
    } } });
    expect(values.current_stage).toBeUndefined();
    expect(adapter.fetchUniversal).not.toHaveBeenCalled();
  });

  it('does not regress a newer saved summary when a fallback returns older history', async () => {
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = { fetch: vi.fn(), fetchUniversal: vi.fn().mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-09T10:00:00Z' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await service.syncPackage({ id: 'older', carrier: 'unknown', tracking_number: 'TEST1234', current_stage: 'out_for_delivery',
      carrier_data: { routing: { version: 1, configured_carrier: 'unknown', last_event_at: '2026-09-10T11:00:00Z' } } });
    const values = client.updatePackage.mock.calls.at(-1)![1];
    expect(values.current_stage).toBeUndefined();
    expect(values.carrier_data.routing.last_event_at).toBe('2026-09-10T11:00:00Z');
  });
  it('reads a naive local snapshot in its carrier\'s zone before comparing it with the watermark', async () => {
    // India Post reports Kolkata wall time without an offset; routing writes the watermark from that reading.
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-07-01T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const snapshot = (local: string, stage: string, text: string) => ({ status: 'in_transit', current_stage: stage,
      last_status_text: text, last_update: local, events: [{ time: local, description: text, stage }] });
    const adapter = { fetch: vi.fn()
      .mockResolvedValueOnce(snapshot('2026-07-01T10:00:00.000', 'out_for_delivery', 'Out for delivery'))
      .mockResolvedValueOnce(snapshot('2026-07-01T09:00:00.000', 'in_transit', 'In transit')), fetchUniversal: vi.fn() };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-07-01T12:00:00Z'));
    const parcel = { id: 'naive', carrier: 'india-post', tracking_number: 'TEST1234', current_stage: 'pending' };
    await service.syncPackage(parcel);
    const fresh = client.updatePackage.mock.calls.at(-1)![1];
    expect(fresh).toMatchObject({ current_stage: 'out_for_delivery', carrier_data: { routing: { last_event_at: '2026-07-01T04:30:00.000Z' } } });
    // An older snapshot from the same carrier must not regress the summary.
    await service.syncPackage({ ...parcel, ...fresh, last_synced_at: '2026-07-01T11:00:00Z' });
    const stale = client.updatePackage.mock.calls.at(-1)![1];
    expect(stale.current_stage).toBeUndefined();
    expect(stale.carrier_data).toMatchObject({ last_status_text: 'Out for delivery', routing: { last_event_at: '2026-07-01T04:30:00.000Z' } });
  });
  it('reconciles both refresh orders only after the scheduled batch has persisted', async () => {
    const packages = [
      { id: 'local', user_id: 'owner', carrier: 'swiss-post', tracking_number: '993412345612345678' },
      { id: 'origin', user_id: 'owner', carrier: 'gls-de', tracking_number: '123456789011' },
    ];
    for (const order of [packages, [...packages].reverse()]) {
      const client = fakeClient(order);
      const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
      const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
      await service.sync();
      expect(client.autoLinkPackages).toHaveBeenCalledOnce();
      expect(client.autoLinkPackages.mock.invocationCallOrder[0]).toBeGreaterThan(client.completeSyncAttempt.mock.invocationCallOrder.at(-1)!);
    }
  });

  it('reconciles a manual refresh within its owner’s account', async () => {
    const client = fakeClient();
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, null);
    await service.syncPackage({ id: 'parcel', user_id: 'owner', carrier: 'swiss-post', tracking_number: 'TEST1234' });
    expect(client.autoLinkPackages).toHaveBeenCalledExactlyOnceWith('owner');
  });

  it.each([
    { carrier: 'swiss-post', stage: 'out_for_delivery', time: '10:02:00', checked: 1 },
    { carrier: 'swiss-post', stage: 'out_for_delivery', time: '10:01:59', checked: 0 },
    { carrier: 'swiss-post', stage: 'in_transit', time: '10:02:00', checked: 0 },
    { carrier: 'swiss-post', stage: 'in_transit', time: '10:10:00', checked: 1 },
    { carrier: 'spring-gds', stage: 'out_for_delivery', time: '10:02:00', checked: 1 },
    { carrier: 'spring-gds', stage: 'in_transit', time: '10:02:00', checked: 0 },
    { carrier: 'spring-gds', stage: 'in_transit', time: '10:10:00', checked: 0 },
    { carrier: 'spring-gds', stage: 'in_transit', time: '10:29:59', checked: 0 },
    { carrier: 'spring-gds', stage: 'in_transit', time: '10:30:00', checked: 1 },
    { carrier: 'spring-gds', stage: 'registered', time: '10:10:00', checked: 0 },
    { carrier: 'spring-gds', stage: 'registered', time: '10:30:00', checked: 1 },
    { carrier: 'swiss-post', stage: 'registered', time: '10:02:00', checked: 0 },
    { carrier: 'swiss-post', stage: 'accepted', time: '10:02:00', checked: 0 },
    { carrier: 'swiss-post', stage: 'customs', time: '10:02:00', checked: 0 },
    { carrier: 'swiss-post', stage: 'registered', time: '10:10:00', checked: 1 },
    { carrier: 'gls-de', stage: 'in_transit', time: '10:02:00', checked: 0 },
  ])('schedules $carrier at $stage at $time: $checked checks', async ({ carrier, stage, time, checked }) => {
    const parcel = {
      id: 'scheduled', carrier, current_stage: stage, tracking_number: 'TEST1234',
      last_synced_at: '2026-09-09T10:00:15Z', sync_status: 'ok',
    };
    const client = fakeClient([parcel]);
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      adapter, null, () => new Date(`2026-09-09T${time}Z`));
    await expect(service.sync()).resolves.toMatchObject({ checked });
    expect(adapter.fetch).toHaveBeenCalledTimes(checked);
  });

  it.each([
    { name: 'idle for three days', created: '2026-08-30T09:00:00Z', lastEvent: '2026-09-06T09:00:00Z', stage: 'in_transit', time: '10:10:00', checked: 0 },
    { name: 'idle for three days', created: '2026-08-30T09:00:00Z', lastEvent: '2026-09-06T09:00:00Z', stage: 'in_transit', time: '11:00:00', checked: 1 },
    { name: 'stuck out for delivery', created: '2026-08-30T09:00:00Z', lastEvent: '2026-09-06T09:00:00Z', stage: 'out_for_delivery', time: '10:02:00', checked: 0 },
    { name: 'never tracked since added', created: '2026-09-07T09:00:00Z', lastEvent: null, stage: 'pending', time: '10:10:00', checked: 0 },
    { name: 'added yesterday with old history', created: '2026-09-08T09:00:00Z', lastEvent: '2026-09-01T09:00:00Z', stage: 'in_transit', time: '10:10:00', checked: 1 },
    { name: 'moved within 48 hours', created: '2026-08-30T09:00:00Z', lastEvent: '2026-09-07T10:30:00Z', stage: 'in_transit', time: '10:10:00', checked: 1 },
    { name: 'outside routing with a recent summary', created: '2026-08-30T09:00:00Z', lastEvent: null, lastUpdate: '2026-09-08T18:00:00Z', stage: 'in_transit', time: '10:10:00', checked: 1 },
  ])('checks a parcel $name at $time: $checked checks', async ({ created, lastEvent, lastUpdate, stage, time, checked }) => {
    const parcel = {
      id: 'idle', carrier: 'swiss-post', current_stage: stage, tracking_number: 'TEST1234',
      created_at: created, last_synced_at: '2026-09-09T10:00:15Z', sync_status: 'ok',
      carrier_data: lastUpdate ? { last_update: lastUpdate }
        : { routing: { version: 1, configured_carrier: 'swiss-post', ...(lastEvent ? { last_event_at: lastEvent } : {}) } },
    };
    const client = fakeClient([parcel]);
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      adapter, null, () => new Date(`2026-09-09T${time}Z`));
    await expect(service.sync()).resolves.toMatchObject({ checked });
    // A manual refresh is never held back by the idle schedule.
    if (!checked) await expect(service.syncPackage(parcel)).resolves.toMatchObject({ checked: 1 });
  });

  it('keeps out-for-delivery parcels hourly overnight and allows manual refreshes', async () => {
    const parcel = {
      id: 'overnight', carrier: 'swiss-post', current_stage: 'out_for_delivery', tracking_number: 'TEST1234',
      last_synced_at: '2026-09-09T20:00:15Z', sync_status: 'ok',
    };
    const client = fakeClient([parcel]);
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    let now = new Date('2026-09-09T20:02:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      adapter, null, () => now);
    await expect(service.sync()).resolves.toMatchObject({ checked: 0 });
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ checked: 1 });
    now = new Date('2026-09-09T21:00:00Z');
    await expect(service.sync()).resolves.toMatchObject({ checked: 1 });
  });

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

  it('switches an explicit DHL handoff to Swiss Post and keeps both histories', async () => {
    const parcel: JsonObject = { id: 'handoff', carrier: 'dhl', tracking_number: 'LF123456785DE', label: 'Garden cable' };
    const client = fakeClient();
    const origin = { status: 'in_transit', delivery_carrier: 'swiss-post', timezone: 'Europe/Berlin',
      events: [{ time: '2026-09-09T10:00:00+02:00', description: 'Arrived in destination country', stage: 'in_transit' }] };
    const delivery = { status: 'out_for_delivery', expected_delivery: '2026-09-10', timezone: 'Europe/Zurich',
      events: [{ time: '2026-09-10T07:00:00+02:00', description: 'Loaded into delivery vehicle', stage: 'out_for_delivery' }] };
    const adapter = { fetch: vi.fn().mockResolvedValueOnce(origin).mockResolvedValue(delivery) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await service.syncPackage(parcel);
    const values = client.updatePackage.mock.calls.at(-1)?.[1];
    expect(values).toMatchObject({ current_stage: 'out_for_delivery', expected_delivery: '2026-09-10', carrier_data: {
      active_tracking_carrier: 'swiss-post', original_carrier: 'dhl', original_tracking_number: 'LF123456785DE',
    } });
    const events = client.insertEvents.mock.calls[0][0];
    expect(events.map((event: JsonObject) => String(event.provider_event_id).split(':')[0])).toEqual(['dhl', 'swiss-post']);
    adapter.fetch.mockClear();
    await service.syncPackage({ ...parcel, carrier_data: values.carrier_data });
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('swiss-post', parcel.tracking_number, null, null);
    expect(client.updatePackage.mock.calls.at(-1)?.[1].carrier_data).toMatchObject({ active_tracking_carrier: 'swiss-post', original_carrier: 'dhl' });
  });

  it('hands a France-to-Finland parcel to Posti and reuses the verified delivery leg', async () => {
    const parcel = { id: 'finnish-handoff', carrier: 'la-poste', tracking_number: 'CW123456785FR' };
    const client = fakeClient();
    const origin: CarrierResult = { status: 'in_transit', destination_country: 'FI', delivery_carrier: 'posti',
      last_update: '2026-01-11T10:00:00Z', events: [{ time: '2026-01-11T10:00:00Z', description: 'In transport', stage: 'in_transit' }] };
    const delivery: CarrierResult = { status: 'in_transit', current_stage: 'ready_for_pickup',
      last_update: '2026-01-12T10:00:00Z', events: [{ time: '2026-01-12T10:00:00Z', description: 'Ready for pickup', stage: 'ready_for_pickup' }] };
    const adapter = { fetch: vi.fn().mockResolvedValueOnce(origin).mockResolvedValue(delivery) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await service.syncPackage(parcel);
    expect(adapter.fetch.mock.calls.map((call) => call[0])).toEqual(['la-poste', 'posti']);
    const values = client.updatePackage.mock.calls.at(-1)![1];
    expect(values).toMatchObject({ current_stage: 'ready_for_pickup', carrier_data: {
      active_tracking_carrier: 'posti', active_tracking_number: parcel.tracking_number, original_carrier: 'la-poste',
    } });
    expect(client.insertEvents.mock.calls[0][0].map((event: JsonObject) => String(event.provider_event_id).split(':')[0]))
      .toEqual(['la-poste', 'posti']);
    adapter.fetch.mockClear();
    await service.syncPackage({ ...parcel, ...values });
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('posti', parcel.tracking_number, null, null);
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.original_carrier).toBe('la-poste');
  });

  it('does not let a Swiss issuer suffix bypass an explicitly selected Posti adapter', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'delivered' }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'explicit-posti', carrier: 'posti', tracking_number: 'LX123456785CH' });
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('posti', 'LX123456785CH', null, null);
    expect(client.updatePackage.mock.calls.at(-1)![1].current_stage).toBe('delivered');
  });

  it.each(['stale', 'undated', 'registered', 'unknown', 'failed', 'not_found', 'invalid_response', 'terminal_conflict'])(
    'keeps the origin when a Posti handoff is %s', async (state) => {
      const client = fakeClient();
      const origin: CarrierResult = { status: state === 'terminal_conflict' ? 'delivered' : 'in_transit',
        last_update: '2026-01-12T10:00:00Z', delivery_carrier: 'posti', destination_country: 'FI' };
      const delivery: CarrierResult = { status: 'in_transit', current_stage: 'ready_for_pickup', last_update: '2026-01-13T10:00:00Z' };
      if (state === 'stale') delivery.last_update = '2026-01-11T10:00:00Z';
      if (state === 'undated') delivery.last_update = null;
      if (state === 'registered') { delivery.status = 'pending'; delivery.current_stage = 'registered'; }
      if (state === 'unknown') { delivery.status = 'unknown'; delete delivery.current_stage; }
      const adapter = { fetch: vi.fn().mockResolvedValueOnce(origin) };
      if (state === 'failed') adapter.fetch.mockRejectedValueOnce(new Error('Temporary Posti failure'));
      else if (state === 'not_found') adapter.fetch.mockRejectedValueOnce(Object.assign(new Error('Shipment not found'), { status: 404 }));
      else if (state === 'invalid_response') adapter.fetch.mockResolvedValueOnce({ status: 'delivered', events: 'invalid' });
      else adapter.fetch.mockResolvedValueOnce(delivery);
      await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
        .syncPackage({ id: 'unconfirmed', carrier: 'la-poste', tracking_number: 'CW123456785FR' });
      expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.active_tracking_carrier).toBeUndefined();
      expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({
        sync_status: 'ok', current_stage: origin.status, carrier_data: { last_update: origin.last_update },
      });
    },
  );

  it('can confirm an explicit delivery partner after the origin reports delivery', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValueOnce({ status: 'delivered', delivery_carrier: 'posti', last_update: '2026-01-12T10:00:00Z' })
      .mockResolvedValueOnce({ status: 'delivered', last_update: '2026-01-12T10:00:00Z' }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'completed', carrier: 'la-poste', tracking_number: 'CW123456785FR' });
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.active_tracking_carrier).toBe('posti');
  });

  it.each(['partner', 'destination'])('retains a %s handoff with same-day completion without replacing a newer saved summary', async (basis) => {
    const client = fakeClient();
    const hints = basis === 'partner' ? { delivery_carrier: 'posti' } : { destination_country: 'FI' };
    const adapter = { fetch: vi.fn().mockResolvedValueOnce({ status: 'delivered', ...hints, last_update: '2026-01-12T13:00:00Z' })
      .mockResolvedValueOnce({ status: 'delivered', last_update: '2026-01-12T12:00:00Z' }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'same-completion', carrier: 'la-poste', tracking_number: 'CW123456785FR', current_stage: 'delivered',
        carrier_data: { routing: { version: 1, configured_carrier: 'la-poste', last_event_at: '2026-01-12T13:00:00Z' } } });
    const values = client.updatePackage.mock.calls.at(-1)![1];
    expect(values.carrier_data).toMatchObject({ original_carrier: 'la-poste', active_tracking_carrier: 'posti',
      routing: { last_event_at: '2026-01-12T13:00:00Z' } });
    expect(values.last_status_text).toBeUndefined();
    expect(values.current_stage).toBeUndefined();
  });

  it('rejects a delivery partner’s completion from a different day', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValueOnce({ status: 'delivered', delivery_carrier: 'posti', last_update: '2026-01-12T13:00:00Z' })
      .mockResolvedValueOnce({ status: 'delivered', last_update: '2026-01-11T12:00:00Z' }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'old-completion', carrier: 'la-poste', tracking_number: 'CW123456785FR' });
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.active_tracking_carrier).toBeUndefined();
  });

  it('retains named partner probe cooldowns and rechecks when the origin advances', async () => {
    const client = fakeClient();
    let now = new Date('2026-01-12T11:00:00Z');
    let update = '2026-01-12T10:00:00Z';
    const adapter = { fetch: vi.fn(async (carrier: string): Promise<CarrierResult> => carrier === 'posti'
      ? { status: 'pending', current_stage: 'registered' }
      : { status: 'in_transit', last_update: update, delivery_carrier: 'posti' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    let parcel: JsonObject = { id: 'destination', carrier: 'la-poste', tracking_number: 'CW123456785FR' };
    for (const expected of [['la-poste', 'posti'], ['la-poste'], ['la-poste', 'posti']]) {
      adapter.fetch.mockClear();
      await service.syncPackage(parcel);
      expect(adapter.fetch.mock.calls.map((call) => call[0])).toEqual(expected);
      parcel = { ...parcel, ...client.updatePackage.mock.calls.at(-1)![1] };
      if (expected.length === 1) update = '2026-01-12T11:05:00Z';
      now = new Date(now.getTime() + 10 * 60_000);
    }
  });

  it('retains an unsuccessful probe even when an older origin summary is preserved', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn(async (carrier: string): Promise<CarrierResult> => carrier === 'posti'
      ? { status: 'unknown' }
      : { status: 'in_transit', delivery_carrier: 'posti', last_update: '2026-01-12T09:00:00Z' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null,
      () => new Date('2026-01-12T11:00:00Z'));
    let parcel: JsonObject = { id: 'preserved', carrier: 'la-poste', tracking_number: 'CW123456785FR',
      current_stage: 'in_transit', carrier_data: { last_update: '2026-01-12T10:00:00Z', routing: {
        version: 1, configured_carrier: 'la-poste', last_event_at: '2026-01-12T10:00:00Z',
      } } };
    await service.syncPackage(parcel);
    parcel = { ...parcel, ...client.updatePackage.mock.calls.at(-1)![1] };
    expect(parcel.carrier_data).toMatchObject({ last_update: '2026-01-12T10:00:00Z',
      delivery_probe: { carrier: 'posti', at: '2026-01-12T11:00:00.000Z' } });
    adapter.fetch.mockClear();
    await service.syncPackage(parcel);
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('la-poste', parcel.tracking_number, null, null);
  });

  it('lets an aggregator report Posti without a Swiss issuer suffix overriding the partner', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValueOnce({ status: 'in_transit', delivery_carrier: 'posti' })
      .mockResolvedValueOnce({ status: 'out_for_delivery' }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'named-postal', carrier: 'aliexpress', tracking_number: 'LX123456785CH' });
    expect(adapter.fetch.mock.calls.map((call) => call[0])).toEqual(['aliexpress', 'posti']);
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.active_tracking_carrier).toBe('posti');
  });

  it('hands a real Cainiao response shape to its reported local number through normalization', async () => {
    const payload = cainiaoDeliveredFixture;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(payload));
    const swiss = vi.fn().mockResolvedValue({ status: 'delivered', current_stage: 'delivered',
      last_update: '2026-03-04T12:00:00Z', events: [{ time: '2026-03-04T12:00:00Z', description: 'Delivered', stage: 'delivered' }] });
    const registry = new AdapterRegistry({ factories: {
      aliexpress: cainiaoAdapter,
      'swiss-post': () => ({ id: 'swiss-post', steps: ['direct'], track: swiss }),
    }, carriers: { aliexpress: 'aliexpress', 'swiss-post': 'swiss-post' } }, {
      fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {},
    });
    const direct = new CarrierTrackingAdapter(undefined, registry, NOOP_RECORDER);
    const adapter = { fetch: vi.fn(direct.fetch.bind(direct)), fetchUniversal: vi.fn().mockRejectedValue(new Error('Unexpected universal lookup')) };
    const client = fakeClient();
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    const parcel = { id: 'cainiao-reference', carrier: 'aliexpress', tracking_number: 'LP00000000000001' };
    await service.syncPackage(parcel);
    expect(adapter.fetch.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['aliexpress', 'LP00000000000001'], ['swiss-post', 'RA123456785CH'],
    ]);
    expect(swiss).toHaveBeenCalledWith({ number: 'RA123456785CH', trackingUrl: null, postcode: null });
    const values = client.updatePackage.mock.calls.at(-1)![1];
    expect(values.carrier_data).toMatchObject({ original_carrier: 'aliexpress',
      original_tracking_number: 'LP00000000000001', active_tracking_carrier: 'swiss-post', active_tracking_number: 'RA123456785CH' });
    const eventCarriers = new Set(client.insertEvents.mock.calls[0][0].map((event: JsonObject) => String(event.provider_event_id).split(':')[0]));
    expect(eventCarriers).toEqual(new Set(['aliexpress', 'swiss-post']));
    adapter.fetch.mockClear();
    await service.syncPackage({ ...parcel, ...values });
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('swiss-post', 'RA123456785CH', null, null);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(adapter.fetchUniversal).not.toHaveBeenCalled();
  });

  it.each(['aliexpress', 'intl-post'])('retains the established %s Swiss postal probe and pins only confirmed progress', async (carrier) => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValueOnce({ status: 'in_transit', last_update: '2026-03-04T10:00:00Z' })
      .mockResolvedValueOnce({ status: 'out_for_delivery', last_update: '2026-03-04T12:00:00Z' }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'legacy-postal', carrier, tracking_number: 'LX123456785CH' });
    expect(adapter.fetch.mock.calls.map((call) => call[0])).toEqual([carrier, 'swiss-post']);
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.active_tracking_carrier).toBe('swiss-post');
  });

  it.each([['aliexpress', true], ['intl-post', true], ['aliexpress', false]] as const)('retains a previously confirmed %s Swiss route with stored carrier %s', async (carrier, storedCarrier) => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'out_for_delivery' }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'legacy-confirmed', carrier, tracking_number: 'LX123456785CH', carrier_data: {
        swiss_post_ready: true, ...(storedCarrier ? { active_tracking_carrier: 'swiss-post' } : {}),
      } });
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('swiss-post', 'LX123456785CH', null, null);
  });

  it('keeps Cainiao and respects the probe cooldown when Swiss Post does not know the historical postal number', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn(async (carrier: string): Promise<CarrierResult> => {
      if (carrier === 'swiss-post') throw Object.assign(new Error('Shipment not found'), { status: 404 });
      return { status: 'in_transit', last_update: '2026-03-04T10:00:00Z' };
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null,
      () => new Date('2026-03-04T12:00:00Z'));
    const parcel = { id: 'legacy-unannounced', carrier: 'aliexpress', tracking_number: 'LX123456785CH' };
    await service.syncPackage(parcel);
    expect(adapter.fetch.mock.calls.map((call) => call[0])).toEqual(['aliexpress', 'swiss-post']);
    const values = client.updatePackage.mock.calls.at(-1)![1];
    expect(values).toMatchObject({ sync_status: 'ok', current_stage: 'in_transit', carrier_data: { active_tracking_carrier: 'aliexpress' } });
    adapter.fetch.mockClear();
    await service.syncPackage({ ...parcel, ...values });
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('aliexpress', 'LX123456785CH', null, null);
  });

  it.each(['Switzerland', 'Finland'])('respects Cainiao’s actual destination field before the historical probe: %s', async (country) => {
    const number = 'LX123456785CH';
    const origin = parseCainiaoTrackingResponse({ module: [{ mailNo: number, destCountry: country,
      latestTrace: { actionCode: 'LH_ARRIVE', timeStr: '2026-03-04 10:00:00' }, detailList: [],
    }] }, number);
    const adapter = { fetch: vi.fn().mockResolvedValueOnce(origin).mockResolvedValueOnce({ status: 'unknown' }) };
    await new TrackingSyncService(fakeClient() as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'cainiao-destination', carrier: 'aliexpress', tracking_number: number });
    expect(adapter.fetch.mock.calls.map((call) => call[0])).toEqual([
      'aliexpress', country === 'Switzerland' ? 'swiss-post' : 'posti',
    ]);
  });

  it('compares handoff freshness in each carrier’s declared timezone', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValueOnce({ status: 'in_transit', delivery_tracking_number: 'RA123456785CH',
      last_update: '2026-03-04 12:00:00', timezone: 'Asia/Shanghai' })
      .mockResolvedValueOnce({ status: 'out_for_delivery', last_update: '2026-03-04 10:00:00', timezone: 'Europe/Zurich' }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'carrier-timezones', carrier: 'aliexpress', tracking_number: 'LP00000000000001' });
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.active_tracking_carrier).toBe('swiss-post');
  });

  it.each([
    ['aliexpress', 'swiss-post'], ['spring-gds', 'posti'], ['sunyou', 'usps'], ['la-poste', 'ups'],
  ])('switches %s to its reported %s partner after confirmation', async (carrier, partner) => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValueOnce({ status: 'in_transit', delivery_carrier: partner })
      .mockResolvedValue({ status: 'out_for_delivery', expected_delivery: '2026-09-10' }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'postal-handoff', carrier, tracking_number: 'LX123456785NL' });
    expect(adapter.fetch.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [carrier, 'LX123456785NL'], [partner, 'LX123456785NL'],
    ]);
    expect(client.updatePackage.mock.calls.at(-1)?.[1]).toMatchObject({
      current_stage: 'out_for_delivery', expected_delivery: '2026-09-10',
      carrier_data: { original_carrier: carrier, active_tracking_carrier: partner },
    });
  });

  it.each(['la-poste', 'aliexpress', 'spring-gds', 'intl-post'])('keeps %s when the national post has no dated progress', async (carrier) => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit', destination_country: 'FI' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    for (const tracking_number of ['CW123456785FR', 'LX123456785CH']) {
      adapter.fetch.mockClear();
      await service.syncPackage({ id: 'no-partner', carrier, tracking_number });
      expect(adapter.fetch.mock.calls.map((call) => call.slice(0, 2))).toEqual([
        [carrier, tracking_number], ['posti', tracking_number],
      ]);
      expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ sync_status: 'ok', current_stage: 'in_transit' });
      expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.active_tracking_carrier).not.toBe('posti');
    }
  });

  it('confirms a PostNL destination lookup through the real adapter, normalization and router', async () => {
    const number = 'LX123456785NL';
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => Response.json(
      String(url).endsWith('/token') ? { access_token: 'visitor-token' } : { data: { items: [{
        item: number, destination_code: 'CH', events: [{ category: 'Departed',
          datetime_local: '2026-03-04T10:00:00Z', status_description: 'Departed', country_code: 'NL' }],
      }] } },
    ));
    const swiss = vi.fn().mockResolvedValue({ status: 'out_for_delivery', last_update: '2026-03-05T09:00:00Z',
      events: [{ time: '2026-03-05T09:00:00Z', description: 'Out for delivery', stage: 'out_for_delivery' }] });
    const registry = new AdapterRegistry({ factories: {
      'spring-gds': postNLAdapter,
      'swiss-post': () => ({ id: 'swiss-post', steps: ['direct'], track: swiss }),
    }, carriers: { 'spring-gds': 'spring-gds', 'swiss-post': 'swiss-post' } }, {
      fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {},
    });
    const direct = new CarrierTrackingAdapter(undefined, registry, NOOP_RECORDER);
    const adapter = { fetch: vi.fn(direct.fetch.bind(direct)), fetchUniversal: vi.fn() };
    const client = fakeClient();
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    const parcel = { id: 'postal-destination', carrier: 'spring-gds', tracking_number: number };
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1, errors: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(swiss).toHaveBeenCalledExactlyOnceWith({ number, trackingUrl: null, postcode: null });
    expect(adapter.fetchUniversal).not.toHaveBeenCalled();
    const values = client.updatePackage.mock.calls.at(-1)![1];
    expect(values).toMatchObject({ current_stage: 'out_for_delivery', carrier_data: {
      original_carrier: 'spring-gds', original_tracking_number: number,
      active_tracking_carrier: 'swiss-post', active_tracking_number: number,
    } });
    expect(new Set(client.insertEvents.mock.calls[0][0].map((event: JsonObject) => String(event.provider_event_id).split(':')[0])))
      .toEqual(new Set(['spring-gds', 'swiss-post']));
    adapter.fetch.mockClear();
    await service.syncPackage({ ...parcel, ...values });
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('swiss-post', number, null, null);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['unknown', 'registered', 'undated', 'stale', 'failed', 'wrong_identity', 'terminal_conflict'])(
    'keeps PostNL when a national-post probe is %s', async (state) => {
      const client = fakeClient();
      const number = 'LX123456785NL';
      const origin = parsePostNLTrackingResponse({ data: { items: [{ item: number, destination_code: 'CH',
        events: [{ category: state === 'terminal_conflict' ? 'Delivered' : 'Departed',
          datetime_local: '2026-03-04T10:00:00Z', status_description: 'Postal tracking update' }],
      }] } }, number);
      const delivery: CarrierResult = { status: 'out_for_delivery', last_update: '2026-03-05T10:00:00Z' };
      if (state === 'unknown') delivery.status = 'unknown';
      if (state === 'registered') { delivery.status = 'pending'; delivery.current_stage = 'registered'; }
      if (state === 'undated') delivery.last_update = null;
      if (state === 'stale') delivery.last_update = '2026-03-03T10:00:00Z';
      const adapter = { fetch: vi.fn().mockResolvedValueOnce(origin) };
      if (state === 'failed') adapter.fetch.mockRejectedValueOnce(new Error('Swiss Post unavailable'));
      else if (state === 'wrong_identity') adapter.fetch.mockRejectedValueOnce(new SchemaError('Swiss Post', 'Different shipment'));
      else adapter.fetch.mockResolvedValueOnce(delivery);
      await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
        .syncPackage({ id: 'postal-probe', carrier: 'spring-gds', tracking_number: number });
      expect(adapter.fetch.mock.calls.map((call) => call[0])).toEqual(['spring-gds', 'swiss-post']);
      const values = client.updatePackage.mock.calls.at(-1)![1];
      expect(values).toMatchObject({ sync_status: 'ok', current_stage: state === 'terminal_conflict' ? 'delivered' : 'in_transit' });
      expect(values.carrier_data.active_tracking_carrier).not.toBe('swiss-post');
    },
  );

  it('remembers unsuccessful national-post probes and retries a changed destination immediately', async () => {
    const client = fakeClient();
    let destination = 'CH';
    let now = new Date('2026-03-04T12:00:00Z');
    const adapter = { fetch: vi.fn(async (carrier: string): Promise<CarrierResult> => carrier === 'spring-gds'
      ? { status: 'in_transit', destination_country: destination, last_update: '2026-03-04T10:00:00Z' }
      : { status: 'unknown' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    let parcel: JsonObject = { id: 'postal-retry', carrier: 'spring-gds', tracking_number: 'LX123456785NL' };
    for (const expected of [['spring-gds', 'swiss-post'], ['spring-gds'], ['spring-gds', 'posti']]) {
      adapter.fetch.mockClear();
      await service.syncPackage(parcel);
      expect(adapter.fetch.mock.calls.map((call) => call[0])).toEqual(expected);
      parcel = { ...parcel, ...client.updatePackage.mock.calls.at(-1)![1] };
      now = new Date(now.getTime() + 10 * 60_000);
      if (expected.length === 1) destination = 'FI';
    }
  });

  it('does not upgrade a saved destination guess into partner evidence during an origin outage', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockRejectedValueOnce(new Error('PostNL unavailable'))
      .mockResolvedValueOnce({ status: 'delivered' }) };
    await expect(new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'postal-outage', carrier: 'spring-gds', tracking_number: 'LX123456785NL',
        current_stage: 'in_transit', carrier_data: { destination_country: 'CH' } }))
      .resolves.toMatchObject({ errors: 1 });
    expect(client.updatePackage.mock.calls.at(-1)![1].current_stage).toBeUndefined();
  });

  it('ignores invalid optional partner hints without dropping a successful origin result', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'delivered', delivery_carrier: 'unknown-operator', destination_country: 123 }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'malformed-hint', carrier: 'la-poste', tracking_number: 'CW123456785FR' });
    expect(adapter.fetch).toHaveBeenCalledOnce();
    expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ sync_status: 'ok', current_stage: 'delivered' });
  });

  it('asks an unconfirmed partner again only when the origin moves or the gap has passed', async () => {
    const client = fakeClient();
    let now = new Date('2026-09-10T10:00:00Z');
    let originUpdate = '2026-09-09T10:00:00+02:00';
    const adapter = { fetch: vi.fn(async (carrier: string): Promise<CarrierResult> => {
      if (carrier === 'swiss-post') throw Object.assign(new Error('Shipment not found'), { status: 404 });
      return { status: 'in_transit', delivery_carrier: 'swiss-post', last_update: originUpdate, timezone: 'Europe/Paris',
        events: [{ time: originUpdate, description: 'In transit', stage: 'in_transit' }] };
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    let parcel: JsonObject = { id: 'postal', carrier: 'la-poste', tracking_number: 'LX123456785FR' };
    const refresh = async () => {
      adapter.fetch.mockClear();
      await service.syncPackage(parcel);
      parcel = { ...parcel, ...client.updatePackage.mock.calls.at(-1)![1] };
      return adapter.fetch.mock.calls.map((call) => call[0]);
    };

    expect(await refresh()).toEqual(['la-poste', 'swiss-post']);
    expect(parcel.carrier_data).toMatchObject({ delivery_probe: { at: '2026-09-10T10:00:00.000Z', origin_update: originUpdate } });
    // Nothing moved: the two-minute and ten-minute cadences no longer repeat the probe.
    now = new Date('2026-09-10T10:10:00Z');
    expect(await refresh()).toEqual(['la-poste']);
    now = new Date('2026-09-10T10:50:00Z');
    expect(await refresh()).toEqual(['la-poste']);
    expect(parcel.carrier_data).toMatchObject({ delivery_probe: { at: '2026-09-10T10:00:00.000Z' } });
    // The hourly overnight cadence still asks every time.
    now = new Date('2026-09-10T11:00:00Z');
    expect(await refresh()).toEqual(['la-poste', 'swiss-post']);
    // A new origin event is the usual sign of a handover, so it asks at once.
    now = new Date('2026-09-10T11:10:00Z');
    originUpdate = '2026-09-10T12:30:00+02:00';
    expect(await refresh()).toEqual(['la-poste', 'swiss-post']);
    expect(parcel.carrier_data).toMatchObject({ delivery_probe: { at: '2026-09-10T11:10:00.000Z', origin_update: originUpdate } });
  });

  it('rechecks immediately when the partner or its local reference changes', async () => {
    const client = fakeClient();
    let now = new Date('2026-09-10T10:00:00Z');
    let partner = 'swiss-post';
    let reference = 'LOCAL12345';
    const adapter = { fetch: vi.fn(async (carrier: string): Promise<CarrierResult> => {
      if (carrier === partner) throw Object.assign(new Error('Shipment not found'), { status: 404 });
      return { status: 'in_transit', delivery_carrier: partner, delivery_tracking_number: reference, last_update: '2026-09-09T10:00:00+02:00',
        events: [{ time: '2026-09-09T10:00:00+02:00', description: 'Arrived in destination country', stage: 'in_transit' }] };
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    let parcel: JsonObject = { id: 'named', carrier: 'dhl', tracking_number: 'LF123456785DE' };
    for (const [minute, nextPartner, nextReference] of [['00', 'swiss-post', 'LOCAL12345'], ['10', 'posti', 'LOCAL12345'], ['20', 'posti', 'LOCAL67890']]) {
      partner = nextPartner;
      reference = nextReference;
      now = new Date(`2026-09-10T10:${minute}:00Z`);
      adapter.fetch.mockClear();
      await service.syncPackage(parcel);
      parcel = { ...parcel, ...client.updatePackage.mock.calls.at(-1)![1] };
      expect(adapter.fetch.mock.calls.map((call) => call[0])).toEqual(['dhl', partner]);
      expect(adapter.fetch).toHaveBeenLastCalledWith(partner, reference, null, null);
    }
  });

  it('reports an origin failure once: here only when the local delivery hides it from the router', async () => {
    const report = vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    try {
      const outage = new UpstreamHttpError('La Poste', 403);
      // Swiss Post knows nothing either: the origin error is rethrown for the caller to report.
      const silent = { fetch: vi.fn().mockRejectedValueOnce(outage)
        .mockRejectedValueOnce(Object.assign(new Error('Shipment not found'), { status: 404 })) };
      await new TrackingSyncService(fakeClient() as unknown as SupabaseServiceClient, silent, null)
        .syncPackage({ id: 'blocked', carrier: 'la-poste', tracking_number: 'LX123456785FR', current_stage: 'in_transit',
          carrier_data: { delivery_carrier: 'swiss-post' } });
      expect(report).not.toHaveBeenCalledWith('provider_failed', expect.anything());

      const hidden = { fetch: vi.fn().mockRejectedValueOnce(outage).mockResolvedValueOnce({ status: 'out_for_delivery' }) };
      await new TrackingSyncService(fakeClient() as unknown as SupabaseServiceClient, hidden, null)
        .syncPackage({ id: 'hidden', carrier: 'la-poste', tracking_number: 'LX123456785FR', current_stage: 'in_transit',
          carrier_data: { delivery_carrier: 'swiss-post' } });
      expect(report).toHaveBeenCalledExactlyOnceWith('provider_failed', expect.objectContaining({
        carrier: 'la-poste', provider: 'la-poste', errorClass: 'UpstreamHttpError', error: outage,
      }));
    } finally { report.mockRestore(); }
  });

  it('can confirm a previously reported partner while the international tracker is unavailable', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockRejectedValueOnce(new Error('Cainiao unavailable'))
      .mockResolvedValueOnce({ status: 'out_for_delivery' }) };
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'postal-outage', carrier: 'aliexpress', tracking_number: 'LX123456785NL',
        carrier_data: { delivery_carrier: 'swiss-post' } });
    expect(client.updatePackage.mock.calls.at(-1)?.[1]).toMatchObject({
      sync_status: 'ok', carrier_data: { active_tracking_carrier: 'swiss-post' },
    });
  });

  it('persists a different domestic number and uses it for later refreshes', async () => {
    const parcel = { id: 'gls-handoff', carrier: 'gls-de', tracking_number: '123456789011' };
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValueOnce({ status: 'in_transit', delivery_carrier: 'swiss-post',
      delivery_tracking_number: '12345678901', canonical_tracking_number: '12345678901' })
      .mockResolvedValue({ status: 'out_for_delivery', canonical_tracking_number: '990000000000000001' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await service.syncPackage(parcel);
    expect(adapter.fetch.mock.calls[1]).toEqual(['swiss-post', '12345678901', null, null]);
    const values = client.updatePackage.mock.calls.at(-1)?.[1];
    expect(values.carrier_data).toMatchObject({ active_tracking_number: '990000000000000001',
      original_tracking_number: '123456789011', original_canonical_tracking_number: '12345678901' });
    adapter.fetch.mockClear();
    await service.syncPackage({ ...parcel, ...values });
    expect(adapter.fetch).toHaveBeenCalledExactlyOnceWith('swiss-post', '990000000000000001', null, null);
    expect(client.updatePackage.mock.calls.at(-1)?.[1].carrier_data).toMatchObject({ active_tracking_number: '990000000000000001', original_canonical_tracking_number: '12345678901' });
  });

  it.each(['missing', 'registered', 'error'])('keeps DHL active when Swiss Post is %s', async (state) => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValueOnce({ status: 'in_transit', delivery_carrier: 'swiss-post' }) };
    if (state === 'error') adapter.fetch.mockRejectedValueOnce(new Error('Unavailable'));
    else adapter.fetch.mockResolvedValueOnce(state === 'registered'
      ? { status: 'pending', current_stage: 'registered' } : { status: 'unknown', events: [] });
    await new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null)
      .syncPackage({ id: 'waiting-handoff', carrier: 'dhl', tracking_number: 'LF123456785DE' });
    const values = client.updatePackage.mock.calls.at(-1)?.[1];
    expect(values.current_stage).toBe('in_transit');
    expect(values.carrier_data.active_tracking_carrier).toBeUndefined();
    expect(values.carrier_data.original_carrier).toBeUndefined();
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

  it.each(['ok', 'error'])('checks PostNL every thirty minutes after %s checks', async (syncStatus) => {
    const parcel = {
      id: 'postnl', carrier: 'spring-gds', tracking_number: 'LX123456785NL',
      current_stage: 'in_transit',
      last_synced_at: '2026-09-09T10:00:00Z', sync_status: syncStatus,
    };
    const client = fakeClient([parcel]);
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    let now = new Date('2026-09-09T10:02:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      adapter, null, () => now);
    await expect(service.sync()).resolves.toMatchObject({ checked: 0 });
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ checked: 1, updated: 1 });
    now = new Date('2026-09-09T10:10:00Z');
    await expect(service.sync()).resolves.toMatchObject({ checked: 0 });
    now = new Date('2026-09-09T10:30:00Z');
    await expect(service.sync()).resolves.toMatchObject({ checked: 1, updated: 1 });
    expect(adapter.fetch.mock.calls.filter(([carrier]) => carrier === 'spring-gds')).toHaveLength(2);
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
      tracking_number: '06080000000002',
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
    }), undefined);
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
        stage: 'exception',
        occurred_at: '2026-08-30T13:00:00.000Z',
      }),
    ]));
    expect(client.updatePackage).toHaveBeenLastCalledWith(
      'package-current-failure',
      expect.objectContaining({
        current_stage: 'exception',
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
      tracking_number: '06080000000002',
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

  it('keeps an unannounced parcel waiting when every fallback provider fails on it too', async () => {
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = { fetch: vi.fn().mockRejectedValue(Object.assign(new Error('not live'), { status: 404 })),
      fetchUniversal: vi.fn().mockRejectedValue(new Error('provider down')) };
    const parcel = { id: 'fresh', carrier: 'dhl', tracking_number: 'TEST1234', current_stage: 'pending' };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await expect(service.syncPackage(parcel, { trigger: 'scheduled' })).resolves.toMatchObject({ waiting: 1, errors: 0 });
    expect(adapter.fetchUniversal).toHaveBeenCalled();
    expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ sync_status: 'waiting', sync_error: null,
      carrier_data: { routing: { failures: { dhl: { kind: 'not_found' }, Ship24: { kind: expect.any(String) } } } } });
    expect(client.recordTrackingHealth).toHaveBeenLastCalledWith(expect.any(String), 'fresh',
      expect.arrayContaining([expect.objectContaining({ kind: 'refresh', healthy: true })]));
  });

  it('keeps an unknown-carrier parcel waiting while no provider has history for it', async () => {
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const noHistory = (source: string) => source === 'Ship24' ? new NotFoundError(source)
      : new IndeterminateError(source, `${source} has no usable shipment history`);
    const adapter = { fetch: vi.fn(), fetchUniversal: vi.fn(async (source: string) => { throw noHistory(source); }) };
    const parcel = { id: 'not-handed-over', carrier: 'unknown', tracking_number: 'TEST1234', current_stage: 'pending' };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await expect(service.syncPackage(parcel, { trigger: 'scheduled' })).resolves.toMatchObject({ waiting: 1, errors: 0 });
    expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ sync_status: 'waiting', sync_error: null,
      carrier_data: { routing: { failures: { Ship24: { kind: 'not_found' }, ParcelsApp: { kind: 'no_history' } } } } });

    // A provider that could not be reached leaves the answer open.
    adapter.fetchUniversal.mockImplementation(async (source: string) => {
      throw source === 'ParcelsApp' ? new UpstreamHttpError(source, 502) : noHistory(source);
    });
    await expect(service.syncPackage({ ...parcel, id: 'provider-down' }, { trigger: 'scheduled' }))
      .resolves.toMatchObject({ errors: 1 });
  });

  it('records no health sample for a scheduled check that contacted no provider', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn(), fetchUniversal: vi.fn() };
    const cooling = Object.fromEntries(['dhl', 'Ship24', 'ParcelsApp', '17TRACK']
      .map((provider) => [provider, { count: 1, kind: 'transport', retry_at: '2026-09-10T13:00:00.000Z' }]));
    const parcel = { id: 'cooling', carrier: 'dhl', tracking_number: 'TEST1234', current_stage: 'pending',
      carrier_data: { routing: { version: 1, configured_carrier: 'dhl', failures: cooling, probe_cursor: 0, discovery_cursor: 0 } } };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await expect(service.syncPackage(parcel, { trigger: 'scheduled' })).resolves.toMatchObject({ errors: 1 });
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(adapter.fetchUniversal).not.toHaveBeenCalled();
    expect(client.completeSyncAttempt).toHaveBeenCalled();
    expect(client.recordTrackingHealth).not.toHaveBeenCalled();
  });

  it('records why a lookup was deferred when every provider failed', async () => {
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = { fetch: vi.fn().mockRejectedValue(new UpstreamHttpError('DHL', 502)),
      fetchUniversal: vi.fn().mockRejectedValue(new Error('provider down')) };
    const parcel = { id: 'stale', carrier: 'dhl', tracking_number: 'TEST1234', current_stage: 'in_transit' };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await expect(service.syncPackage(parcel, { trigger: 'scheduled' })).resolves.toMatchObject({ errors: 1 });
    expect(client.completeSyncAttempt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outcome: 'error', error_type: 'RoutingDeferredError' }),
      expect.arrayContaining([expect.objectContaining({
        step: 'fetch', status: 'failed', error_type: 'RoutingDeferredError',
        details: expect.objectContaining({ providers_attempted: expect.any(Number), provider_failures: expect.stringContaining('dhl:transport') }),
      })]),
    );
    // No tier produced a sample here, so the attempt's own type is the refresh evidence.
    expect(client.recordTrackingHealth).toHaveBeenLastCalledWith(expect.any(String), 'stale',
      expect.arrayContaining([expect.objectContaining({ kind: 'refresh', healthy: false,
        details: { error_type: 'RoutingDeferredError' } })]));
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
      sync_error: 'carrier:not_found',
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

  it.each(['amazon-logistics', 'unknown', 'ups'])('stops existing Amazon Logistics parcels routed as %s before any provider call', async (carrier) => {
    const client = fakeClient();
    const adapter: TrackingAdapter = { fetch: vi.fn(), fetchUniversal: vi.fn() };
    const capture = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter);
    const parcel = { id: 'amazon-parcel', carrier, tracking_number: 'FR3000000001' };
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ unsupported: 1, errors: 0 });
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(adapter.fetchUniversal).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(client.updatePackage).toHaveBeenCalledWith('amazon-parcel', expect.objectContaining({
      sync_status: 'unsupported', sync_error: expect.stringContaining('Amazon account'),
    }));
    expect(isTrackingSyncDue({ ...parcel, sync_status: 'unsupported' }, new Date())).toBe(false);
  });

  it('dispatches confirmed Shipping without applying the retail guard or trying universal providers', async () => {
    const client = fakeClient();
    const fetch = vi.spyOn(AmazonShippingTracker.prototype, 'fetch').mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit' });
    const adapter = new CarrierTrackingAdapter();
    const universal = vi.spyOn(adapter, 'fetchUniversal');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter);
    await service.syncPackage({ id: 'shipping-parcel', carrier: 'amazon-shipping', tracking_number: 'FR0000000001' });
    expect(fetch).toHaveBeenCalledWith('FR0000000001');
    expect(universal).not.toHaveBeenCalled();
  });

  it('forwards the stored delivery postcode to universal providers', async () => {
    const universal = { fetchSource: vi.fn().mockResolvedValue({ status: 'in_transit' }), fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    const recorder: StepRecorder = { step: () => undefined, lookup: () => undefined };
    const registry = new AdapterRegistry({ factories: {}, carriers: { unknown: 'universal' } },
      { trawl: null, browserExecutablePath: null, recorder, env: {} } satisfies AdapterEnvironment);
    const adapter = new CarrierTrackingAdapter(universal as unknown as UniversalTracker, registry, recorder);
    await expect(adapter.fetch('unknown', 'TEST1234', null, '8000')).resolves.toMatchObject({ status: 'in_transit' });
    expect(universal.fetch).toHaveBeenCalledWith('TEST1234', '8000');
    await adapter.fetchUniversal('Ship24', 'TEST1234', 1000, '8000');
    expect(universal.fetchSource).toHaveBeenCalledWith('Ship24', 'TEST1234', 1000, '8000', null);
    await adapter.fetchUniversal('Ship24', 'TEST1234', 1000, null, 'Europe/Zurich');
    expect(universal.fetchSource).toHaveBeenLastCalledWith('Ship24', 'TEST1234', 1000, null, 'Europe/Zurich');
  });

  it('keeps expired Shipping history out of the timeline and Sentry', async () => {
    const client = fakeClient();
    const fetch = vi.fn().mockRejectedValue(new AmazonShippingHistoryExpiredError());
    const universal = vi.fn();
    const capture = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, { fetch, fetchUniversal: universal });
    await expect(service.syncPackage({ id: 'shipping-parcel', carrier: 'amazon-shipping', tracking_number: 'UK0000000001' }))
      .resolves.toMatchObject({ unsupported: 1, errors: 0 });
    expect(client.updatePackage).toHaveBeenCalledWith('shipping-parcel', expect.objectContaining({ sync_status: 'unsupported', sync_error: 'amazon_shipping_history_expired' }));
    expect(universal).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it('marks an unavailable catalog carrier unsupported without pretending it was checked', async () => {
    const client = fakeClient();
    const adapter: TrackingAdapter = { fetch: vi.fn() };
    const service = new TrackingSyncService(
      client as unknown as SupabaseServiceClient,
      adapter,
    );

    await expect(service.syncPackage({ id: 'package-3', carrier: 'unavailable-carrier' }))
      .resolves.toMatchObject({ unsupported: 1, checked: 1 });
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(client.updatePackage).toHaveBeenCalledWith('package-3', expect.objectContaining({
      sync_status: 'unsupported',
      last_synced_at: null,
    }));
  });

  it('keeps failed lookup diagnostics in logs without creating an immediate Sentry issue', async () => {
    const parcel = { id: 'unknown-package', carrier: 'unknown', tracking_number: 'TEST1234' };
    const client = fakeClient();
    const error = new UniversalTrackingError([
      { source: '17TRACK', reason: 'history unavailable', error: new TypeError('No matching tracking response') },
      { source: 'ParcelsApp', reason: 'history unavailable', error: new TypeError('Shipment identity missing') },
    ]);
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const capture = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, {
      fetch: vi.fn().mockRejectedValue(error),
    });

    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ errors: 1 });
    expect(capture).not.toHaveBeenCalled();
    const logs = [...output.mock.calls, ...errors.mock.calls].map(([line]) => JSON.parse(String(line)));
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'tracking_sync_started', tracking_number: 'TEST1234' }),
      expect.objectContaining({ event: 'tracking_sync_step', step: 'fetch', step_status: 'failed', tracking_number: 'TEST1234' }),
      expect.objectContaining({ event: 'tracking_sync_completed', outcome: 'error', tracking_number: 'TEST1234' }),
    ]));
  });

  it('keeps tracking operational when the private audit store is unavailable', async () => {
    const parcel = {
      id: 'package-audit-outage',
      carrier: 'dpd',
      tracking_number: '06080000000002',
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

  it('flags a scan two hours ahead, the mark of a local clock read as UTC, but not minor skew', () => {
    const now = new Date('2026-06-10T07:00:00Z');
    const ahead = (occurred_at: string) => detectSyncAnomalies({ current_stage: 'in_transit' },
      { status: 'in_transit', events: [] }, [{ occurred_at }], 'spring-gds', 'in_transit', now);
    expect(ahead('2026-06-10T09:15:00Z')).toContain('future_event_timestamp');
    expect(ahead('2026-06-10T07:35:00Z')).not.toContain('future_event_timestamp');
  });

  it('accepts a problem reported after delivery without calling it a regression', () => {
    expect(detectSyncAnomalies(
      { current_stage: 'delivered' },
      {
        status: 'exception',
        last_status_text: 'Parcel damaged in transit',
        events: [{ time: '2026-08-31T09:00:00Z', description: 'Parcel damaged in transit' }],
      },
      [{ occurred_at: '2026-08-31T09:00:00Z' }],
      'dpd',
      'exception',
      new Date('2026-08-31T12:00:00Z'),
    )).not.toContain('terminal_stage_regression');
  });

  it('still flags other movement away from a terminal stage', () => {
    expect(detectSyncAnomalies(
      { current_stage: 'delivered' },
      {
        status: 'in_transit',
        last_status_text: 'In transit',
        events: [{ time: '2026-08-31T09:00:00Z', description: 'In transit' }],
      },
      [{ occurred_at: '2026-08-31T09:00:00Z' }],
      'dpd',
      'in_transit',
      new Date('2026-08-31T12:00:00Z'),
    )).toContain('terminal_stage_regression');
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
