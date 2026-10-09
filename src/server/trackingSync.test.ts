import { carrierResult } from '../test/carrierResults';
import { CarrierError } from 'universal-parcel-scraper';
import { REGISTRY } from 'universal-parcel-scraper/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { secondsUntilNextSync, workerPollDelay } from './background';
import { deployedVersion } from './reviewQueues';
import { normalizeCarrierResult, type CarrierResult } from 'universal-parcel-scraper';
import { STORED_EVENT_IDENTITIES, type SupabaseServiceClient } from './supabase';
import { AdapterRegistry, type AdapterEnvironment } from 'universal-parcel-scraper/node';
import type { StepRecorder } from 'universal-parcel-scraper/node';
import type { UniversalTracker } from 'universal-parcel-scraper/node';
import { eventTimestamp } from 'universal-parcel-scraper/app';
import {
  CarrierTrackingAdapter,
  buildEvents,
  classifyStage,
  collectMappedStatusKeys,
  collectStatusObservations,
  detectSyncAnomalies,
  fairSyncPackages,
  inferStage,
  MAX_STATUS_OBSERVATIONS_PER_SYNC,
  isOpenedParcelSyncDue,
  isTrackingSyncDue,
  isUnannouncedTrackingError,
  providerEventId,
  resultHasUpdate,
  resultStage,
  stageToSave,
  TrackingSyncService,
  type TrackingAdapter,
} from './trackingSync';
import type { JsonObject } from './types';
import * as observability from './observability';
import { WorkerShutdown } from './trackingAudit';
import { UniversalTrackingError } from 'universal-parcel-scraper/node';
import { UpstreamHttpError } from 'universal-parcel-scraper/node';
import { NOOP_RECORDER } from 'universal-parcel-scraper/node';
import { IndeterminateError, NotFoundError, SchemaError } from 'universal-parcel-scraper';
import * as scraper from 'universal-parcel-scraper';

// Keep the published plan configurable without changing the scraper's other exports.
vi.mock(import('universal-parcel-scraper'), async importOriginal => ({ ...await importOriginal() }));
// India Post's policy names the zone it once read every clock in from the next scraper release;
// until the app takes that version, its tests add the zone themselves.
vi.mock('universal-parcel-scraper/app', async (importOriginal) => {
  const scraper = await importOriginal<typeof import('universal-parcel-scraper/app')>();
  return { ...scraper, sameInstantIdentityPolicy: (...args: Parameters<typeof scraper.sameInstantIdentityPolicy>) => {
    const policy = scraper.sameInstantIdentityPolicy(...args);
    return args[0] === 'india-post' && policy ? { relabelledFrom: 'Asia/Kolkata', ...policy } : policy;
  } };
});

afterEach(() => vi.restoreAllMocks());

describe('dedicated carrier dispatch', () => {
  it('dispatches Royal Mail through its dedicated registry adapter', async () => {
    const universal = { fetch: vi.fn() };
    const adapter = new CarrierTrackingAdapter(universal as unknown as UniversalTracker);
    const track = vi.spyOn(adapter.registry.for('royal-mail')!, 'track').mockResolvedValue({ status: 'in_transit' });

    await expect(adapter.fetch('royal-mail', 'SG999999999GB', null)).resolves.toMatchObject({ status: 'in_transit' });
    expect(track).toHaveBeenCalledExactlyOnceWith({ number: 'SG999999999GB', trackingUrl: null, postcode: null });
    expect(universal.fetch).not.toHaveBeenCalled();
    expect(adapter.registry.has('royal-mail')).toBe(true);
  });

  it.each(['la-poste', 'chronopost', 'gls-fr', 'colis-prive', 'geodis', 'dpd-fr', 'mondial-relay', 'relais-colis', 'swiss-post-cargo', 'gls-ch', 'colisweb', 'c-chez-vous', 'heppner', 'ciblex', 'paack', 'india-post'])('dispatches %s through the public registry', async carrier => {
    const adapter = new CarrierTrackingAdapter();
    const track = vi.spyOn(adapter.registry.for(carrier)!, 'track').mockResolvedValue({ status: 'in_transit' });
    expect(await adapter.fetch(carrier, 'SYNTHETIC0001', null, '00000')).toMatchObject({ status: 'in_transit' });
    expect(track.mock.calls[0][0]).toEqual({ number: 'SYNTHETIC0001', trackingUrl: null, postcode: '00000' });
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
    expect(inferStage('Return to sender')).toBe('exception');
    expect(inferStage('Returned to sender')).toBe('returned');
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
      ['exception', 'wording:language'],
      ['delivered', 'wording:delivered'],
      ['in_transit', 'none'],
    ]);
    // The raw provider event is still stored next to the recorded source.
    expect(rows[3]?.raw_data).toEqual({
      time: '2026-09-10T06:00:00Z', description: 'Estado interno 99', stage_source: 'none',
    });
  });

  it('keeps a scan the carrier repeats word for word once', () => {
    const sort = { time: '2026-09-29T06:07:00+02:00', description: 'Tri effectué dans l’agence de distribution' };
    const rows = buildEvents({ id: 'package-1', carrier: 'chronopost' }, {
      status: 'in_transit',
      events: [sort, { ...sort }, { ...sort, location: 'Agence' }, { ...sort, time: '2026-09-29T06:08:00+02:00' }, { ...sort }],
    });
    // Saving the same identity twice in one batch fails the whole refresh.
    expect(rows.map((row) => [row.occurred_at, row.location])).toEqual([
      ['2026-09-29T04:07:00Z', null],
      ['2026-09-29T04:07:00Z', 'Agence'],
      ['2026-09-29T04:08:00Z', null],
    ]);
    expect(new Set(rows.map((row) => row.provider_event_id)).size).toBe(rows.length);
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
    const result = normalizeCarrierResult(carrierResult('dpd-delivered'));
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
    for (const eventTypes of [['ORI'], ['ORI', 'CCO']]) {
      const result = carrierResult(eventTypes.length === 1 ? 'dpd-ORI' : 'dpd-ORI-CCO');
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
  it('reviews preclassified aggregator wording and pending fallbacks while keeping explicit maps out', () => {
    const rows = buildEvents({ id: 'package-1', carrier: 'unknown' }, {
      tracking_provider: 'ParcelsApp',
      status: 'in_transit', current_stage: 'in_transit',
      events: [
        { time: '2026-01-01T12:00:00Z', description: 'Unrecognized carrier message', stage: 'pending', stage_source: 'none' },
        { time: '2026-01-01T11:00:00Z', description: 'Sorted in regional hub', stage: 'in_transit', stage_source: 'wording:language' },
        { time: '2026-01-01T10:00:00Z', description: 'Mapped milestone', stage: 'accepted', stage_source: 'carrier_map' },
        { time: '2026-01-01T09:00:00Z', description: 'Legacy mapped milestone', stage: 'accepted' },
      ],
    });
    expect(rows.map((row) => [row.stage, (row.raw_data as JsonObject).stage_source])).toEqual([
      ['pending', 'none'], ['in_transit', 'wording:language'], ['accepted', 'carrier_map'], ['accepted', 'carrier_map'],
    ]);
    expect(collectStatusObservations(rows, 'unknown').map((observation) => [
      observation.description_normalized, observation.chosen_stage, observation.stage_source,
    ])).toEqual([
      ['unrecognized carrier message', 'pending', 'none'],
      ['sorted in regional hub', 'in_transit', 'wording:language'],
    ]);
  });

  it('preserves summary and local-clock milestone sources when no timestamped scan can be saved', () => {
    const parcel = { id: 'package-1', carrier: 'unknown', current_stage: 'pending' };
    const summary = buildEvents(parcel, {
      status: 'in_transit', current_stage: 'in_transit', current_stage_source: 'wording:provider',
      last_status_text: 'Sorted in regional hub', last_update: '2026-01-01T11:00:00Z',
    });
    expect(collectStatusObservations(summary, 'unknown')).toMatchObject([
      { chosen_stage: 'in_transit', stage_source: 'wording:provider' },
    ]);
    for (const current_stage_source of [undefined, 'wording:provider']) {
      const observed = buildEvents(parcel, {
        tracking_provider: 'UPU', status: 'in_transit', current_stage: 'in_transit', current_stage_source,
        events: [{ local_time: '2026-01-01T11:00:00', description: 'Sorted in regional hub',
          stage: 'in_transit', stage_source: 'wording:provider', provider_code: 'ZZ1' }],
      }, undefined, new Date('2026-01-01T12:00:00Z'));
      expect(observed).toHaveLength(1);
      expect(collectStatusObservations(observed, 'unknown')).toMatchObject([
        { provider_code: 'ZZ1', chosen_stage: 'in_transit', stage_source: 'wording:provider' },
      ]);
    }
  });

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

  it('keys the wording a carrier map resolved in every scan that carried it', () => {
    const scan = (description: string, stage_source: string, provider_code = '5') => ({
      package_id: 'package-1', stage: 'in_transit', description,
      provider_event_id: `ctt:${description}:${stage_source}`, raw_data: { stage_source, provider_code },
    });
    const mapped = scan('Objeto entregue', 'carrier_map');
    const keys = collectMappedStatusKeys([
      mapped, { ...mapped },
      scan('Em trânsito', 'carrier_map', '3'), scan('Em trânsito', 'none', '3'),
      scan('Estado interno 99', 'none', '99'),
    ], 'ctt');
    // The key an unmapped observation of the same wording would carry.
    const [observed] = collectStatusObservations([{ ...mapped, raw_data: { stage_source: 'none', provider_code: '5' } }], 'ctt');
    expect(keys).toEqual([observed?.observation_key]);

    const many = Array.from({ length: MAX_STATUS_OBSERVATIONS_PER_SYNC + 8 }, (_, index) => scan(`Mapped ${index}`, 'carrier_map'));
    expect(collectMappedStatusKeys(many, 'ctt')).toHaveLength(MAX_STATUS_OBSERVATIONS_PER_SYNC);
  });

  it('sends the keys of mapped wording with the server version', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({
      status: 'in_transit', current_stage: 'in_transit', current_stage_source: 'carrier_map',
      events: [{ time: '2026-01-01T12:00:00Z', description: 'Sorted in regional hub', provider_code: 'HUB',
        stage: 'in_transit', stage_source: 'carrier_map' }],
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await expect(service.syncPackage({ id: 'observed', carrier: 'ctt', tracking_number: 'TEST1234' }))
      .resolves.toMatchObject({ updated: 1 });
    expect(client.recordTrackingStatusObservations).toHaveBeenCalledWith(
      [], [expect.stringMatching(/^[0-9a-f]{64}$/)], deployedVersion(),
    );
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
    // No carrier map knows the wording.
    expect(client.closeTrackingStatusObservations).not.toHaveBeenCalled();
  });

  it('closes the wording a carrier map leaves unmapped on purpose once it is recorded', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({
      status: 'in_transit', current_stage: 'in_transit', current_stage_source: 'carrier_map',
      events: [
        { time: '2026-01-01T12:00:00Z', description: 'Parcel handed to DPD', provider_code: 'PARCEL_HANDED' },
        { time: '2026-01-01T11:00:00Z', description: 'Synthetic carrier message', provider_code: 'ZZZ' },
      ],
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await expect(service.syncPackage({ id: 'observed', carrier: 'dpd', tracking_number: 'TEST1234' }))
      .resolves.toMatchObject({ updated: 1, errors: 0 });
    const [recorded] = client.recordTrackingStatusObservations.mock.calls[0]!;
    const handed = (recorded as Array<{ observation_key: string; provider_code: string }>)
      .find((observation) => observation.provider_code === 'PARCEL_HANDED');
    expect(recorded).toHaveLength(2);
    expect(client.closeTrackingStatusObservations).toHaveBeenCalledExactlyOnceWith(deployedVersion(), {
      resolution: 'ignored',
      note: "DPD's map leaves it unmapped on purpose: it moves the parcel in transit without a milestone of its own.",
      keys: [handed?.observation_key],
    });
    expect(client.closeTrackingStatusObservations.mock.invocationCallOrder[0])
      .toBeGreaterThan(client.recordTrackingStatusObservations.mock.invocationCallOrder[0]);
  });

  it('persists aggregator observations even when the scraper has already assigned stages', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({
      tracking_provider: 'Ship24', status: 'in_transit', current_stage: 'in_transit',
      current_stage_source: 'wording:language',
      events: [
        { time: '2026-01-01T12:00:00Z', description: 'Unrecognized carrier message', stage: 'pending', stage_source: 'none' },
        { time: '2026-01-01T11:00:00Z', description: 'Sorted in regional hub', stage: 'in_transit', stage_source: 'wording:language' },
      ],
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await expect(service.syncPackage({ id: 'observed', carrier: 'ctt', tracking_number: 'TEST1234' }))
      .resolves.toMatchObject({ updated: 1 });
    expect(client.recordTrackingStatusObservations).toHaveBeenCalledWith([
      expect.objectContaining({ chosen_stage: 'pending', stage_source: 'none' }),
      expect.objectContaining({ chosen_stage: 'in_transit', stage_source: 'wording:language' }),
    ], [], deployedVersion());
    expect(client.recordTrackingStatusObservations.mock.invocationCallOrder[0])
      .toBeGreaterThan(client.insertEvents.mock.invocationCallOrder[0]);
  });

  it('records an entirely unresolved history without advancing the parcel', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({
      tracking_provider: 'Ship24', status: 'pending', current_stage: 'pending', current_stage_source: 'none',
      events: [{ time: '2026-01-01T12:00:00Z', description: 'Unrecognized carrier message',
        stage: 'pending', stage_source: 'none' }],
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await expect(service.syncPackage({ id: 'observed', carrier: 'ctt', tracking_number: 'TEST1234', current_stage: 'pending' }))
      .resolves.toMatchObject({ waiting: 1, updated: 0, errors: 0 });
    expect(client.recordTrackingStatusObservations).toHaveBeenCalledWith([
      expect.objectContaining({ chosen_stage: 'pending', stage_source: 'none' }),
    ], [], deployedVersion());
    expect(client.updatePackage).toHaveBeenCalledWith('observed', expect.objectContaining({ current_stage: 'pending' }));
  });

  it('reviews unresolved local-clock wording without manufacturing a timeline timestamp', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn().mockResolvedValue({
      tracking_provider: 'UPU', status: 'pending', current_stage: 'pending', current_stage_source: 'none',
      events: [{ local_time: '2026-01-01T12:00:00', description: 'Unrecognized carrier message',
        stage: 'pending', stage_source: 'none', provider_code: 'ZZ1' }],
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    await expect(service.syncPackage({ id: 'observed', carrier: 'ctt', tracking_number: 'TEST1234', current_stage: 'pending' }))
      .resolves.toMatchObject({ waiting: 1, updated: 0, errors: 0 });
    expect(client.insertEvents).not.toHaveBeenCalled();
    expect(client.recordTrackingStatusObservations).toHaveBeenCalledWith([
      expect.objectContaining({ provider_code: 'ZZ1', chosen_stage: 'pending', stage_source: 'none' }),
    ], [], deployedVersion());
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
    listFollowedOneOffPackages: vi.fn().mockResolvedValue([]),
    listUnwatchedPackageIds: vi.fn().mockResolvedValue([]),
    sharedAlertPackageIds: vi.fn().mockResolvedValue(new Set()),
    autoLinkPackages: vi.fn().mockResolvedValue(0),
    updatePackage: vi.fn().mockResolvedValue(undefined),
    insertEvents: vi.fn().mockResolvedValue(undefined),
    deleteEventsByDescriptions: vi.fn().mockResolvedValue(undefined),
    startSyncAttempt: vi.fn().mockResolvedValue(undefined),
    completeSyncAttempt: vi.fn().mockResolvedValue(true),
    recordTrackingHealth: vi.fn().mockResolvedValue([]),
    ackTrackingHealth: vi.fn().mockResolvedValue(undefined),
    recordTrackingStatusObservations: vi.fn().mockResolvedValue(undefined),
    closeTrackingStatusObservations: vi.fn().mockResolvedValue(1),
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
  it('consumes new-add query context before fetching and never repeats it on refresh', async () => {
    const candidates = ['dpd', 'seur', 'brt', 'relais-colis', 'ciblex', 'hermes-de'].map((carrier) => ({ carrier, needsInput: null, preferred: false }));
    vi.spyOn(scraper, 'recognitionCandidates').mockReturnValue(candidates);
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-10T11:00:00Z' }),
      fetchUniversal: vi.fn().mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-10T11:00:00Z' }),
      recognize: vi.fn().mockResolvedValue({ known: false }) };
    const parcel: JsonObject = { id: 'new-add', carrier: 'unknown', tracking_number: '00000000000001', current_stage: 'pending',
      carrier_data: { add_recognition_pending: true, lookup_country_hint: 'CH' } };
    let now = new Date('2026-09-10T12:00:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    await service.syncPackage(parcel);
    expect(adapter.recognize).toHaveBeenCalledTimes(6);
    const first = client.updatePackage.mock.calls[0][1];
    expect(first).toMatchObject({ sync_status: 'syncing', carrier_data: { lookup_country_hint: 'CH' } });
    expect(first.carrier_data).not.toHaveProperty('add_recognition_pending');
    expect(client.updatePackage.mock.invocationCallOrder[0]).toBeLessThan(adapter.recognize.mock.invocationCallOrder[0]);
    const saved = client.updatePackage.mock.calls.at(-1)![1];
    expect(saved.carrier_data).not.toHaveProperty('add_recognition_pending');
    now = new Date('2026-09-10T14:00:00Z');
    adapter.recognize.mockClear();
    await service.syncPackage({ ...parcel, ...saved });
    expect(adapter.recognize).toHaveBeenCalledTimes(5);
  });

  it.each(['ParcelsApp', 'Ship24'] as const)('keeps the country hint through a %s lookup that does not send it and later direct recovery', async (provider) => {
    vi.spyOn(scraper, 'universalPlan').mockReturnValue({
      sources: [provider], carrier: null, tier: () => 'unknown', rank: () => 0,
    });
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const progress = { status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-10T11:00:00Z' };
    const adapter = { fetch: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(progress),
      fetchUniversal: vi.fn().mockResolvedValue(progress) };
    const parcel = { id: 'country-hint', carrier: 'dhl', tracking_number: 'TEST1234', current_stage: 'pending', carrier_data: { lookup_country_hint: 'FR' } };
    let now = new Date('2026-09-10T12:00:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    await service.syncPackage(parcel);
    expect(adapter.fetchUniversal).toHaveBeenCalledExactlyOnceWith(provider, 'TEST1234', expect.any(Number), null, 'Europe/Berlin');
    const saved = client.updatePackage.mock.calls.at(-1)![1];
    expect(saved.carrier_data.lookup_country_hint).toBe('FR');
    expect(saved.carrier_data.destination_country).toBeUndefined();
    now = new Date('2026-09-10T13:00:00Z');
    await service.syncPackage({ ...parcel, ...saved });
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.lookup_country_hint).toBe('FR');
    expect(adapter.fetch).toHaveBeenCalledTimes(2);
    expect(adapter.fetchUniversal).toHaveBeenCalledTimes(1);
  });

  it.each(['ParcelsApp', 'Ship24'] as const)('clears the displayed %s provider after successful direct recovery', async (provider) => {
    vi.spyOn(scraper, 'universalPlan').mockReturnValue({
      sources: [provider], carrier: null, tier: () => 'unknown', rank: () => 0,
    });
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
    expect(saved.carrier_data.tracking_provider).toBe(provider);
    now = new Date('2026-09-10T13:00:00Z');
    await service.syncPackage({ ...parcel, ...saved });
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.tracking_provider).toBeUndefined();
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.active_tracking_carrier).toBe('dhl');
    expect(adapter.fetch).toHaveBeenCalledTimes(2);
    expect(adapter.fetchUniversal).toHaveBeenCalledTimes(1);
  });

  it('saves provider identity for an unknown parcel without claiming a direct answer', async () => {
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined) };
    const adapter = { fetch: vi.fn().mockRejectedValue(new Error('carrier blocked')),
      fetchUniversal: vi.fn().mockResolvedValue({ status: 'delivered', current_stage: 'delivered',
        discovered_carrier: 'dhl-express', reported_carriers: ['DHL Express'],
        events: [{ time: '2026-09-10T11:00:00Z', description: 'Delivered', stage: 'delivered' }] }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null,
      () => new Date('2026-09-10T12:00:00Z'));
    await service.syncPackage({ id: 'provider-identity', carrier: 'unknown', tracking_number: '1234567891', current_stage: 'pending' });
    const saved = client.updatePackage.mock.calls.at(-1)![1];
    expect(saved).toMatchObject({ carrier: 'dhl-express', current_stage: 'delivered', carrier_data: {
      tracking_provider: 'Ship24', routing: { configured_carrier: 'dhl-express', preferred_number: '1234567891' } } });
    expect(saved.carrier_data).not.toHaveProperty('carrier_answered');
    expect(saved.carrier_data.routing).not.toHaveProperty('confirmed_carrier');
    expect(saved.carrier_data).not.toHaveProperty('auto_changed_from');
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

  it('marks a correction to the carrier detection names, and no other', async () => {
    const report = vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const progress = { status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-10T11:00:00Z',
      events: [{ time: '2026-09-10T11:00:00Z', description: 'In transit', stage: 'in_transit' }] };
    const sync = async (trackingNumber: string) => {
      const client = { ...fakeClient(),
        acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
        finishTrackingProvider: vi.fn().mockResolvedValue(undefined) };
      const adapter = { fetch: vi.fn().mockResolvedValue(progress),
        fetchUniversal: vi.fn().mockResolvedValue({ ...progress, discovered_carrier: 'ups' }) };
      const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null,
        () => new Date('2026-09-10T12:00:00Z'));
      await service.syncPackage({ id: 'filed-unknown', carrier: 'unknown', tracking_number: trackingNumber, current_stage: 'pending' });
      expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ carrier: 'ups' });
      return adapter;
    };
    // Detection names UPS for the number: the parcel was filed before it could.
    expect((await sync('1Z999AA10123456784')).fetchUniversal).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('carrier_auto_swapped',
      { carrier: 'unknown', provider: 'ups', trackingNumber: '1Z999AA10123456784', category: 'detected', attemptId: expect.any(String) });
    expect(report).not.toHaveBeenCalledWith('carrier_mismatch_confirmed', expect.anything());
    // A provider had to name the carrier: detection has a rule to gain.
    expect((await sync('TEST1234')).fetchUniversal).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('carrier_auto_swapped',
      { carrier: 'unknown', provider: 'ups', trackingNumber: 'TEST1234', attemptId: expect.any(String) });
    expect(report).toHaveBeenCalledWith('carrier_mismatch_confirmed', expect.objectContaining({ provider: 'ups', trackingNumber: 'TEST1234' }));
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
    expect(saved.carrier_data.routing).toMatchObject({ preferred_provider: 'ParcelsApp', last_success_at: '2026-09-10T12:00:00.000Z' });
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

  it.each(['pending', 'in_transit'])('persists a missed-check streak for an hourly DPD parcel at %s', async (stage) => {
    const parcel: JsonObject = { id: 'hourly-dpd', carrier: 'dpd', tracking_number: '06080000000001',
      current_stage: stage, last_status_text: 'Saved tracking', sync_status: stage === 'pending' ? 'waiting' : 'ok',
      last_synced_at: '2026-09-10T10:00:00Z', carrier_data: { last_status_text: 'Saved tracking',
        routing: { version: 1, configured_carrier: 'dpd', last_success_at: '2026-09-10T10:00:00Z' } } };
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T11:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    client.updatePackage.mockImplementation(async (_id, values) => { Object.assign(parcel, values); });
    const adapter = { fetch: vi.fn().mockRejectedValue(new UpstreamHttpError('DPD', 503)),
      fetchUniversal: vi.fn().mockRejectedValue(new NotFoundError('Provider')) };
    let now = new Date('2026-09-10T11:00:00Z');
    const service = () => new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ waiting: 1, errors: 0 });
    expect(parcel).toMatchObject({ current_stage: stage, last_status_text: 'Saved tracking', sync_error: null,
      sync_status: stage === 'pending' ? 'waiting' : 'ok', carrier_data: { routing: { consecutive_failures: 1 } } });
    expect(client.insertEvents).not.toHaveBeenCalled();
    now = new Date('2026-09-10T12:00:00Z');
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ errors: 1 });
    expect(parcel).toMatchObject({ current_stage: stage, last_status_text: 'Saved tracking', sync_status: 'error',
      carrier_data: { routing: { consecutive_failures: 2, last_success_at: '2026-09-10T10:00:00Z' } } });
    now = new Date('2026-09-10T13:00:00Z');
    adapter.fetch.mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit',
      last_status_text: 'Recovered tracking', last_update: now.toISOString(), events: [] });
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ updated: 1, errors: 0 });
    expect(parcel).toMatchObject({ sync_status: 'ok', sync_error: null,
      carrier_data: { routing: { consecutive_failures: 0 } } });
  });

  it('breaks the failure streak when DPD answers that a label has no scans yet', async () => {
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T11:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = { fetch: vi.fn().mockRejectedValueOnce(new NotFoundError('DPD'))
      .mockRejectedValue(new UpstreamHttpError('DPD', 503)),
      fetchUniversal: vi.fn().mockRejectedValue(new NotFoundError('Provider')) };
    const parcel = { id: 'unscanned-dpd', carrier: 'dpd', tracking_number: '06080000000001', current_stage: 'pending',
      carrier_data: { routing: { version: 1, configured_carrier: 'dpd', consecutive_failures: 2 } } };
    let now = new Date('2026-09-10T11:00:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ waiting: 1, errors: 0 });
    const saved = client.updatePackage.mock.calls.at(-1)![1];
    expect(saved.carrier_data.routing).toMatchObject({ consecutive_failures: 0 });
    now = new Date('2026-09-10T17:00:00Z');
    await expect(service.syncPackage({ ...parcel, ...saved })).resolves.toMatchObject({ waiting: 1, errors: 0 });
    expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ sync_status: 'waiting', sync_error: null,
      carrier_data: { routing: { consecutive_failures: 1 } } });
  });

  it('keeps a moving parcel\'s stage when the newest scan is a delivery notice', async () => {
    // A notice filed as an announcement (synthetic wording and times): the
    // summary and the forecast are news, a step back to Announced is not.
    const notice = 'Your parcel will be delivered on Tuesday between 10:00 and 11:00';
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit', current_stage: 'registered',
      last_status_text: notice, last_update: '2026-09-10T08:00:00Z', expected_delivery: '2026-09-15',
      events: [
        { time: '2026-09-10T08:00:00Z', description: notice, stage: 'registered' },
        { time: '2026-09-09T18:00:00Z', description: 'Arrived at the delivery depot', stage: 'in_transit' },
      ] }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    const parcel = { id: 'notice', carrier: 'dpd', tracking_number: 'TEST1234', current_stage: 'out_for_delivery' };
    await service.syncPackage(parcel);
    expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ current_stage: 'out_for_delivery',
      last_status_text: notice, expected_delivery: '2026-09-15' });
    expect(client.completeSyncAttempt).toHaveBeenLastCalledWith(expect.any(String),
      expect.objectContaining({ anomaly_codes: ['early_stage_regression'] }), expect.any(Array));
    // A problem still moves the stage, and a parcel that has not moved yet takes its announcement.
    adapter.fetch.mockResolvedValue({ status: 'exception', current_stage: 'exception', last_status_text: 'Parcel damaged',
      last_update: '2026-09-10T09:00:00Z', events: [{ time: '2026-09-10T09:00:00Z', description: 'Parcel damaged', stage: 'exception' }] });
    await service.syncPackage({ ...parcel, current_stage: 'in_transit' });
    expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ current_stage: 'exception' });
    adapter.fetch.mockResolvedValue({ status: 'pending', current_stage: 'registered', last_status_text: 'Label created',
      last_update: '2026-09-10T10:00:00Z', events: [{ time: '2026-09-10T10:00:00Z', description: 'Label created', stage: 'registered' }] });
    await service.syncPackage({ ...parcel, current_stage: 'pending' });
    expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ current_stage: 'registered' });
    expect(client.completeSyncAttempt).toHaveBeenLastCalledWith(expect.any(String),
      expect.objectContaining({ anomaly_codes: [] }), expect.any(Array));
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

  it('checks a parcel without an owner without reconciling any account', async () => {
    const client = fakeClient();
    const notifier = { dispatch: vi.fn().mockResolvedValue({ sent: 0, failed: 0, expired: 0 }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, notifier as never);
    await expect(service.syncPackage({ id: 'one-off', user_id: null, one_off: true, carrier: 'swiss-post', tracking_number: 'TEST1234' }))
      .resolves.toMatchObject({ checked: 1, updated: 1, errors: 0 });
    expect(client.autoLinkPackages).not.toHaveBeenCalled();
    // The push queues join on the owner, so the shared dispatch has nothing to send for it.
    expect(notifier.dispatch).toHaveBeenCalledOnce();
  });

  it('sends the delivery emails after the notifications of every job, and counts them', async () => {
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    const notifier = { dispatch: vi.fn().mockResolvedValue({ sent: 2, failed: 0, expired: 1 }) };
    const emails = { dispatch: vi.fn().mockResolvedValue({ sent: 3, failed: 1, skipped: 4 }) };
    const service = new TrackingSyncService(fakeClient() as unknown as SupabaseServiceClient, adapter, notifier as never, undefined, emails as never);
    const controller = new AbortController();
    const parcel = { id: 'parcel', user_id: 'owner', carrier: 'swiss-post', tracking_number: 'TEST1234' };
    await expect(service.syncPackage(parcel, { trigger: 'package', signal: controller.signal })).resolves.toMatchObject({
      checked: 1, notifications_sent: 2, notification_errors: 0, subscriptions_expired: 1, emails_sent: 3, email_errors: 1,
    });
    expect(emails.dispatch).toHaveBeenCalledExactlyOnceWith(controller.signal);
    expect(emails.dispatch.mock.invocationCallOrder[0]).toBeGreaterThan(notifier.dispatch.mock.invocationCallOrder[0]!);
    await expect(service.sync()).resolves.toMatchObject({ emails_sent: 3, email_errors: 1 });
    expect(emails.dispatch).toHaveBeenCalledTimes(2);
  });

  it('sends the delivery emails on a deployment without push, and after a push dispatch that failed', async () => {
    const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    const emails = { dispatch: vi.fn().mockResolvedValue({ sent: 1, failed: 0, skipped: 0 }) };
    const parcel = { id: 'parcel', user_id: 'owner', carrier: 'swiss-post', tracking_number: 'TEST1234' };
    const withoutPush = new TrackingSyncService(fakeClient() as unknown as SupabaseServiceClient, adapter, null, undefined, emails as never);
    await expect(withoutPush.syncPackage(parcel)).resolves.toMatchObject({ notifications_sent: 0, emails_sent: 1, email_errors: 0 });
    expect(emails.dispatch).toHaveBeenCalledOnce();

    const notifier = { dispatch: vi.fn().mockRejectedValue(new Error('push queue unavailable')) };
    const afterFailure = new TrackingSyncService(fakeClient() as unknown as SupabaseServiceClient, adapter, notifier as never, undefined, emails as never);
    await expect(afterFailure.syncPackage(parcel)).resolves.toMatchObject({ notification_errors: 1, emails_sent: 1 });
    expect(emails.dispatch).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(Error), { component: 'push', operation: 'dispatch' });
    // Without mail settings there is no service, and the summary says nothing was sent.
    await expect(new TrackingSyncService(fakeClient() as unknown as SupabaseServiceClient, adapter, null).syncPackage(parcel))
      .resolves.toMatchObject({ emails_sent: 0, email_errors: 0 });
  });

  it('finishes the job when the delivery emails cannot be dispatched, and reports it', async () => {
    const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const client = fakeClient();
    const failure = new Error('claim function unavailable');
    const emails = { dispatch: vi.fn().mockRejectedValue(failure) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, null, undefined, emails as never);
    await expect(service.syncPackage({ id: 'parcel', user_id: 'owner', carrier: 'swiss-post', tracking_number: 'TEST1234' }))
      .resolves.toMatchObject({ checked: 1, updated: 1, errors: 0, emails_sent: 0, email_errors: 1 });
    expect(report).toHaveBeenCalledExactlyOnceWith(failure, { component: 'delivery-email', operation: 'dispatch' });
  });

  it('stops with the job when it is stopped while the delivery emails are sent', async () => {
    const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const controller = new AbortController();
    const emails = { dispatch: vi.fn().mockImplementation(async () => { controller.abort(); throw new Error('stopped'); }) };
    const service = new TrackingSyncService(fakeClient() as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, null, undefined, emails as never);
    await expect(service.syncPackage(
      { id: 'parcel', user_id: 'owner', carrier: 'swiss-post', tracking_number: 'TEST1234' },
      { trigger: 'package', signal: controller.signal },
    )).rejects.toThrow();
    expect(report).not.toHaveBeenCalled();
  });

  it('ends a check that shutdown cuts off as interrupted, without waiting for its carrier', async () => {
    const logged = vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => undefined);
    const client = fakeClient();
    const controller = new AbortController();
    // The carrier never answers and does not watch the signal.
    const adapter = { fetch: vi.fn(() => new Promise<never>(() => {})) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    const checking = service.syncPackage(
      { id: 'parcel', carrier: 'ctt', tracking_number: 'TEST1234', current_stage: 'in_transit' },
      { trigger: 'package', signal: controller.signal },
    );
    await vi.waitFor(() => expect(adapter.fetch).toHaveBeenCalledOnce());
    controller.abort(new WorkerShutdown());
    await expect(checking).rejects.toBeInstanceOf(WorkerShutdown);
    expect(client.completeSyncAttempt).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.objectContaining({
      outcome: 'interrupted', error_type: 'WorkerShutdown',
    }), expect.any(Array), { timeoutMs: 3_000 });
    expect(logged).toHaveBeenCalledWith('tracking_sync_completed', expect.objectContaining({
      carrier: 'ctt', outcome: 'interrupted', error_type: 'WorkerShutdown',
    }));
    expect(client.updatePackage).not.toHaveBeenCalledWith('parcel', expect.objectContaining({ sync_status: 'error' }));
  });

  it('lets a check whose lease is lost run to its end, without calling it interrupted', async () => {
    const client = fakeClient();
    const controller = new AbortController();
    let answer!: (value: CarrierResult) => void;
    const adapter = { fetch: vi.fn(() => new Promise<CarrierResult>(done => { answer = done; })) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null);
    let settled = false;
    const checking = service.syncPackage(
      { id: 'parcel', carrier: 'ctt', tracking_number: 'TEST1234', current_stage: 'in_transit' },
      { trigger: 'package', signal: controller.signal },
    ).finally(() => { settled = true; });
    await vi.waitFor(() => expect(adapter.fetch).toHaveBeenCalledOnce());
    controller.abort(new Error('lease lost'));
    await Promise.resolve();
    expect(settled).toBe(false);
    answer({ status: 'in_transit' });
    await checking.catch(() => undefined);
    expect(client.completeSyncAttempt).not.toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ outcome: 'interrupted' }), expect.anything(), expect.anything());
  });

  it('stops a scheduled run between checks at shutdown, letting the check in progress finish', async () => {
    const due = { carrier: 'ctt', current_stage: 'in_transit', tracking_number: 'TEST1234',
      last_synced_at: '2026-09-09T09:00:00Z', sync_status: 'ok', user_id: 'owner' };
    const client = fakeClient([{ ...due, id: 'first' }, { ...due, id: 'second' }]);
    const stopping = new AbortController();
    const adapter = { fetch: vi.fn(async (): Promise<CarrierResult> => {
      stopping.abort(new WorkerShutdown());
      return { status: 'in_transit' };
    }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null,
      () => new Date('2026-09-09T10:12:00Z'));
    await expect(service.sync({ trigger: 'scheduled', stopping: stopping.signal })).rejects.toBeInstanceOf(WorkerShutdown);
    expect(adapter.fetch).toHaveBeenCalledOnce();
    expect(client.completeSyncAttempt).toHaveBeenCalledOnce();
    expect(client.completeSyncAttempt.mock.calls[0][1]).not.toMatchObject({ outcome: 'interrupted' });
  });

  it('follows one-off parcels opened in the last 24 hours, after the accounts and ten at most', async () => {
    const due = { carrier: 'swiss-post', current_stage: 'in_transit', tracking_number: 'TEST1234',
      last_synced_at: '2026-09-09T09:00:00Z', sync_status: 'ok' };
    const owned = [
      { ...due, id: 'a1', user_id: 'a' },
      { ...due, id: 'b1', user_id: 'b' },
      { ...due, id: 'legacy', user_id: null },
    ];
    // In the order the database returns them: the least recently checked first.
    const oneOffs = [
      ...Array.from({ length: 6 }, (_, index) => ({ ...due, id: `one-off-${index + 1}`, user_id: null, one_off: true })),
      // Checked within the current ten-minute window: not due, and not counted against the ten.
      { ...due, id: 'one-off-fresh', user_id: null, one_off: true, last_synced_at: '2026-09-09T10:10:30Z' },
      ...Array.from({ length: 6 }, (_, index) => ({ ...due, id: `one-off-${index + 7}`, user_id: null, one_off: true })),
    ];
    const client = fakeClient(owned);
    client.listFollowedOneOffPackages.mockResolvedValue(oneOffs);
    const now = new Date('2026-09-09T10:12:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, null, () => now);
    await expect(service.sync()).resolves.toMatchObject({ checked: 13 });
    expect(client.listFollowedOneOffPackages).toHaveBeenCalledExactlyOnceWith(new Date('2026-09-08T10:12:00Z'));
    expect(client.startSyncAttempt.mock.calls.map(([, values]) => values.package_id)).toEqual([
      'a1', 'b1', 'legacy', ...Array.from({ length: 10 }, (_, index) => `one-off-${index + 1}`),
    ]);
    // The scheduled reconciliation is the account-wide one; it never names a parcel without an owner.
    expect(client.autoLinkPackages).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('asks once for the copies of a number in a run and keeps them on one route', async () => {
    const routing = (preferred: string) => ({ version: 1, configured_carrier: 'unknown', failures: {}, probe_cursor: 0, discovery_cursor: 0,
      preferred_provider: preferred, preferred_number: 'TEST1234', last_success_at: '2026-09-10T11:00:00Z', last_probe_at: '2026-09-10T11:00:00Z' });
    const parcel = (id: string, user: string, label: string, synced: string, preferred: string, extra: JsonObject = {}): JsonObject => ({
      id, user_id: user, label, carrier: 'unknown', tracking_number: 'TEST1234', current_stage: 'in_transit', created_at: '2026-09-10T08:00:00Z',
      last_synced_at: synced, sync_status: 'ok', carrier_data: { routing: routing(preferred) }, ...extra });
    const client = { ...fakeClient([
      parcel('first', 'a', 'Shoes', '2026-09-10T11:00:00Z', '17TRACK'),
      parcel('second', 'b', 'Gift', '2026-09-10T11:05:00Z', 'Ship24'),
      // The same number with a postcode is another lookup.
      parcel('third', 'c', 'Books', '2026-09-10T11:10:00Z', '17TRACK', { dpd_postcode: '0000' }),
    ]),
    acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
    finishTrackingProvider: vi.fn().mockResolvedValue(undefined) };
    const adapter = { fetch: vi.fn(), fetchUniversal: vi.fn().mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit',
      last_update: '2026-09-10T11:30:00Z', events: [{ time: '2026-09-10T11:30:00Z', description: 'In transit', stage: 'in_transit' }] }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await expect(service.sync()).resolves.toMatchObject({ checked: 3, updated: 3 });
    // Both copies follow the route of the one checked last; the copy with a postcode keeps its own.
    expect(adapter.fetchUniversal.mock.calls.map(([source, , , postcode]) => [source, postcode])).toEqual([['Ship24', null], ['17TRACK', '0000']]);
    expect(client.acquireTrackingProvider).toHaveBeenCalledTimes(2);
    const saved = (id: string) => client.updatePackage.mock.calls.filter(([packageId]) => packageId === id).at(-1)?.[1] as JsonObject;
    expect(saved('first')).toMatchObject({ carrier_data: { tracking_provider: 'Ship24', routing: { preferred_provider: 'Ship24' } } });
    expect(saved('second')).toMatchObject({ carrier_data: { tracking_provider: 'Ship24', routing: { preferred_provider: 'Ship24' } } });
    expect(saved('third')).toMatchObject({ carrier_data: { tracking_provider: '17TRACK', routing: { preferred_provider: '17TRACK' } } });
    // Each copy stores the scan for itself.
    expect(client.insertEvents.mock.calls.flatMap(([events]) => events.map((event: JsonObject) => event.package_id)))
      .toEqual(expect.arrayContaining(['first', 'second', 'third']));
    // The copy checked second records the answer it reused.
    const attempt = client.startSyncAttempt.mock.calls.find(([, values]) => values.package_id === 'second')?.[0];
    expect(client.completeSyncAttempt).toHaveBeenCalledWith(attempt, expect.anything(), expect.arrayContaining([
      expect.objectContaining({ step: 'fetch', status: 'succeeded', details: expect.objectContaining({ shared_answers: 1 }) })]));
  });

  it('gives the copies of a number one carrier answer, failures included', async () => {
    const parcel = (id: string, user: string | null, extra: JsonObject = {}): JsonObject => ({ id, user_id: user, carrier: 'swiss-post',
      tracking_number: 'TEST1234', current_stage: 'in_transit', created_at: '2026-09-10T08:00:00Z', last_synced_at: '2026-09-10T11:00:00Z',
      sync_status: 'ok', ...extra });
    const client = { ...fakeClient([parcel('owned', 'a'), parcel('kept', 'b')]),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined) };
    client.listFollowedOneOffPackages.mockResolvedValue([parcel('lookup', null, { one_off: true })]);
    const adapter = { fetch: vi.fn().mockRejectedValue(new UpstreamHttpError('Swiss Post', 502)),
      fetchUniversal: vi.fn().mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-10T11:30:00Z',
        events: [{ time: '2026-09-10T11:30:00Z', description: 'In transit', stage: 'in_transit' }] }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await expect(service.sync()).resolves.toMatchObject({ checked: 3, updated: 3 });
    // One outage seen once: every copy falls back to the same provider, asked once.
    expect(adapter.fetch).toHaveBeenCalledOnce();
    expect(adapter.fetchUniversal).toHaveBeenCalledOnce();
    for (const id of ['owned', 'kept', 'lookup']) {
      expect(client.updatePackage.mock.calls.filter(([packageId]) => packageId === id).at(-1)?.[1], id).toMatchObject({
        carrier_data: { tracking_provider: adapter.fetchUniversal.mock.calls[0][0],
          routing: { failures: { 'swiss-post': { kind: 'transport' } } } } });
    }
  });

  it('still checks the accounts when the one-off parcels cannot be listed', async () => {
    const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const client = fakeClient([{ id: 'a1', user_id: 'a', carrier: 'swiss-post', tracking_number: 'TEST1234' }]);
    const failure = new Error('function unavailable');
    client.listFollowedOneOffPackages.mockRejectedValue(failure);
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, null);
    await expect(service.sync()).resolves.toMatchObject({ checked: 1, updated: 1 });
    expect(report).toHaveBeenCalledExactlyOnceWith(failure, { component: 'tracking', operation: 'list_one_off_packages' });
  });

  it.each([
    { name: 'a watched parcel', unwatched: false, stage: 'in_transit', time: '10:10:00', checked: 2 },
    { name: 'an unwatched parcel', unwatched: true, stage: 'in_transit', time: '10:10:00', checked: 0 },
    { name: 'an unwatched parcel', unwatched: true, stage: 'in_transit', time: '10:59:59', checked: 0 },
    { name: 'an unwatched parcel', unwatched: true, stage: 'in_transit', time: '11:00:00', checked: 2 },
    { name: 'an unwatched parcel out for delivery', unwatched: true, stage: 'out_for_delivery', time: '10:02:00', checked: 0 },
  ])('checks $name at $time: $checked checks', async ({ unwatched, stage, time, checked }) => {
    const parcel = { carrier: 'swiss-post', current_stage: stage, tracking_number: 'TEST1234',
      last_synced_at: '2026-09-09T10:00:15Z', sync_status: 'ok' };
    const client = fakeClient([{ ...parcel, id: 'owned', user_id: 'a' }]);
    client.listFollowedOneOffPackages.mockResolvedValue([{ ...parcel, id: 'one-off', user_id: null, one_off: true }]);
    client.listUnwatchedPackageIds.mockResolvedValue(unwatched ? ['owned', 'one-off'] : ['another']);
    const now = new Date(`2026-09-09T${time}Z`);
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, null, () => now);
    await expect(service.sync()).resolves.toMatchObject({ checked });
    // Opened within the last hour is watched; a one-off parcel is still followed for 24 hours.
    expect(client.listUnwatchedPackageIds).toHaveBeenCalledExactlyOnceWith(new Date(now.getTime() - 3_600_000));
    expect(client.listFollowedOneOffPackages).toHaveBeenCalledExactlyOnceWith(new Date(now.getTime() - 86_400_000));
    // A manual refresh is never held back by it.
    if (!checked) await expect(service.syncPackage({ ...parcel, id: 'owned', user_id: 'a' })).resolves.toMatchObject({ checked: 1 });
  });

  it('keeps every parcel on the full cadence when the unwatched ones cannot be listed', async () => {
    const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const client = fakeClient([{ id: 'a1', user_id: 'a', carrier: 'swiss-post', current_stage: 'in_transit',
      tracking_number: 'TEST1234', last_synced_at: '2026-09-09T10:00:15Z', sync_status: 'ok' }]);
    const failure = new Error('function unavailable');
    client.listUnwatchedPackageIds.mockRejectedValue(failure);
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, null, () => new Date('2026-09-09T10:10:00Z'));
    await expect(service.sync()).resolves.toMatchObject({ checked: 1, unchanged: 1 });
    expect(report).toHaveBeenCalledExactlyOnceWith(failure, { component: 'tracking', operation: 'list_unwatched_packages' });
  });

  it('queues a check when a link is opened only if the schedule would check the parcel now', () => {
    const parcel = { carrier: 'swiss-post', current_stage: 'in_transit', tracking_number: 'TEST1234',
      last_synced_at: '2026-09-09T10:00:15Z', sync_status: 'ok', archived_at: null };
    const at = (time: string) => new Date(`2026-09-09T${time}Z`);
    expect(isOpenedParcelSyncDue(parcel, at('10:09:59'))).toBe(false);
    expect(isOpenedParcelSyncDue(parcel, at('10:10:00'))).toBe(true);
    expect(isOpenedParcelSyncDue({ ...parcel, last_synced_at: null }, at('10:00:20'))).toBe(true);
    // A manual refresh would be allowed here; polling a link is not one.
    expect(isTrackingSyncDue(parcel, at('10:09:59'))).toBe(true);
    // A delivered, returned or archived parcel is not followed any more.
    expect(isOpenedParcelSyncDue({ ...parcel, current_stage: 'delivered' }, at('12:00:00'))).toBe(false);
    expect(isOpenedParcelSyncDue({ ...parcel, current_stage: 'returned' }, at('12:00:00'))).toBe(false);
    expect(isOpenedParcelSyncDue({ ...parcel, archived_at: '2026-09-09T09:00:00Z' }, at('12:00:00'))).toBe(false);
    expect(isOpenedParcelSyncDue({ ...parcel, current_stage: 'delivered', last_status_text: 'TO_BE_DELIVERED' }, at('12:00:00'))).toBe(true);
    // Out for delivery, the carrier's own adapter answering: every 2 minutes.
    const delivering = { ...parcel, current_stage: 'out_for_delivery' };
    expect(isOpenedParcelSyncDue(delivering, at('10:01:59'))).toBe(false);
    expect(isOpenedParcelSyncDue(delivering, at('10:02:00'))).toBe(true);
    // A universal provider answering: reading a link does not make it more often.
    const relayed = { ...delivering, carrier_data: { tracking_provider: 'ParcelsApp' } };
    expect(isOpenedParcelSyncDue(relayed, at('10:02:00'))).toBe(false);
    expect(isOpenedParcelSyncDue(relayed, at('10:10:00'))).toBe(true);
    // Overnight it stays hourly.
    expect(isOpenedParcelSyncDue({ ...delivering, last_synced_at: '2026-09-09T20:00:15Z' }, at('20:02:00'))).toBe(false);
    // A provider's cooldown holds a link's reader back as it holds the schedule.
    expect(isOpenedParcelSyncDue({ ...parcel, carrier_data: { routing: { version: 1, configured_carrier: 'swiss-post', next_check_at: '2026-09-09T13:00:00Z' } } }, at('12:00:00'))).toBe(false);
  });

  it.each([
    // Out for delivery, the carrier's own adapter answering: every 2 minutes.
    { carrier: 'swiss-post', stage: 'out_for_delivery', time: '10:02:00', checked: 1 },
    { carrier: 'swiss-post', stage: 'out_for_delivery', time: '10:01:59', checked: 0 },
    // A universal provider answering: like any other stage.
    { carrier: 'swiss-post', provider: 'ParcelsApp', stage: 'out_for_delivery', time: '10:02:00', checked: 0 },
    { carrier: 'swiss-post', provider: 'ParcelsApp', stage: 'out_for_delivery', time: '10:09:59', checked: 0 },
    { carrier: 'swiss-post', provider: 'ParcelsApp', stage: 'out_for_delivery', time: '10:10:00', checked: 1 },
    // A carrier with a longer interval of its own keeps it.
    { carrier: 'spring-gds', stage: 'out_for_delivery', time: '10:02:00', checked: 0 },
    { carrier: 'spring-gds', stage: 'out_for_delivery', time: '10:10:00', checked: 0 },
    { carrier: 'spring-gds', stage: 'out_for_delivery', time: '10:30:00', checked: 1 },
    { carrier: 'swiss-post', stage: 'in_transit', time: '10:02:00', checked: 0 },
    { carrier: 'swiss-post', stage: 'in_transit', time: '10:10:00', checked: 1 },
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
  ])('schedules $carrier at $stage at $time (provider: $provider): $checked checks', async ({ carrier, provider, stage, time, checked }) => {
    const parcel = {
      id: 'scheduled', carrier, current_stage: stage, tracking_number: 'TEST1234',
      last_synced_at: '2026-09-09T10:00:15Z', sync_status: 'ok',
      ...(provider ? { carrier_data: { tracking_provider: provider } } : {}),
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
    // Registered or accepted, a parcel is checked hourly 12 hours after its newest event or after it was added.
    { name: 'registered without news for 14 hours', created: '2026-09-01T09:00:00Z', lastEvent: '2026-09-08T20:00:00Z', stage: 'registered', time: '10:10:00', checked: 0 },
    { name: 'registered without news for 14 hours', created: '2026-09-01T09:00:00Z', lastEvent: '2026-09-08T20:00:00Z', stage: 'registered', time: '11:00:00', checked: 1 },
    { name: 'accepted without news for 14 hours', created: '2026-09-01T09:00:00Z', lastEvent: '2026-09-08T20:00:00Z', stage: 'accepted', time: '10:10:00', checked: 0 },
    { name: 'accepted with news 11 hours ago', created: '2026-09-01T09:00:00Z', lastEvent: '2026-09-08T23:10:00Z', stage: 'accepted', time: '10:10:00', checked: 1 },
    { name: 'registered, added an hour ago with an older label', created: '2026-09-09T09:00:00Z', lastEvent: '2026-09-07T09:00:00Z', stage: 'registered', time: '10:10:00', checked: 1 },
    { name: 'in transit without news for 14 hours', created: '2026-09-01T09:00:00Z', lastEvent: '2026-09-08T20:00:00Z', stage: 'in_transit', time: '10:10:00', checked: 1 },
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

  it.each([
    { name: 'checked less than a day ago', at: '2026-09-09T09:59:59Z', checked: 0 },
    { name: 'checked a day ago', at: '2026-09-09T10:00:00Z', checked: 1 },
    { name: 'checked a day ago, overnight', last: '2026-09-08T22:00:15Z', at: '2026-09-09T22:00:00Z', checked: 1 },
    { name: 'never checked', last: null, at: '2026-09-09T10:00:00Z', checked: 1 },
    { name: 'without news for just under 30 days', lastEvent: '2026-08-10T10:00:01Z', at: '2026-09-09T10:00:00Z', checked: 1 },
    { name: 'without news for 30 days', lastEvent: '2026-08-10T10:00:00Z', at: '2026-09-09T10:00:00Z', checked: 0 },
    { name: 'without news for 30 days, never checked', lastEvent: '2026-08-01T08:00:00Z', last: null, at: '2026-09-09T10:00:00Z', checked: 0 },
    { name: 'added 29 days ago with older scans', created: '2026-08-11T08:00:00Z', lastEvent: '2026-07-01T08:00:00Z', at: '2026-09-09T10:00:00Z', checked: 1 },
    { name: 'in a provider\'s cooldown', nextCheck: '2026-09-09T12:00:00Z', at: '2026-09-09T10:00:00Z', checked: 0 },
  ])('checks an archived parcel $name at $at: $checked checks', async ({
    created = '2026-08-01T08:00:00Z', lastEvent = '2026-09-06T09:00:00Z', last = '2026-09-08T10:00:15Z', nextCheck, at, checked,
  }) => {
    // Put away while it waits at a pickup point, the parcel is checked daily for its collection.
    const parcel = {
      id: 'archived', user_id: 'a', carrier: 'swiss-post', current_stage: 'ready_for_pickup', tracking_number: 'TEST1234',
      created_at: created, archived_at: '2026-09-07T08:00:00Z', last_synced_at: last, sync_status: 'ok',
      carrier_data: { routing: { version: 1, configured_carrier: 'swiss-post', last_event_at: lastEvent,
        ...(nextCheck ? { next_check_at: nextCheck } : {}) } },
    };
    const client = fakeClient([parcel]);
    const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'ready_for_pickup' }) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date(at));
    await expect(service.sync()).resolves.toMatchObject({ checked });
    expect(adapter.fetch).toHaveBeenCalledTimes(checked);
    // A manual refresh is never held back by it.
    if (!checked && !nextCheck) await expect(service.syncPackage(parcel)).resolves.toMatchObject({ checked: 1 });
  });

  it('checks a parcel brought back from the archive at the regular cadence again', async () => {
    const parcel = { id: 'restored', user_id: 'a', carrier: 'swiss-post', current_stage: 'ready_for_pickup', tracking_number: 'TEST1234',
      created_at: '2026-09-01T08:00:00Z', last_synced_at: '2026-09-09T10:00:15Z', sync_status: 'ok',
      carrier_data: { routing: { version: 1, configured_carrier: 'swiss-post', last_event_at: '2026-09-08T09:00:00Z' } } };
    const checked = async (archived_at: string | null) => {
      const client = fakeClient([{ ...parcel, archived_at }]);
      const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
        { fetch: vi.fn().mockResolvedValue({ status: 'ready_for_pickup' }) }, null, () => new Date('2026-09-09T10:10:00Z'));
      return (await service.sync()).checked;
    };
    // Archived, it waits for tomorrow's check; on the list again, for the next ten minutes.
    await expect(checked('2026-09-09T09:00:00Z')).resolves.toBe(0);
    await expect(checked(null)).resolves.toBe(1);
  });

  it('checks an archived parcel at the regular cadence while someone it was shared with gets its alerts', async () => {
    const parcel = { id: 'shared', user_id: 'a', carrier: 'swiss-post', current_stage: 'ready_for_pickup', tracking_number: 'TEST1234',
      created_at: '2026-07-01T08:00:00Z', archived_at: '2026-09-09T09:00:00Z', last_synced_at: '2026-09-09T10:00:15Z', sync_status: 'ok',
      carrier_data: { routing: { version: 1, configured_carrier: 'swiss-post', last_event_at: '2026-07-02T09:00:00Z' } } };
    const checked = async (shared: () => Promise<Set<string>>) => {
      const client = fakeClient([parcel, { ...parcel, id: 'alone' }]);
      client.sharedAlertPackageIds.mockImplementation(shared);
      const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'ready_for_pickup' }) };
      const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-09T11:00:00Z'));
      const summary = await service.sync();
      expect(client.sharedAlertPackageIds).toHaveBeenCalledExactlyOnceWith(['shared', 'alone']);
      return summary.checked;
    };
    // Without news for two months, the archived parcel alone has left the schedule; the shared one has not.
    await expect(checked(async () => new Set(['shared']))).resolves.toBe(1);
    // When the alerts cannot be read, archived parcels keep their daily check.
    const capture = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    await expect(checked(async () => { throw new Error('down'); })).resolves.toBe(0);
    expect(capture).toHaveBeenCalledWith(expect.any(Error), { component: 'tracking', operation: 'list_shared_alert_packages' });
  });

  it('asks for shared alerts only when an archived parcel is among the candidates', async () => {
    const client = fakeClient([{ id: 'listed', user_id: 'a', carrier: 'swiss-post', current_stage: 'in_transit', tracking_number: 'TEST1234',
      created_at: '2026-09-09T08:00:00Z', archived_at: null, last_synced_at: null, sync_status: 'ok' }]);
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, null, () => new Date('2026-09-09T10:10:00Z'));
    await service.sync();
    expect(client.sharedAlertPackageIds).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'unseen, added two hours ago', created: '2026-09-09T08:30:00Z', last: '2026-09-09T10:00:15Z', at: '2026-09-09T10:10:00Z', checked: 0 },
    { name: 'unseen, added two hours ago', created: '2026-09-09T08:30:00Z', last: '2026-09-09T10:00:15Z', at: '2026-09-09T11:00:00Z', checked: 1 },
    { name: 'unseen, added a day ago', created: '2026-09-08T10:00:00Z', last: '2026-09-09T06:00:15Z', at: '2026-09-09T11:00:00Z', checked: 0 },
    { name: 'unseen, added a day ago', created: '2026-09-08T10:00:00Z', last: '2026-09-09T06:00:15Z', at: '2026-09-09T12:00:00Z', checked: 1 },
    { name: 'unseen, added three days ago', created: '2026-09-06T09:00:00Z', last: '2026-09-08T12:00:15Z', at: '2026-09-09T11:00:00Z', checked: 0 },
    { name: 'unseen, added three days ago', created: '2026-09-06T09:00:00Z', last: '2026-09-08T12:00:15Z', at: '2026-09-09T12:00:00Z', checked: 1 },
    { name: 'a provider answered', created: '2026-09-06T09:00:00Z', last: '2026-09-09T10:00:15Z', at: '2026-09-09T10:10:00Z', checked: 1,
      routing: { last_success_at: '2026-09-09T09:00:00Z', last_event_at: '2026-09-09T09:00:00Z' } },
    { name: 'a carrier needs input', created: '2026-09-06T09:00:00Z', last: '2026-09-09T10:00:15Z', at: '2026-09-09T11:00:00Z', checked: 1,
      routing: { input_needed: { carrier: 'gls-de', field: 'postcode' } } },
  ])('schedules an unknown number ($name) at $at: $checked checks', async ({ created, last, at, checked, routing }) => {
    const parcel = { id: 'unseen', user_id: 'a', carrier: 'unknown', current_stage: 'pending', tracking_number: 'TEST1234',
      created_at: created, last_synced_at: last, sync_status: 'waiting',
      carrier_data: { routing: { version: 1, configured_carrier: 'unknown', failures: {}, ...routing } } };
    const client = fakeClient([parcel]);
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, null, () => new Date(at));
    await expect(service.sync()).resolves.toMatchObject({ checked });
    // A manual refresh is never held back by it.
    if (!checked) await expect(service.syncPackage(parcel)).resolves.toMatchObject({ checked: 1 });
  });

  it('stops scheduling a one-off lookup nobody has seen after six hours, until its link is opened', async () => {
    const unseen = { carrier: 'unknown', current_stage: 'pending', tracking_number: 'TEST1234', user_id: null, one_off: true,
      created_at: '2026-09-09T05:30:00Z', last_synced_at: '2026-09-09T10:00:15Z', sync_status: 'waiting', archived_at: null,
      carrier_data: { routing: { version: 1, configured_carrier: 'unknown', failures: {} } } };
    const check = async (parcels: JsonObject[], at: string) => {
      const client = fakeClient();
      client.listFollowedOneOffPackages.mockResolvedValue(parcels);
      const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
        { fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) }, null, () => new Date(at));
      return (await service.sync()).checked;
    };
    // Hourly while young, then off the schedule.
    await expect(check([{ ...unseen, id: 'young' }], '2026-09-09T11:00:00Z')).resolves.toBe(1);
    await expect(check([{ ...unseen, id: 'old' }], '2026-09-09T11:30:00Z')).resolves.toBe(0);
    // A number a provider has answered for keeps the schedule.
    const seen = { ...unseen, id: 'seen', carrier_data: { routing: { version: 1, configured_carrier: 'unknown', failures: {},
      last_success_at: '2026-09-09T10:00:15Z' } } };
    await expect(check([seen], '2026-09-09T11:30:00Z')).resolves.toBe(1);
    // Opening the link still queues a check every six hours, then daily.
    expect(isOpenedParcelSyncDue(unseen, new Date('2026-09-09T11:30:00Z'))).toBe(false);
    expect(isOpenedParcelSyncDue(unseen, new Date('2026-09-09T16:00:00Z'))).toBe(true);
    const twoDays = { ...unseen, created_at: '2026-09-07T05:30:00Z' };
    expect(isOpenedParcelSyncDue(twoDays, new Date('2026-09-09T16:00:00Z'))).toBe(false);
    expect(isOpenedParcelSyncDue(twoDays, new Date('2026-09-10T10:00:00Z'))).toBe(true);
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
    // Swiss Post's window is on Zurich's clock: 15:00–17:00 opens at 13:00 UTC. Until 30 minutes
    // before, the regular cadence still catches a changed slot.
    { name: 'hours before its window', window: '2026-09-09 15:00–17:00', last: '10:00:15', time: '10:02:00', checked: 0 },
    { name: 'hours before its window', window: '2026-09-09 15:00–17:00', last: '10:00:15', time: '10:10:00', checked: 1 },
    { name: 'just over 30 minutes before its window', window: '2026-09-09 15:00–17:00', last: '12:20:15', time: '12:28:00', checked: 0 },
    { name: '30 minutes before its window', window: '2026-09-09 15:00–17:00', last: '12:30:15', time: '12:32:00', checked: 1 },
    { name: 'inside its window', window: '2026-09-09 15:00–17:00', last: '13:30:15', time: '13:32:00', checked: 1 },
    { name: 'after its window, late', window: '2026-09-09 15:00–17:00', last: '15:30:15', time: '15:32:00', checked: 1 },
    { name: 'before a window on a later day', window: '2026-09-10 09:00–11:00', last: '10:00:15', time: '10:02:00', checked: 0 },
    { name: 'after a window on an earlier day', window: '2026-09-08 09:00–11:00', last: '10:00:15', time: '10:02:00', checked: 1 },
    // A single time has no opening to wait for.
    { name: 'with a time but no window', window: '2026-09-09 17:00', last: '10:00:15', time: '10:02:00', checked: 1 },
    // Evri's window is on London's clock, from the catalog: 13:00–15:00 opens at 12:00 UTC, not 11:00.
    { name: 'before a window on London time', carrier: 'evri-uk', window: '2026-09-09 13:00–15:00', last: '11:20:15', time: '11:22:00', checked: 0 },
    { name: '30 minutes before a window on London time', carrier: 'evri-uk', window: '2026-09-09 13:00–15:00', last: '11:30:15', time: '11:32:00', checked: 1 },
    // The zone the carrier's answer declares comes before its catalog's.
    { name: 'before a window on the clock the answer declares', carrier: 'paack', timezone: 'Europe/Lisbon', window: '2026-09-09 13:00–15:00', last: '11:20:15', time: '11:22:00', checked: 0 },
    // A whole-day slot on the Canary Islands' clock opens at 08:00 UTC.
    { name: 'before a whole-day window', carrier: 'paack', timezone: 'Atlantic/Canary', window: '2026-09-09 09:00–22:00', last: '07:20:15', time: '07:22:00', checked: 0 },
    { name: '30 minutes before a whole-day window', carrier: 'paack', timezone: 'Atlantic/Canary', window: '2026-09-09 09:00–22:00', last: '07:30:15', time: '07:32:00', checked: 1 },
    // UTC stands for no known zone: the window cannot be placed, so it is not waited for.
    { name: 'before a window on an unknown clock', timezone: 'UTC', window: '2026-09-09 15:00–17:00', last: '10:00:15', time: '10:02:00', checked: 1 },
  ])('checks a parcel out for delivery $name at $time: $checked checks', async ({ carrier = 'swiss-post', timezone, window, last, time, checked }) => {
    const parcel = {
      id: 'window', carrier, current_stage: 'out_for_delivery', tracking_number: 'TEST1234', expected_delivery: window,
      last_synced_at: `2026-09-09T${last}Z`, sync_status: 'ok',
      carrier_data: { ...(timezone ? { timezone } : {}), routing: { version: 1, configured_carrier: carrier, last_event_at: '2026-09-09T06:00:00Z' } },
    };
    const client = fakeClient([parcel]);
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient,
      { fetch: vi.fn().mockResolvedValue({ status: 'out_for_delivery' }) }, null, () => new Date(`2026-09-09T${time}Z`));
    await expect(service.sync()).resolves.toMatchObject({ checked });
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

  it('hands a Cainiao result to its reported local number through normalization', async () => {
    const origin = carrierResult('cainiao-delivered');
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
    const swiss = vi.fn().mockResolvedValue({ status: 'delivered', current_stage: 'delivered',
      last_update: '2026-03-04T12:00:00Z', events: [{ time: '2026-03-04T12:00:00Z', description: 'Delivered', stage: 'delivered' }] });
    const registry = new AdapterRegistry({ factories: {
      aliexpress: () => ({ id: 'aliexpress', steps: ['direct'], track: vi.fn().mockResolvedValue(origin) }),
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
    expect(registry.for('aliexpress')!.track).toHaveBeenCalledOnce();
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
    const origin = carrierResult(country === 'Switzerland' ? 'cainiao-Switzerland' : 'cainiao-Finland');
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
      'spring-gds': REGISTRY.factories['spring-gds'],
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
      const origin = carrierResult(state === 'terminal_conflict' ? 'postnl-Delivered' : 'postnl-Departed');
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
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ checked: 1, unchanged: 1 });
    now = new Date('2026-09-09T10:10:00Z');
    await expect(service.sync()).resolves.toMatchObject({ checked: 0 });
    now = new Date('2026-09-09T10:30:00Z');
    await expect(service.sync()).resolves.toMatchObject({ checked: 1, unchanged: 1 });
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
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ checked: 1, unchanged: 1 });
    now = new Date('2026-09-09T14:59:59Z');
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ checked: 0 });
    now = new Date('2026-09-09T15:00:00Z');
    await expect(service().syncPackage(parcel)).resolves.toMatchObject({ checked: 1, unchanged: 1 });
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

  // What a provider that only knows the label answers: one scan, no progress.
  const withoutProgress = { status: 'pending', last_status_text: 'Pending', last_update: '2026-09-10T11:30:00Z',
    events: [{ stage: 'pending', description: 'Pending', time: '2026-09-10T11:30:00Z' }] };
  // The same from a provider that names no stage, in wording no rule maps: read alone, the scan is movement.
  const unreadLabel = { ...withoutProgress, last_status_text: 'Noted at the fixture desk',
    events: [{ description: 'Noted at the fixture desk', time: '2026-09-10T11:30:00Z' }] };
  const leasedClient = () => ({ ...fakeClient(),
    acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
    finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
  });

  const unavailable = () => vi.fn().mockRejectedValue(new IndeterminateError('DPD', 'DPD is unavailable', { status: 503 }));
  it.each([
    ['answers with nothing', 'knows less', () => vi.fn().mockResolvedValue({ status: 'unknown', events: [] }), 'not_found', withoutProgress, '2026-09-10T10:00:00.000Z'],
    ['is unavailable', 'knows less', unavailable, 'transport', withoutProgress, undefined],
    ['is unavailable', 'names no stage in wording no rule maps', unavailable, 'transport', unreadLabel, '2026-09-10T10:00:00.000Z'],
  ] as const)('keeps what is saved without an error when the carrier %s and a fallback %s', async (_carrier, _fallback, fetch, kind, answer, watermark) => {
    const capture = vi.spyOn(observability, 'captureSyncAnomaly').mockReturnValue(null);
    const client = leasedClient();
    const adapter = { fetch: fetch(), fetchUniversal: vi.fn().mockResolvedValue(answer) };
    const parcel = {
      id: 'thin-fallback', carrier: 'dpd', tracking_number: '06080000000002', current_stage: 'registered',
      last_status_text: 'Order created',
      carrier_data: { status: 'pending', current_stage: 'registered', routing: { version: 1, configured_carrier: 'dpd',
        confirmed_carrier: 'dpd', confirmed_number: '06080000000002', failures: {}, probe_cursor: 0, discovery_cursor: 0,
        ...(watermark ? { last_event_at: watermark } : {}) } },
    };
    let now = new Date('2026-09-10T12:00:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    await expect(service.syncPackage(parcel, { trigger: 'scheduled' })).resolves.toMatchObject({ waiting: 1, updated: 0, errors: 0 });
    expect(adapter.fetchUniversal).toHaveBeenCalledOnce();
    const provider = adapter.fetchUniversal.mock.calls[0][0];
    // Only the routing state is saved: the summary, its source and the timeline stay.
    const saved = client.updatePackage.mock.calls.at(-1)![1];
    expect(saved).toEqual({
      last_synced_at: '2026-09-10T12:00:00.000Z', sync_status: 'ok', sync_error: null,
      carrier_data: { status: 'pending', current_stage: 'registered', routing: expect.objectContaining({
        preferred_provider: provider, last_success_at: '2026-09-10T12:00:00.000Z', failures: { dpd: expect.objectContaining({ kind }) },
      }) },
    });
    expect(saved.carrier_data.routing.last_event_at).toBe(watermark);
    expect(client.insertEvents).not.toHaveBeenCalled();
    expect(client.deleteEventsByDescriptions).not.toHaveBeenCalled();
    expect(client.completeSyncAttempt).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ outcome: 'waiting', anomaly_codes: ['fallback_without_progress'] }),
      expect.arrayContaining([expect.objectContaining({ step: 'complete', details: expect.objectContaining({
        support_lookup_number: '06080000000002', support_direct_progress: false,
      }) })]));
    expect(client.recordTrackingHealth).toHaveBeenLastCalledWith(expect.any(String), 'thin-fallback',
      expect.arrayContaining([expect.objectContaining({ kind: 'refresh', healthy: true })]));
    expect(capture).not.toHaveBeenCalled();
    // The scan that was kept out is no freshness watermark: the carrier's next reply, a scan before it, is not older.
    adapter.fetch.mockResolvedValue({ status: 'in_transit', last_status_text: 'In transit', last_update: '2026-09-10T11:00:00Z',
      events: [{ stage: 'in_transit', description: 'In transit', time: '2026-09-10T11:00:00Z' }] });
    now = new Date('2026-09-10T14:00:00Z');
    await expect(service.syncPackage({ ...parcel, ...saved }, { trigger: 'scheduled' })).resolves.toMatchObject({ updated: 1 });
    expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ current_stage: 'in_transit', last_status_text: 'In transit' });
  });

  it.each([
    ['the provider a saved summary came from', false],
    ['another provider, for a carrier without an adapter of its own,', true],
  ] as const)('reports two consecutive thin checks from %s and resets on recovery', async (_label, another) => {
    const capture = vi.spyOn(observability, 'captureSyncAnomaly').mockReturnValue(null);
    const client = leasedClient();
    const adapter = { fetch: vi.fn(), fetchUniversal: vi.fn().mockResolvedValueOnce({ status: 'in_transit',
      current_stage: 'in_transit', last_status_text: 'In transit', last_update: '2026-09-10T11:00:00Z', events: [] }) };
    const parcel = { id: 'no-carrier-to-ask', carrier: 'unknown', tracking_number: 'TEST1234', current_stage: 'pending' };
    let now = new Date('2026-09-10T12:00:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ updated: 1 });
    const saved = client.updatePackage.mock.calls.at(-1)![1];
    const source = saved.carrier_data.tracking_provider;
    // In the second case that provider fails, and the next one answers.
    adapter.fetchUniversal.mockImplementation(async (provider: string) => {
      if (another && provider === source) throw new IndeterminateError(provider, `${provider} is unavailable`, { status: 503 });
      return withoutProgress;
    });
    now = new Date('2026-09-10T13:00:00Z');
    await expect(service.syncPackage({ ...parcel, ...saved })).resolves.toMatchObject({ errors: 0, waiting: 1 });
    expect(adapter.fetchUniversal.mock.calls.map(([provider]) => provider)).toEqual([source, source, 'Ship24', '17TRACK']);
    const firstThin = client.updatePackage.mock.calls.at(-1)![1];
    expect(firstThin).toMatchObject({ sync_status: 'ok', sync_error: null, carrier_data: {
      tracking_provider: source, routing: { preferred_provider: source, consecutive_failures: 1,
        last_success_at: '2026-09-10T12:00:00.000Z',
        last_event_at: '2026-09-10T11:00:00.000Z' },
    } });
    expect(firstThin.current_stage).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
    now = new Date('2026-09-10T14:00:00Z');
    await expect(service.syncPackage({ ...parcel, ...saved, ...firstThin })).resolves.toMatchObject({ errors: 1, waiting: 0 });
    expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ sync_status: 'error',
      sync_error: 'The carrier temporarily returned no tracking progress. Previous tracking details have been kept.',
      carrier_data: { tracking_provider: source, routing: { preferred_provider: source, consecutive_failures: 2,
        last_success_at: '2026-09-10T12:00:00.000Z',
        last_event_at: '2026-09-10T11:00:00.000Z' } },
    });
    const secondThin = client.updatePackage.mock.calls.at(-1)![1];
    expect(secondThin.current_stage).toBeUndefined();
    expect(client.completeSyncAttempt).toHaveBeenLastCalledWith(expect.any(String),
      expect.objectContaining({ outcome: 'error', anomaly_codes: ['progress_disappeared'] }), expect.any(Array));
    expect(capture).toHaveBeenCalledExactlyOnceWith('progress_disappeared', expect.objectContaining({ carrier: 'unknown' }));
    adapter.fetchUniversal.mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit', last_status_text: 'In transit',
      last_update: '2026-09-10T11:00:00Z', events: [] });
    now = new Date('2026-09-10T15:00:00Z');
    await expect(service.syncPackage({ ...parcel, ...saved, ...secondThin })).resolves.toMatchObject({ updated: 1, errors: 0 });
    const recovered = client.updatePackage.mock.calls.at(-1)![1];
    expect(recovered).toMatchObject({ sync_status: 'ok', sync_error: null });
    expect(recovered.carrier_data.routing.consecutive_failures).toBe(0);
    adapter.fetchUniversal.mockResolvedValue(withoutProgress);
    now = new Date('2026-09-10T16:00:00Z');
    await expect(service.syncPackage({ ...parcel, ...saved, ...recovered })).resolves.toMatchObject({ waiting: 1, errors: 0 });
    expect(client.updatePackage.mock.calls.at(-1)![1].carrier_data.routing.consecutive_failures).toBe(1);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('keeps the overnight freshness window while thin answers accumulate missed checks', async () => {
    const capture = vi.spyOn(observability, 'captureSyncAnomaly').mockReturnValue(null);
    const client = leasedClient();
    const adapter = { fetch: vi.fn(), fetchUniversal: vi.fn().mockResolvedValue(withoutProgress) };
    const parcel = { id: 'overnight-thin', carrier: 'unknown', tracking_number: 'TEST1234', current_stage: 'in_transit',
      carrier_data: { tracking_provider: 'Ship24', routing: { version: 1, configured_carrier: 'unknown',
        preferred_provider: 'Ship24', consecutive_failures: 1, last_success_at: '2026-09-10T21:00:00Z' } } };
    let now = new Date('2026-09-10T23:00:00Z');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => now);
    await expect(service.syncPackage(parcel)).resolves.toMatchObject({ waiting: 1, errors: 0 });
    const saved = client.updatePackage.mock.calls.at(-1)![1];
    expect(saved).toMatchObject({ sync_status: 'ok', sync_error: null, carrier_data: { routing: {
      consecutive_failures: 2, last_success_at: '2026-09-10T21:00:00Z',
    } } });
    expect(capture).not.toHaveBeenCalled();
    now = new Date('2026-09-11T00:00:00Z');
    await expect(service.syncPackage({ ...parcel, ...saved })).resolves.toMatchObject({ waiting: 0, errors: 1 });
    expect(client.updatePackage.mock.calls.at(-1)![1]).toMatchObject({ sync_status: 'error', carrier_data: { routing: {
      consecutive_failures: 3, last_success_at: '2026-09-10T21:00:00Z',
    } } });
    expect(capture).toHaveBeenCalledExactlyOnceWith('progress_disappeared', expect.objectContaining({ carrier: 'unknown' }));
  });

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
      support_context: expect.objectContaining({
        tracking_number: '06080000000002', reasons: ['ambiguous_shape'],
      }),
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
        expect.objectContaining({ step: 'complete', status: 'succeeded', details: expect.objectContaining({
          support_lookup_number: '06080000000002', support_provider: null, support_direct_progress: true,
        }) }),
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
      .resolves.toMatchObject({ waiting: 1, errors: 0 });
  });

  it('records no health sample for a scheduled check that contacted no provider', async () => {
    const client = fakeClient();
    const adapter = { fetch: vi.fn(), fetchUniversal: vi.fn() };
    const cooling = Object.fromEntries(['dhl', 'Ship24', 'ParcelsApp', '17TRACK']
      .map((provider) => [provider, { count: 1, kind: 'transport', retry_at: '2026-09-10T13:00:00.000Z' }]));
    const parcel = { id: 'cooling', carrier: 'dhl', tracking_number: 'TEST1234', current_stage: 'pending',
      carrier_data: { routing: { version: 1, configured_carrier: 'dhl', failures: cooling,
        consecutive_failures: 2, probe_cursor: 0, discovery_cursor: 0 } } };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await expect(service.syncPackage(parcel, { trigger: 'scheduled' })).resolves.toMatchObject({ errors: 1 });
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(adapter.fetchUniversal).not.toHaveBeenCalled();
    expect(client.completeSyncAttempt).toHaveBeenCalled();
    expect(client.recordTrackingHealth).not.toHaveBeenCalled();
  });

  it.each([0, 1])('records why every provider failed with a previous streak of %s', async (streak) => {
    const client = { ...fakeClient(),
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = { fetch: vi.fn().mockRejectedValue(new UpstreamHttpError('DHL', 502)),
      fetchUniversal: vi.fn().mockRejectedValue(new Error('provider down')) };
    const parcel = { id: 'stale', carrier: 'dhl', tracking_number: 'TEST1234', current_stage: 'in_transit',
      carrier_data: { routing: { version: 1, configured_carrier: 'dhl', consecutive_failures: streak } } };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, () => new Date('2026-09-10T12:00:00Z'));
    await expect(service.syncPackage(parcel, { trigger: 'scheduled' }))
      .resolves.toMatchObject({ errors: streak, waiting: 1 - streak });
    expect(client.completeSyncAttempt).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outcome: streak ? 'error' : 'waiting', error_type: 'RoutingDeferredError' }),
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
      fetch: vi.fn().mockRejectedValue(Object.assign(new NotFoundError('Colis Privé'), { name: 'ColisPriveTrackingError' })),
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
    const adapter = new CarrierTrackingAdapter();
    const fetch = vi.spyOn(adapter.registry.for('amazon-shipping')!, 'track').mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit' });
    const universal = vi.spyOn(adapter, 'fetchUniversal');
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter);
    await service.syncPackage({ id: 'shipping-parcel', carrier: 'amazon-shipping', tracking_number: 'FR0000000001' });
    expect(fetch.mock.calls[0][0]).toMatchObject({ number: 'FR0000000001' });
    expect(universal).not.toHaveBeenCalled();
  });

  it('forwards the stored delivery postcode to universal providers', async () => {
    const universal = { fetchSource: vi.fn().mockResolvedValue({ status: 'in_transit' }), fetch: vi.fn().mockResolvedValue({ status: 'in_transit' }) };
    const recorder: StepRecorder = { step: () => undefined, lookup: () => undefined };
    const registry = new AdapterRegistry({ factories: {}, carriers: { unknown: 'universal' } },
      { trawl: null, browserExecutablePath: null, recorder, env: {} } satisfies AdapterEnvironment);
    const adapter = new CarrierTrackingAdapter(universal as unknown as UniversalTracker, registry, recorder);
    await expect(adapter.fetch('unknown', 'TEST1234', null, '8000')).resolves.toMatchObject({ status: 'in_transit' });
    expect(universal.fetch).toHaveBeenCalledWith('TEST1234', '8000', expect.any(Object));
    await adapter.fetchUniversal('Ship24', 'TEST1234', 1000, '8000');
    expect(universal.fetchSource).toHaveBeenCalledWith('Ship24', 'TEST1234', 1000, '8000', null);
    await adapter.fetchUniversal('Ship24', 'TEST1234', 1000, null, 'Europe/Zurich');
    expect(universal.fetchSource).toHaveBeenLastCalledWith('Ship24', 'TEST1234', 1000, null, 'Europe/Zurich');
  });

  it('keeps expired Shipping history out of the timeline and Sentry', async () => {
    const client = fakeClient();
    const fetch = vi.fn().mockRejectedValue(new CarrierError('not_found', 'Amazon Shipping', 'Amazon Shipping history expired', { reason: 'history_expired' }));
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

  it('never lets an earlier stage up to accepted replace a later one', () => {
    for (const previous of ['in_transit', 'customs', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup']) {
      for (const selected of ['pending', 'registered', 'accepted']) expect(stageToSave(previous, selected)).toBe(previous);
      expect(stageToSave(previous, 'exception')).toBe('exception');
      expect(stageToSave(previous, 'returned')).toBe('returned');
    }
    expect(stageToSave('accepted', 'registered')).toBe('accepted');
    expect(stageToSave('registered', 'pending')).toBe('registered');
    expect(stageToSave('registered', 'accepted')).toBe('accepted');
    expect(stageToSave('out_for_delivery', 'in_transit')).toBe('in_transit');
    // After a problem or a return, a new label starts over.
    expect(stageToSave('exception', 'registered')).toBe('registered');
    expect(stageToSave('returned', 'registered')).toBe('registered');
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

  it('tells a fallback that knows less from a source that contradicts the saved summary', () => {
    const scan = { time: '2026-08-31T09:00:00Z', description: 'Pending', stage: 'pending' };
    const detect = (carrier: string, carrierData: JsonObject, result: CarrierResult, source: string) => detectSyncAnomalies(
      { carrier, current_stage: 'registered', carrier_data: carrierData }, result, [], source, 'pending', new Date('2026-08-31T12:00:00Z'),
    );
    const fallback: CarrierResult = { tracking_provider: 'ParcelsApp', status: 'pending', events: [scan] };
    // The summary came from the carrier: a provider that knows less is only a fallback.
    expect(detect('dpd', {}, fallback, 'unknown')).toEqual(['fallback_without_progress']);
    expect(detect('dpd', { tracking_provider: 'Ship24' }, fallback, 'unknown')).toEqual(['fallback_without_progress']);
    // The provider the summary came from, and the carrier's own adapter, take their progress back.
    expect(detect('dpd', { tracking_provider: 'ParcelsApp' }, fallback, 'unknown')).toEqual(['progress_disappeared']);
    expect(detect('dpd', { tracking_provider: 'ParcelsApp' }, { status: 'pending', events: [scan] }, 'dpd')).toEqual(['progress_disappeared']);
    // No adapter of its own: routing exhausts the eligible providers before returning a thin answer.
    expect(detect('unknown', { tracking_provider: 'Ship24' }, fallback, 'unknown')).toEqual(['progress_disappeared']);
    expect(detect('an-post', { tracking_provider: 'Ship24' }, fallback, 'unknown')).toEqual(['progress_disappeared']);
    expect(detect('royal-mail', { tracking_provider: 'Ship24' }, fallback, 'unknown')).toEqual(['fallback_without_progress']);
  });
  it('preserves real movement when a provider has only registration, without flagging a new label', () => {
    const label: CarrierResult = { status: 'pending', current_stage: 'registered', tracking_provider: 'Ship24',
      events: [{ time: '2026-08-31T09:00:00Z', description: 'Information received', stage: 'registered' }] };
    const detect = (stage: string) => detectSyncAnomalies({ carrier: 'unknown', current_stage: stage }, label,
      [], 'unknown', 'registered', new Date('2026-08-31T12:00:00Z'));
    expect(detect('in_transit')).toEqual(['progress_disappeared']);
    expect(detect('pending')).toEqual([]);
    expect(detect('registered')).toEqual([]);
  });
});

/**
 * tracking_events with the RPC's upsert: a stored identity updates its row in
 * place, keeping the row id (and so created_at and push receipts). Postgres
 * refuses one batch that carries an identity twice, and so does this.
 */
function eventStore() {
  const rows = new Map<string, JsonObject>();
  let created = 0;
  const client = fakeClient();
  client.applyTrackingSync.mockImplementation(async (
    parcel: JsonObject, values: JsonObject, events: JsonObject[] = [], descriptions: string[] = [],
  ) => {
    const ids = events.map((event) => String(event.provider_event_id));
    if (new Set(ids).size !== ids.length) throw new Error('ON CONFLICT DO UPDATE command cannot affect row a second time');
    for (const event of events) {
      const id = String(event.provider_event_id);
      rows.set(id, { ...event, id: rows.get(id)?.id ?? `row-${++created}` });
    }
    for (const [id, row] of rows) if (descriptions.includes(String(row.description))) rows.delete(id);
    await client.updatePackage(parcel.id, values);
    return true;
  });
  return {
    client,
    rows,
    /** What the sync loaders embed: each stored identity, its instant spelled as PostgREST returns it, its stage and wording. */
    identities: () => [...rows.values()].map((row) => ({
      provider_event_id: row.provider_event_id,
      occurred_at: new Date(String(row.occurred_at)).toISOString().replace('.000Z', '+00:00'),
      stage: row.stage,
      description: row.description,
      location: row.location,
      time: (row.raw_data as JsonObject | undefined)?.time,
      provider_code: (row.raw_data as JsonObject | undefined)?.provider_code,
      observed_without_provider_timestamp: (row.raw_data as JsonObject | undefined)?.observed_without_provider_timestamp,
    })),
    batch: () => (client.applyTrackingSync.mock.calls.at(-1)?.[2] ?? []) as JsonObject[],
  };
}

it('fills in a UPS scan location without creating another notification event', async () => {
  const store = eventStore();
  const at = '2026-07-11T18:05:00Z';
  const result = (location: string) => ({ status: 'accepted', current_stage: 'accepted', last_update: at,
    last_status_text: 'Package collected', events: [{ time: at, stage: 'accepted', description: 'Package collected', location }] });
  const adapter = { fetch: vi.fn().mockResolvedValueOnce(result('')).mockResolvedValue(result('Example City, France')) };
  const service = new TrackingSyncService(store.client as unknown as SupabaseServiceClient, adapter, null,
    () => new Date('2026-07-12T12:00:00Z'));
  const load = () => ({ id: 'ups-parcel', user_id: 'owner', carrier: 'ups', tracking_number: '1Z0000000000000000',
    current_stage: 'accepted', [STORED_EVENT_IDENTITIES]: store.identities() });
  await service.syncPackage(load());
  const original = [...store.rows.values()][0]!;
  await service.syncPackage(load());
  await service.syncPackage(load());
  expect(store.rows.size).toBe(1);
  expect([...store.rows.values()][0]).toMatchObject({ id: original.id, provider_event_id: original.provider_event_id,
    location: 'Example City, France' });
});

it('rewrites a scan in place when a take-over left its row under an older identity', async () => {
  const store = eventStore();
  const at = '2026-07-11T18:05:00Z';
  const sorted = { time: at, stage: 'in_transit', description: 'Sorted', location: 'Example City' };
  const adapter = { fetch: vi.fn().mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit', last_update: at,
    last_status_text: 'Sorted', events: [sorted] }) };
  const service = new TrackingSyncService(store.client as unknown as SupabaseServiceClient, adapter, null,
    () => new Date('2026-07-12T12:00:00Z'));
  store.rows.set('dhl:taken-over', { id: 'row-0', package_id: 'restated-parcel', provider_event_id: 'dhl:taken-over',
    occurred_at: at, stage: 'in_transit', description: 'Sorted', location: 'Example City', raw_data: { time: at } });
  const load = () => ({ id: 'restated-parcel', user_id: 'owner', carrier: 'dhl', tracking_number: 'TEST1234',
    current_stage: 'in_transit', [STORED_EVENT_IDENTITIES]: store.identities() });
  await expect(service.syncPackage(load())).resolves.toMatchObject({ updated: 0, unchanged: 1 });
  await service.syncPackage(load());
  expect([...store.rows.values()].map(({ id, provider_event_id }) => ({ id, provider_event_id })))
    .toEqual([{ id: 'row-0', provider_event_id: 'dhl:taken-over' }]);
});

it('tells a check that stored a scan from one that rewrote the scans it had', async () => {
  const store = eventStore();
  const scan = (time: string, description: string, location = '') => ({ time, stage: 'in_transit', description, location });
  const result = (...events: ReturnType<typeof scan>[]) => ({ status: 'in_transit', current_stage: 'in_transit',
    last_update: events.at(-1)!.time, last_status_text: events.at(-1)!.description, events });
  const sorted = scan('2026-07-11T18:05:00Z', 'Sorted');
  const adapter = { fetch: vi.fn()
    .mockResolvedValueOnce(result(sorted))
    .mockResolvedValueOnce(result({ ...sorted, location: 'Example City' }))
    .mockResolvedValue(result({ ...sorted, location: 'Example City' }, scan('2026-07-12T08:00:00Z', 'Departed'))) };
  const service = new TrackingSyncService(store.client as unknown as SupabaseServiceClient, adapter, null,
    () => new Date('2026-07-12T12:00:00Z'));
  const load = () => ({ id: 'news-parcel', user_id: 'owner', carrier: 'ups', tracking_number: '1Z0000000000000001',
    current_stage: store.rows.size ? 'in_transit' : 'pending', [STORED_EVENT_IDENTITIES]: store.identities() });
  const completion = () => store.client.completeSyncAttempt.mock.calls.at(-1)![1] as JsonObject;
  const persisted = () => (store.client.completeSyncAttempt.mock.calls.at(-1)![2] as JsonObject[])
    .find((step) => step.step === 'persist_events')!.details;

  await expect(service.syncPackage(load())).resolves.toMatchObject({ updated: 1, unchanged: 0 });
  expect(completion()).toMatchObject({ outcome: 'updated', events_new: 1 });
  // The location fills in on the stored row: nothing to tell.
  await expect(service.syncPackage(load())).resolves.toMatchObject({ updated: 0, unchanged: 1 });
  expect(completion()).toMatchObject({ outcome: 'unchanged', events_new: 0 });
  expect(persisted()).toMatchObject({ events_persisted: 1, events_new: 0 });
  await expect(service.syncPackage(load())).resolves.toMatchObject({ updated: 1, unchanged: 0 });
  expect(completion()).toMatchObject({ outcome: 'updated', events_new: 1 });
  expect(persisted()).toMatchObject({ events_persisted: 2, events_new: 1 });
  expect(store.rows.size).toBe(2);
});

it('enriches a saved flight in place instead of storing a second event for notifications', async () => {
  const store = eventStore();
  const at = '2026-07-11T20:05:00+02:00';
  const flight = { time: at, stage: 'in_transit', provider_code: 'AircraftTakeOff' };
  const result = (description: string, location: string) => ({ status: 'in_transit', current_stage: 'in_transit',
    last_update: at, last_status_text: description, events: [{ ...flight, description, location }] });
  const rich = 'Flight ZZ0101 departed: Frankfurt Airport (FRA) → Paris Charles de Gaulle Airport (CDG)';
  const adapter = { fetch: vi.fn().mockResolvedValueOnce(result('UPLIFT', 'Office - FRA 000000'))
    .mockResolvedValue(result(rich, 'Frankfurt Airport (FRA), Germany')) };
  const service = new TrackingSyncService(store.client as unknown as SupabaseServiceClient, adapter, null,
    () => new Date('2026-07-12T12:00:00Z'));
  const load = () => ({ id: 'flight-parcel', user_id: 'owner', carrier: 'india-post', tracking_number: 'JN067614884IN',
    current_stage: 'in_transit', [STORED_EVENT_IDENTITIES]: store.identities() });
  await service.syncPackage(load());
  const original = [...store.rows.values()][0]!;
  await service.syncPackage(load());
  await service.syncPackage(load());
  expect(store.rows.size).toBe(1);
  expect([...store.rows.values()][0]).toMatchObject({ id: original.id, provider_event_id: original.provider_event_id,
    description: rich, location: 'Frankfurt Airport (FRA), Germany', occurred_at: '2026-07-11T18:05:00Z' });
});

it('enriches coded India Post scans sharing a clock without creating notification events', async () => {
  const store = eventStore();
  const at = '2026-07-11T18:05:00Z';
  const result = (location: string) => ({ status: 'in_transit', current_stage: 'in_transit', last_update: at,
    last_status_text: 'Item received', events: [
      { time: at, stage: 'in_transit', description: 'Arrived at sorting centre', provider_code: 'MailArrived', location },
      { time: at, stage: 'in_transit', description: 'Item received', provider_code: 'ItemReceived', location },
    ] });
  const adapter = { fetch: vi.fn().mockResolvedValueOnce(result('Example Office 000000'))
    .mockResolvedValue(result('Example Office 000001')) };
  const service = new TrackingSyncService(store.client as unknown as SupabaseServiceClient, adapter, null,
    () => new Date('2026-07-12T12:00:00Z'));
  const load = () => ({ id: 'coded-parcel', user_id: 'owner', carrier: 'india-post', tracking_number: 'JN067614884IN',
    current_stage: 'in_transit', [STORED_EVENT_IDENTITIES]: store.identities() });
  await service.syncPackage(load());
  const originals = [...store.rows.values()].map(({ id, provider_event_id }) => ({ id, provider_event_id }));
  await service.syncPackage(load());
  await service.syncPackage(load());
  expect(store.rows.size).toBe(2);
  expect([...store.rows.values()].map(({ id, provider_event_id }) => ({ id, provider_event_id }))).toEqual(originals);
  expect([...store.rows.values()].map((row) => row.location)).toEqual(['Example Office 000001', 'Example Office 000001']);
});

describe('India Post scans abroad', () => {
  // La Poste's 07:50 in Paris, first relayed as India's 07:50 (02:20 UTC).
  const NUMBER = 'JN067614884IN';
  const transfer = { time: '2026-07-10T08:15:00Z', stage: 'in_transit', description: 'Transferred to Office of Exchange',
    provider_code: 'ItemTransfered', location: 'EXAMPLE FOREIGN POST OFFICE 999001' };
  const india = (time: string, description: string, destination?: string): CarrierResult => ({
    status: 'in_transit', current_stage: 'in_transit', last_update: time, last_status_text: description, timezone: 'Asia/Kolkata',
    ...(destination ? { destination_country: destination } : {}),
    events: [{ time, stage: 'in_transit', description, provider_code: 'ItemReceived', location: 'EXAMPLE EXCHANGE OFFICE 999001' }, transfer],
  });
  const labelled = () => india('2026-07-14T02:20:00Z', 'Item Received');
  const abroad = (destination?: string) => india('2026-07-14T07:50:00+02:00', 'Item received at office of exchange (Inb)', destination);
  const load = (store: ReturnType<typeof eventStore>, changes: JsonObject = {}) => ({ id: 'abroad-parcel', user_id: 'owner',
    carrier: 'india-post', tracking_number: NUMBER, current_stage: 'in_transit', ...changes, [STORED_EVENT_IDENTITIES]: store.identities() });
  const rows = (store: ReturnType<typeof eventStore>) => [...store.rows.values()]
    .map(({ id, provider_event_id, occurred_at }) => ({ id, provider_event_id, occurred_at }));

  it('moves a stored scan to its own clock in place, and keeps one row when a reply reads it as labelled again', async () => {
    const store = eventStore();
    const adapter = { fetch: vi.fn().mockResolvedValueOnce(labelled()).mockResolvedValueOnce(abroad()).mockResolvedValue(labelled()) };
    const service = new TrackingSyncService(store.client as unknown as SupabaseServiceClient, adapter, null,
      () => new Date('2026-07-15T12:00:00Z'));
    await service.syncPackage(load(store));
    const [received, transferred] = rows(store);
    await service.syncPackage(load(store));
    expect(rows(store)).toEqual([{ ...received, occurred_at: eventTimestamp('2026-07-14T07:50:00+02:00', 'UTC') }, transferred]);
    expect(store.batch().map((event) => event.provider_event_id)).toEqual([received!.provider_event_id, transferred!.provider_event_id]);
    await service.syncPackage(load(store));
    expect(rows(store)).toEqual([received, transferred]);
  });

  it('moves the stored scan in place in the sync that hands the item to La Poste', async () => {
    const store = eventStore();
    const delivery: CarrierResult = { status: 'in_transit', current_stage: 'in_transit', last_update: '2026-07-14T08:30:00+02:00',
      last_status_text: 'Votre colis est en transit.', events: [{ time: '2026-07-14T08:30:00+02:00', stage: 'in_transit',
        description: 'Votre colis est en transit.', location: 'Example Hub' }] };
    let origin = labelled();
    const adapter = { fetch: vi.fn(async (carrier: string) => carrier === 'la-poste' ? delivery : origin) };
    const service = new TrackingSyncService(store.client as unknown as SupabaseServiceClient, adapter, null,
      () => new Date('2026-07-15T12:00:00Z'));
    await service.syncPackage(load(store));
    const [received, transferred] = rows(store);
    origin = abroad('FR');
    await service.syncPackage(load(store, { carrier_data: store.client.updatePackage.mock.calls.at(-1)![1].carrier_data }));
    expect(adapter.fetch.mock.calls.map((call) => call[0])).toEqual(['india-post', 'india-post', 'la-poste']);
    expect(store.client.updatePackage.mock.calls.at(-1)![1].carrier_data).toMatchObject({
      active_tracking_carrier: 'la-poste', active_tracking_number: NUMBER, original_carrier: 'india-post' });
    expect(rows(store).slice(0, 2)).toEqual([
      { ...received, occurred_at: eventTimestamp('2026-07-14T07:50:00+02:00', 'UTC') }, transferred]);
    expect(rows(store)).toHaveLength(3);
  });
});

describe('reworded DPD scans', () => {
  // The fixtures' synthetic number: a DPD reply must name the parcel asked for.
  const NUMBER = '06080000000001';
  const unverified = () => carrierResult('dpd-unverified');
  const verified = () => carrierResult('dpd-delivered');
  const now = () => new Date('2026-07-16T12:00:00Z');
  const parcel = { id: 'dpd-postcode-later', user_id: 'owner', carrier: 'dpd', tracking_number: NUMBER };
  const ids = (events: JsonObject[]) => events.map((event) => String(event.provider_event_id));

  it('updates the stored scans in place when the postcode is added later', async () => {
    const store = eventStore();
    const adapter = { fetch: vi.fn().mockResolvedValueOnce(unverified()).mockResolvedValue(verified()) };
    const service = new TrackingSyncService(store.client as unknown as SupabaseServiceClient, adapter, null, now);
    const load = (changes: JsonObject) => ({ ...parcel, ...changes, [STORED_EVENT_IDENTITIES]: store.identities() });

    await service.syncPackage(load({ current_stage: 'pending', dpd_postcode: null }));
    const unverifiedIds = ids(store.batch());
    expect(unverifiedIds).toHaveLength(4);
    const rowIds = unverifiedIds.map((id) => store.rows.get(id)?.id);
    // A proof-of-delivery row stored before the parser dropped that scan.
    const proof = {
      package_id: parcel.id, provider_event_id: providerEventId('dpd', '2026-07-16T10:41:30+02:00', '', 'We received the proof of delivery'),
      occurred_at: '2026-07-16T08:41:30Z', description: 'We received the proof of delivery', id: 'row-proof',
    };
    store.rows.set(proof.provider_event_id, proof);

    await service.syncPackage(load({ current_stage: 'delivered', dpd_postcode: '8000' }));
    const customs = providerEventId('dpd', '2026-07-15T16:30:00+02:00', '', 'Your parcel cleared customs successfully');
    // Newest first: DEY, DLO, DLI and ORI keep the identities of their unverified twins.
    expect(ids(store.batch())).toEqual([...unverifiedIds, customs]);
    expect(store.client.applyTrackingSync.mock.calls.at(-1)?.[3]).toEqual([]);
    expect(store.rows.size).toBe(6);
    expect(unverifiedIds.map((id) => store.rows.get(id)?.id)).toEqual(rowIds);
    expect(store.rows.get(unverifiedIds[0]!)).toMatchObject({
      description: 'Your parcel has been delivered successfully', location: 'Urdorf, CH', stage: 'delivered',
    });
    expect(store.rows.get(proof.provider_event_id)).toEqual(proof);
    // The depot-arrival wording is still DPD's to review, sampled from the row it updated.
    expect(store.client.recordTrackingStatusObservations.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ carrier: 'dpd', provider_code: 'ORI', provider_event_id: unverifiedIds[3] }),
    ]);

    // The next verified reply finds the reused identities again.
    await service.syncPackage(load({ current_stage: 'delivered', dpd_postcode: '8000' }));
    expect(ids(store.batch())).toEqual([...unverifiedIds, customs]);
    expect(store.rows.size).toBe(6);
    expect(store.client.recordTrackingStatusObservations.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ provider_event_id: unverifiedIds[3] }),
    ]);
  });

  it('shares one row per scan with a universal copy, whichever source answered last', async () => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const store = eventStore();
    const client = { ...store.client,
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-07-16T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const universalCopy: CarrierResult = {
      status: 'delivered', current_stage: 'delivered', last_status_text: 'Delivered to recipient',
      last_update: '2026-07-16T08:12:00Z',
      events: [
        { time: '2026-07-16T08:12:00Z', location: 'Urdorf', description: 'Delivered to recipient', stage: 'delivered' },
        { time: '2026-07-16T04:10:45Z', location: 'Urdorf', description: 'With delivery courier', stage: 'out_for_delivery' },
        { time: '2026-07-16T01:48:00Z', location: 'Urdorf', description: 'Arrived at delivery facility', stage: 'in_transit' },
        { time: '2026-07-15T16:05:12Z', location: 'Urdorf', description: 'Arrived at facility', stage: 'in_transit' },
      ],
    };
    const down = new Error('DPD guest API unavailable');
    const adapter = {
      fetch: vi.fn()
        .mockRejectedValueOnce(down)
        .mockResolvedValueOnce(unverified())
        .mockRejectedValueOnce(down)
        .mockResolvedValueOnce(verified())
        .mockRejectedValueOnce(down),
      fetchUniversal: vi.fn().mockResolvedValue(universalCopy),
    };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, now);
    // Each check starts from a fresh snapshot, so the router asks DPD first every time.
    const sync = async (dpdPostcode: string | null) => {
      await service.syncPackage({ ...parcel, current_stage: store.rows.size ? 'delivered' : 'pending',
        dpd_postcode: dpdPostcode, [STORED_EVENT_IDENTITIES]: store.identities() });
      return ids(store.batch());
    };

    const universalIds = await sync(null);
    expect(universalIds).toHaveLength(4);
    expect(universalIds.every((id) => id.startsWith('unknown:'))).toBe(true);
    const rowIds = universalIds.map((id) => store.rows.get(id)?.id);

    // DPD takes over the universal rows at the same instants.
    expect(await sync(null)).toEqual(universalIds);
    expect(store.rows.get(universalIds[0]!)).toMatchObject({ description: 'Delivered', location: null });
    // The universal copy finds its own identities stored and takes the rows back.
    expect(await sync(null)).toEqual(universalIds);
    expect(store.rows.get(universalIds[0]!)).toMatchObject({ description: 'Delivered to recipient', location: 'Urdorf' });
    // The verified reply takes them over again; only its customs scan is new.
    const verifiedIds = await sync('8000');
    expect(verifiedIds.slice(0, 4)).toEqual(universalIds);
    expect(verifiedIds[4]).toBe(providerEventId('dpd', '2026-07-15T16:30:00+02:00', '', 'Your parcel cleared customs successfully'));
    expect(await sync('8000')).toEqual(universalIds);

    expect(adapter.fetchUniversal).toHaveBeenCalledTimes(3);
    expect(store.rows.size).toBe(5);
    expect(universalIds.map((id) => store.rows.get(id)?.id)).toEqual(rowIds);
  });
});

describe('scans a carrier and a universal provider both report', () => {
  type Scan = { time: string; description: string; stage: string; location?: string };
  const now = () => new Date('2026-01-05T12:00:00Z');
  const parcel = { id: 'gofo-fallback', user_id: 'owner', carrier: 'gofo', tracking_number: 'GFUS00000000000001' };
  const ids = (events: JsonObject[]) => events.map((event) => String(event.provider_event_id));
  // GOFO's own lookup gives Eastern scans their real offset.
  const label: Scan = { time: '2026-01-02T04:30:00-08:00', description: 'Shipping Label Created', stage: 'registered' };
  const hub: Scan = { time: '2026-01-03T08:15:42-05:00', location: 'Hub City, EX', description: 'Arrived at GOFO Regional Hub', stage: 'in_transit' };
  const out: Scan = { time: '2026-01-04T07:59:03-05:00', location: 'Station City, EX', description: 'Out for Delivery', stage: 'out_for_delivery' };
  const delivered: Scan = { time: '2026-01-04T16:58:30-05:00', location: 'Example City, EX', description: 'Delivered', stage: 'delivered' };
  const result = (scans: Scan[]): CarrierResult => ({
    status: scans[0]!.stage as CarrierResult['status'], current_stage: scans[0]!.stage,
    last_status_text: scans[0]!.description, last_update: scans[0]!.time, events: scans,
  });
  // A universal copy keeps the local clock with a Pacific offset and no place: Eastern scans read three hours late.
  const copied = (scan: Scan): Scan => ({ time: scan.time.replace('-05:00', '-08:00'), description: scan.description, stage: scan.stage });
  const own = (scan: Scan) => providerEventId('gofo', scan.time, scan.location ?? '', scan.description);
  const copy = (scan: Scan) => providerEventId('unknown', copied(scan).time, '', scan.description);

  it('stores each scan once and keeps the carrier clock across a fallback', async () => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const store = eventStore();
    const client = { ...store.client,
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-01-05T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const down = new Error('GOFO tracking endpoint is unavailable');
    const adapter = {
      fetch: vi.fn()
        .mockResolvedValueOnce(result([hub, label]))
        .mockRejectedValueOnce(down)
        .mockResolvedValueOnce(result([delivered, out, hub, label]))
        .mockRejectedValueOnce(down),
      fetchUniversal: vi.fn()
        .mockResolvedValueOnce(result([out, hub, label].map(copied)))
        .mockResolvedValueOnce(result([delivered, out, hub, label].map(copied))),
    };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, now);
    // Each check starts from a fresh snapshot, so the router asks GOFO first every time.
    const sync = async (stage: string) => {
      await service.syncPackage({ ...parcel, current_stage: stage, [STORED_EVENT_IDENTITIES]: store.identities() });
      return ids(store.batch());
    };

    expect(await sync('pending')).toEqual([own(hub), own(label)]);
    // GOFO is down: the copy adds only the scan GOFO has not reported yet.
    expect(await sync('in_transit')).toEqual([copy(out)]);
    const copiedRow = store.rows.get(copy(out))!.id;
    // GOFO is back: its scan takes that row over and sets its clock and place.
    expect(await sync('out_for_delivery')).toEqual([own(delivered), copy(out), own(hub), own(label)]);
    expect(store.rows.get(copy(out))).toMatchObject({ id: copiedRow, occurred_at: '2026-01-04T12:59:03Z', location: 'Station City, EX' });
    // Down again: the copy stores and moves nothing.
    expect(await sync('delivered')).toEqual([]);
    expect(store.rows.size).toBe(4);
    expect(store.rows.get(copy(out))).toMatchObject({ id: copiedRow, occurred_at: '2026-01-04T12:59:03Z' });
    expect(store.rows.get(own(delivered))).toMatchObject({ occurred_at: '2026-01-04T21:58:30Z' });
    expect(adapter.fetchUniversal).toHaveBeenCalledTimes(2);
  });

  it('stores once a scan a provider words its own way on a clock two hours early, and records the offset', async () => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const store = eventStore();
    const client = { ...store.client,
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-01-05T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const down = new Error('GOFO tracking endpoint is unavailable');
    // The copy of the hub scan: other wording, unclassified, and two hours before GOFO's 13:15:42 UTC.
    const reworded: Scan = { time: '2026-01-03T11:15:42Z', description: 'Item at sorting facility', stage: 'pending' };
    const adapter = {
      fetch: vi.fn()
        .mockRejectedValueOnce(down)
        .mockResolvedValueOnce(result([hub, label]))
        .mockRejectedValueOnce(down),
      fetchUniversal: vi.fn().mockResolvedValue(result([reworded])),
    };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, now);
    const sync = async (stage: string) => {
      await service.syncPackage({ ...parcel, current_stage: stage, [STORED_EVENT_IDENTITIES]: store.identities() });
      const values = client.completeSyncAttempt.mock.calls.at(-1)![1] as JsonObject;
      return { batch: ids(store.batch()), anomalies: values.anomaly_codes };
    };
    const copyId = providerEventId('unknown', reworded.time, '', reworded.description);

    // GOFO is down: the copy is stored as it came.
    expect(await sync('pending')).toEqual({ batch: [copyId], anomalies: [] });
    const copyRow = store.rows.get(copyId)!.id;
    // GOFO is back: its scan takes the copy's row over, on GOFO's clock and in its words.
    expect(await sync('pending')).toEqual({ batch: [copyId, own(label)], anomalies: ['provider_clock_offset'] });
    expect(store.rows.get(copyId)).toMatchObject({ id: copyRow, occurred_at: '2026-01-03T13:15:42Z', stage: 'in_transit',
      description: hub.description });
    // Down again: the copy stores nothing and still shows the offset.
    expect(await sync('in_transit')).toEqual({ batch: [], anomalies: expect.arrayContaining(['provider_clock_offset']) });
    expect(store.rows.size).toBe(2);
  });

  it('does not take the carrier reply after a fallback for older history', async () => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const store = eventStore();
    const client = { ...store.client,
      acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-01-05T12:01:30Z' }),
      finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
    };
    const down = new Error('GOFO tracking endpoint is unavailable');
    const adapter = {
      fetch: vi.fn()
        .mockResolvedValueOnce(result([hub, label]))
        .mockRejectedValueOnce(down)
        .mockResolvedValueOnce(result([out, hub, label]))
        .mockRejectedValueOnce(down),
      fetchUniversal: vi.fn().mockResolvedValue(result([out, hub, label].map(copied))),
    };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter, null, now);
    // Each check sees the watermark the previous one saved, without its cooldowns.
    let watermark: unknown;
    const sync = async (stage: string) => {
      await service.syncPackage({ ...parcel, current_stage: stage,
        ...(watermark ? { carrier_data: { routing: { version: 1, configured_carrier: 'gofo', last_event_at: watermark } } } : {}),
        [STORED_EVENT_IDENTITIES]: store.identities() });
      const values = store.client.updatePackage.mock.calls.at(-1)![1] as JsonObject;
      watermark = ((values.carrier_data as JsonObject).routing as JsonObject).last_event_at;
      return values;
    };

    await sync('pending');
    // GOFO is down: the copy's new scan, three hours late, sets the watermark.
    expect((await sync('in_transit')).carrier_data).toMatchObject({ tracking_provider: expect.any(String) });
    expect(watermark).toBe('2026-01-04T15:59:03.000Z');
    // GOFO is back with that scan at its real time: its summary and link replace the copy's.
    const recovered = await sync('out_for_delivery');
    expect(recovered).toMatchObject({ last_status_text: 'Out for Delivery', current_stage: 'out_for_delivery' });
    expect(recovered.carrier_data).not.toHaveProperty('tracking_provider');
    expect(watermark).toBe('2026-01-04T12:59:03.000Z');
    // Down again: copies of stored scans no longer move the watermark past GOFO's clock.
    await sync('out_for_delivery');
    expect(watermark).toBe('2026-01-04T12:59:03.000Z');
    expect(store.rows.size).toBe(3);
  });
});

describe('the pickup point a parcel was collected from', () => {
  const POINT = 'Example Kiosk\nExample Street 1, 9999 Sampleville';
  const OTHER = 'Example Locker\nSample Road 2, 9999 Sampleville';
  const NUMBER = 'CW123456785FR';
  const scan = (time: string, stage: string, description: string = stage) => ({ time, stage, description });
  const arrived = scan('2026-10-02T08:00:00Z', 'in_transit', 'Arrived at the local depot');
  const waiting = scan('2026-10-02T14:00:00Z', 'ready_for_pickup', 'Ready for pickup');
  const reminder = scan('2026-10-03T09:00:00Z', 'pending', 'We reminded the recipient by email');
  const collected = scan('2026-10-04T16:00:00Z', 'delivered', 'Delivered');
  const answer = (stage: string, events: ReturnType<typeof scan>[], extra: JsonObject = {}): CarrierResult => ({
    status: stage === 'delivered' ? 'delivered' : 'in_transit', current_stage: stage, last_update: events.at(-1)!.time,
    last_status_text: events.at(-1)!.description, events, ...extra,
  });

  /** Checks the parcel once per answer, each check from what the one before saved, with its stored scans. */
  async function follow(parcel: JsonObject, ...answers: CarrierResult[]) {
    const store = eventStore();
    const adapter = { fetch: vi.fn() };
    for (const next of answers) adapter.fetch.mockResolvedValueOnce(next);
    const service = new TrackingSyncService(store.client as unknown as SupabaseServiceClient, adapter, null,
      () => new Date('2026-10-05T12:00:00Z'));
    let saved: JsonObject = { user_id: 'owner', tracking_number: NUMBER, current_stage: 'in_transit', ...parcel };
    const checks: JsonObject[] = [];
    for (let check = 0; check < answers.length && adapter.fetch.mock.calls.length < answers.length; check += 1) {
      await service.syncPackage({ ...saved, [STORED_EVENT_IDENTITIES]: store.identities() });
      saved = { ...saved, ...store.client.updatePackage.mock.calls.at(-1)![1] as JsonObject };
      checks.push(saved);
    }
    const point = (index: number) => (checks.at(index)!.carrier_data as JsonObject).pickup_point;
    return { checks, point, adapter };
  }

  it('keeps the point once the carrier stops naming it, through notices and later checks', async () => {
    const { checks, point } = await follow({ id: 'collected', carrier: 'la-poste' },
      answer('ready_for_pickup', [arrived, waiting], { pickup_point: POINT }),
      // The delivered answer only has its last scan: the stored ones tell where it waited.
      answer('delivered', [reminder, collected]),
      answer('delivered', [arrived, waiting, reminder, collected], { pickup_point: '' }));
    expect(checks.map((check) => check.current_stage)).toEqual(['ready_for_pickup', 'delivered', 'delivered']);
    expect([point(0), point(1), point(2)]).toEqual([POINT, POINT, POINT]);
  });

  it('keeps it by the saved stage when no scan says the parcel moved', async () => {
    const { point } = await follow({ id: 'undated', carrier: 'la-poste', current_stage: 'ready_for_pickup',
      carrier_data: { pickup_point: POINT } }, { status: 'delivered', current_stage: 'delivered', last_status_text: 'Delivered' });
    expect(point(-1)).toBe(POINT);
  });

  it('drops it for a parcel taken back out for delivery after it waited, or returned', async () => {
    const out = scan('2026-10-04T07:00:00Z', 'out_for_delivery', 'Out for delivery');
    const door = await follow({ id: 'door', carrier: 'la-poste' },
      answer('ready_for_pickup', [arrived, waiting], { pickup_point: POINT }),
      answer('delivered', [arrived, waiting, out, collected]));
    expect(door.checks.at(-1)!.current_stage).toBe('delivered');
    expect(door.point(-1)).toBeUndefined();

    const back = await follow({ id: 'returned', carrier: 'la-poste' },
      answer('ready_for_pickup', [arrived, waiting], { pickup_point: POINT }),
      answer('returned', [arrived, waiting, scan('2026-10-12T09:00:00Z', 'returned', 'Returned to the sender')]));
    expect(back.checks.at(-1)!.current_stage).toBe('returned');
    expect(back.point(-1)).toBeUndefined();
  });

  it('takes a point the carrier names later instead', async () => {
    const moved = scan('2026-10-03T10:00:00Z', 'ready_for_pickup', 'Moved to another pickup point');
    const { point } = await follow({ id: 'moved', carrier: 'la-poste' },
      answer('ready_for_pickup', [arrived, waiting], { pickup_point: POINT }),
      answer('ready_for_pickup', [arrived, waiting, moved], { pickup_point: OTHER }),
      answer('delivered', [arrived, waiting, moved, collected]),
      answer('delivered', [arrived, waiting, moved, collected], { pickup_point: POINT }));
    expect([point(1), point(2), point(3)]).toEqual([OTHER, OTHER, POINT]);
  });

  it('keeps a delivery partner’s point, and never hands one carrier’s point to another', async () => {
    // Followed on La Poste, which names Posti, whose own lookup then follows the parcel.
    const handed = scan('2026-10-02T06:00:00Z', 'in_transit', 'Handed to the delivery partner');
    const partner = await follow({ id: 'partner', carrier: 'la-poste' },
      answer('in_transit', [handed], { delivery_carrier: 'posti', destination_country: 'FI' }),
      answer('ready_for_pickup', [arrived, waiting], { pickup_point: POINT }),
      answer('delivered', [collected]));
    expect(partner.adapter.fetch.mock.calls.map((call) => call[0])).toEqual(['la-poste', 'posti', 'posti']);
    expect(partner.checks.at(-1)).toMatchObject({ current_stage: 'delivered',
      carrier_data: { original_carrier: 'la-poste', active_tracking_carrier: 'posti', pickup_point: POINT } });

    // La Poste said where the parcel waited; Posti, reached only now, delivers it without a point.
    const origin = await follow({ id: 'origin', carrier: 'la-poste' },
      answer('ready_for_pickup', [arrived, waiting], { pickup_point: POINT }),
      answer('ready_for_pickup', [arrived, waiting], { pickup_point: POINT, delivery_carrier: 'posti', destination_country: 'FI' }),
      answer('delivered', [collected]));
    expect(origin.checks.at(-1)).toMatchObject({ current_stage: 'delivered', carrier_data: { active_tracking_carrier: 'posti' } });
    expect(origin.point(-1)).toBeUndefined();

    // The owner changed the carrier: the one the point came from no longer delivers.
    const changed = await follow({ id: 'changed', carrier: 'la-poste', current_stage: 'ready_for_pickup',
      carrier_data: { pickup_point: POINT, routing: { version: 1, configured_carrier: 'chronopost' } } },
    answer('delivered', [waiting, collected]));
    expect(changed.point(-1)).toBeUndefined();
  });
});
