import records from './fixtures/expandedResults.json';
import { CarrierError, type CarrierErrorKind } from 'universal-parcel-scraper';
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOOP_RECORDER } from 'universal-parcel-scraper/node';
import type { CarrierResult } from 'universal-parcel-scraper';
import { createAdapterRegistry } from './adapterRegistry';
import { buildEvents, CarrierTrackingAdapter } from './trackingSync';
import { TrackingRouter } from './trackingRouting';
import { captureDirectLocalHistory, directLocalHistory, hasUnresolvedDirectCurrent, hasUnresolvedDirectHistory } from './directLocalHistory';
import type { UniversalTracker } from 'universal-parcel-scraper/node';
import * as observability from './observability';

const cases = [
  { carrier: 'austrian-post', number: '1000000000000000000001', fixture: 'delivered.json' },
  { carrier: 'tnt', number: '1000000000000001', fixture: 'registered.html' },
  { carrier: 'ontrac', number: '1LS0000000000001', fixture: 'delivered.json' },
  { carrier: 'blue-dart', number: '00000000001', fixture: 'delivered.html' },
  { carrier: 'delhivery', number: '0000000000001', fixture: 'delivered.json' },
  { carrier: 'aramex', number: '00000000001', fixture: 'delivered.html', unresolved: true },
  { carrier: 'four-px', number: '4PX0000000000001CN', fixture: 'delivered.json', unresolved: true },
  { carrier: 'singapore-post', number: 'CZ000000005SG', fixture: 'speedpost.json', unresolved: true },
  { carrier: 'korea-post', number: 'EE000000005KR', fixture: 'delivered.html', unresolved: true },
  { carrier: 'yamato', number: '123456789012', fixture: 'delivered.html', unresolved: true },
  { carrier: 'yanwen', number: 'UK000000005YP', fixture: 'delivered.html' },
  { carrier: 'dtdc', number: 'N00000001', fixture: 'delivered.json' },
  { carrier: 'yunexpress', number: 'YT0000000000000001', fixture: 'in-transit.json', unresolved: true },
  { carrier: 'postnord', number: '00573000000000000001', fixture: 'delivered.json' },
  { carrier: 'bpost', number: '000000000000000000000001', fixture: 'delivered.json', unresolved: true },
  { carrier: 'purolator', number: '100000000001', fixture: 'delivered.json', unresolved: true },
  { carrier: 'yto', number: 'YT0000000000001', fixture: 'delivered.json' },
  { carrier: 'correios-br', number: 'AA000000005BR', fixture: 'delivered.json' },
  { carrier: 'yunda', number: '0000000000001', fixture: 'delivered.json' },
  { carrier: 'ems', number: 'EB000000005CN', fixture: 'positive.html', unresolved: true },
  { carrier: 'spring-gds', number: 'LX123456785NL', fixture: 'delivered.json', unresolved: true },
  { carrier: 'uniuni', number: 'UUS0000000000000001', fixture: 'delivered.json', unresolved: true },
  { carrier: 'ctt-express', number: '0000000000000000000001', fixture: 'pickup.json', unresolved: true },
  { carrier: 'pos-malaysia', number: 'RR000000005MY', fixture: 'international.json', unresolved: true },
  { carrier: 'canpar', number: 'C000000000000000000001', fixture: 'delivered.json', unresolved: true },
  { carrier: 'ninja-van', number: 'NLMYA00000000', fixture: 'returned.json', unresolved: true },
  { carrier: 'correos-chile', number: 'SX000000005CL', fixture: 'customs.json', unresolved: true },
  { carrier: 'gofo', number: 'GFUS00000000000001', fixture: 'delivered.json', unresolved: true },
  { carrier: 'ecoscooting', number: '000000000000000001', fixture: 'delivered.json', unresolved: true },
  { carrier: 'landmark-global', number: 'LTN00000001N1', fixture: 'delivered.html', unresolved: true },
  { carrier: 'correos-express', number: '9900000000000002', fixture: 'history.html', unresolved: true },
  { carrier: 'nz-post', number: '00000000000000000001', fixture: 'delivered.json', unresolved: true },
  { carrier: 'poczta-polska', number: '00000000000000000001', fixture: 'delivered.json', unresolved: true },
  { carrier: 'the-courier-guy', number: 'TESTA1', fixture: 'delivered.json', unresolved: true },
  { carrier: 'bring-posten', number: '00000000000000001', fixture: 'delivered.json', unresolved: true },
  { carrier: 'estafeta', number: '9000000001', fixture: 'delivered-lookup.html', unresolved: true },
  { carrier: 'canada-post', number: '0073938000999999', fixture: 'delivered.json', unresolved: true },
  { carrier: 'nacex', number: '9900/99000002', fixture: 'history.html', unresolved: true },
  { carrier: 'ukrposhta', number: 'RR000000005UA', fixture: 'delivered.json', unresolved: true },
  { carrier: 'seur', number: '9900002', fixture: 'history.json', unresolved: true },
  { carrier: 'brt', number: '99000000000002', fixture: 'history.html', unresolved: true },
  { carrier: 'landmark-global', number: 'LTN000000009', fixture: 'in-transit-nine-digit.html', unresolved: true },
  { carrier: 'gofo', number: 'GFUS00000000000001', fixture: 'public-counter.json', unresolved: true },
  { carrier: 'ecoscooting', number: 'CNPRT00000000000000000001', fixture: 'delivered-portugal.json', unresolved: true },
  { carrier: 'uniuni', number: 'UUSC000000000001', fixture: 'uusc-delivered.json', unresolved: true },
  { carrier: 'estafeta', number: '900000000001A000000002', fixture: 'full-guide-lookup.html', unresolved: true },
  { carrier: 'the-courier-guy', number: 'LD000001', fixture: 'pudo-delivered.json', unresolved: true },
  { carrier: 'the-courier-guy', number: 'DD000001', fixture: 'collection-cancelled.json', unresolved: true },
  { carrier: 'relais-colis', number: 'CC200000000401', fixture: 'grouped-history.html', unresolved: true },
  { carrier: 'ciblex', number: '000000000000000000000001', fixture: 'full-barcode.html', unresolved: true },

];

function setup(entry: typeof cases[number], variant = '') {
  const record = (records as Record<string, { result?: CarrierResult; error?: { kind: string; message: string } }>)[`${entry.carrier}/${entry.fixture}/${variant}`];
  if (!record) throw new Error('Missing synthetic scraper result');
  const registry = createAdapterRegistry({ trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
  const track = vi.spyOn(registry.for(entry.carrier)!, 'track').mockImplementation(async () => {
    if (record.error) throw new CarrierError(record.error.kind as CarrierErrorKind, entry.carrier, record.error.message);
    return structuredClone(record.result!);
  });
  const universal = { fetch: vi.fn() };
  return { adapter: new CarrierTrackingAdapter(universal as unknown as UniversalTracker, registry, NOOP_RECORDER), registry, track };
}

afterEach(() => vi.restoreAllMocks());

describe('expanded direct coverage through the host', () => {
  it.each(cases)('$carrier dispatches through its registered factory', async entry => {
    const test = setup(entry);
    expect(test.registry.adapterIdFor(entry.carrier)).toBe(entry.carrier);
    const result = await test.adapter.fetch(entry.carrier, entry.number, null);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('tracking_provider');
    expect(test.track).toHaveBeenCalledOnce();
  });

  it.each(cases.filter(entry => entry.unresolved))('$carrier saves unresolved direct dates while using dated provider progress', async entry => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const test = setup(entry);
    const direct = await test.adapter.fetch(entry.carrier, entry.number, null);
    expect(hasUnresolvedDirectCurrent(entry.carrier, direct)).toBe(true);
    const universal = vi.fn().mockResolvedValue({ status: 'delivered', current_stage: 'delivered',
      last_update: '2026-04-01T10:00:00Z', events: [{ time: '2026-04-01T10:00:00Z', stage: 'delivered', description: 'Delivered' }] });
    const router = new TrackingRouter({ direct: async () => ({ result: direct, sourceCarrierId: entry.carrier,
      swissPostReady: null, handoffFallbackErrorType: null }), universal,
      health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'synthetic-lease' }), finishTrackingProvider: vi.fn() },
      now: () => new Date('2026-04-02T10:00:00Z') });
    const parcel = { carrier: entry.carrier, tracking_number: entry.number };
    const value = await router.fetch(parcel, false);
    expect(universal).toHaveBeenCalledOnce();
    expect(value.result).toMatchObject({ last_update: '2026-04-01T10:00:00Z', tracking_provider: universal.mock.calls[0][0],
      direct_local_history: { carrier: entry.carrier, number: entry.number, events: expect.any(Array) } });
    const archive = directLocalHistory(parcel, value.result)!;
    expect((archive.events as unknown[]).length).toBe(direct.events?.length);
    if (entry.carrier === 'yamato') expect(JSON.stringify(archive)).toContain('provider_time_text');
  });

  it('keeps Ciblex current unknown wording separate from an older delivery', async () => {
    const entry = cases.find(entry => entry.carrier === 'ciblex')!;
    const test = setup(entry, 'unknown');
    const result = await test.adapter.fetch(entry.carrier, entry.number, null);
    expect(result.status).toBe('unknown');
    expect(result.current_stage).toBeUndefined();
    expect(result.last_update).toBeNull();
    expect(result.events?.[0]?.provider_status).toBe('Nouvelle formulation inconnue');
    expect(hasUnresolvedDirectCurrent('ciblex', result)).toBe(true);
  });

  it('keeps yearless scans distinct across successive direct snapshots', () => {
    const result: CarrierResult = { events: [
      { provider_time_text: '01月02日 12:00', description: 'Moving', location: 'Example facility' },
      { provider_time_text: '01月01日 12:00', description: 'Moving', location: 'Example facility' },
    ] };
    const archive = captureDirectLocalHistory('yamato', '123456789012', result);
    const parcel = { tracking_number: '123456789012', carrier_data: { direct_local_history: archive } };
    expect(directLocalHistory(parcel, { direct_local_history: captureDirectLocalHistory('yamato', '123456789012', { events: result.events?.slice(1) }) })?.events)
      .toEqual(archive.events);
  });

  it.each(['yto', 'correios-br', 'yunda'])('archives an unresolved %s current clock and asks providers for dated progress', async carrier => {
    const entry = cases.find(entry => entry.carrier === carrier)!;
    const test = setup(entry, 'invalid-clock');
    const direct = await test.adapter.fetch(entry.carrier, entry.number, null);
    expect(hasUnresolvedDirectCurrent(entry.carrier, direct)).toBe(true);
    expect(direct.events?.[0]).toMatchObject({ provider_time_text: '2026-02-30 18:00:00' });
    const universal = vi.fn().mockResolvedValue({ status: 'delivered', current_stage: 'delivered', last_update: '2026-04-01T10:00:00Z' });
    const router = new TrackingRouter({ direct: async () => ({ result: direct, sourceCarrierId: entry.carrier,
      swissPostReady: null, handoffFallbackErrorType: null }), universal,
      health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'synthetic-lease' }), finishTrackingProvider: vi.fn() },
      now: () => new Date('2026-04-02T10:00:00Z') });
    const value = await router.fetch({ carrier: entry.carrier, tracking_number: entry.number }, false);
    expect(universal).toHaveBeenCalledOnce();
    expect(value.result).toMatchObject({ tracking_provider: universal.mock.calls[0][0], direct_local_history: {
      carrier, events: expect.arrayContaining([expect.objectContaining({ provider_time_text: '2026-02-30 18:00:00' })]),
    } });
  });

  it.each(['ontrac', 'aramex'])('%s asks providers when the current scan has no clock at all', async carrier => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const entry = cases.find(entry => entry.carrier === carrier)!;
    const test = setup(entry, 'no-clock');
    const direct = await test.adapter.fetch(carrier, entry.number, null);
    expect(hasUnresolvedDirectCurrent(carrier, direct)).toBe(true);
    expect(direct.events?.[0]).not.toHaveProperty('time');
    expect(direct.events?.[0]).not.toHaveProperty('local_time');
    expect(direct.events?.[0]).not.toHaveProperty('provider_time_text');
    const universal = vi.fn().mockResolvedValue({ status: 'delivered', last_update: '2026-01-03T22:00:00Z' });
    const router = new TrackingRouter({ direct: async () => ({ result: direct, sourceCarrierId: carrier,
      swissPostReady: null, handoffFallbackErrorType: null }), universal,
      health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'synthetic-lease' }), finishTrackingProvider: vi.fn() } });
    const value = await router.fetch({ carrier, tracking_number: entry.number }, false);
    expect(universal).toHaveBeenCalledOnce();
    expect(value.result).toMatchObject({ tracking_provider: universal.mock.calls[0][0], direct_local_history: {
      events: expect.arrayContaining([expect.objectContaining({ description: direct.events![0]!.description })]),
    } });
  });

  it('archives undated Delhivery history while keeping its dated current status direct', async () => {
    const entry = cases.find(entry => entry.carrier === 'delhivery')!;
    const direct = await setup(entry).adapter.fetch(entry.carrier, entry.number, null);
    expect(hasUnresolvedDirectHistory(entry.carrier, direct)).toBe(true);
    expect(hasUnresolvedDirectCurrent(entry.carrier, direct)).toBe(false);
    const universal = vi.fn();
    const router = new TrackingRouter({ direct: async () => ({ result: direct, sourceCarrierId: entry.carrier,
      swissPostReady: null, handoffFallbackErrorType: null }), universal,
      health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'synthetic-lease' }), finishTrackingProvider: vi.fn() } });
    const parcel = { carrier: entry.carrier, tracking_number: entry.number };
    const value = await router.fetch(parcel, false);
    expect(universal).not.toHaveBeenCalled();
    const archive = directLocalHistory(parcel, value.result)!;
    expect(archive.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ description: 'DELIVERED', summary_snapshot: true, time: direct.last_update }),
      expect.objectContaining({ description: 'In Transit' }),
    ]));
    expect(buildEvents(parcel, value.result)).toHaveLength(1);
  });

  it('archives an undated Pos Malaysia delivery summary without borrowing an older movement clock', async () => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const entry = cases.find(entry => entry.carrier === 'pos-malaysia')!;
    const direct = await setup(entry, 'delivered-summary').adapter.fetch(entry.carrier, entry.number, null);
    expect(direct).toMatchObject({ status: 'delivered', last_update: null, events: [
      expect.objectContaining({ stage: 'delivered', summary_snapshot: true }),
      ...Array.from({ length: 5 }, () => expect.any(Object)),
    ] });
    expect(hasUnresolvedDirectCurrent(entry.carrier, direct)).toBe(true);
    const universal = vi.fn().mockResolvedValue({ status: 'delivered', current_stage: 'delivered',
      last_update: '2026-04-01T10:00:00Z', events: [{ time: '2026-04-01T10:00:00Z', description: 'Delivered', stage: 'delivered' }] });
    const router = new TrackingRouter({ direct: async () => ({ result: direct, sourceCarrierId: entry.carrier,
      swissPostReady: null, handoffFallbackErrorType: null }), universal,
      health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'synthetic-lease' }), finishTrackingProvider: vi.fn() } });
    const parcel = { carrier: entry.carrier, tracking_number: entry.number };
    const value = await router.fetch(parcel, false);
    expect(universal).toHaveBeenCalledOnce();
    expect(directLocalHistory(parcel, value.result)?.events).toEqual(direct.events);
    expect(buildEvents(parcel, value.result)).toHaveLength(1);
  });

  it('retains return-leg and summary evidence when otherwise identical scans are merged', () => {
    const number = '123456789012';
    const scan = { description: 'Arrived', provider_time_text: '01月02日 12:00' };
    const old = captureDirectLocalHistory('yamato', number, { events: [scan] });
    const incoming = captureDirectLocalHistory('yamato', number, { events: [
      { ...scan, provider_leg: 'return' }, { ...scan, provider_leg: 'return', summary_snapshot: true },
    ] });
    expect(directLocalHistory({ tracking_number: number, carrier_data: { direct_local_history: old } },
      { direct_local_history: incoming })?.events).toEqual([
      { ...scan, provider_leg: 'return' }, { ...scan, provider_leg: 'return', summary_snapshot: true }, scan,
    ]);
  });

  it('falls back from mismatched YunExpress latest history without consuming its dated scans', async () => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const entry = cases.find(entry => entry.carrier === 'yunexpress')!;
    const test = setup(entry, 'mismatch');
    await expect(test.adapter.fetch(entry.carrier, entry.number, null)).rejects.toMatchObject({ kind: 'indeterminate' });
    const providerEvents = [{ time: '2026-04-01T10:00:00Z', description: 'Out for delivery', stage: 'out_for_delivery' }];
    const universal = vi.fn().mockResolvedValue({ status: 'out_for_delivery', current_stage: 'out_for_delivery',
      last_update: '2026-04-01T10:00:00Z', events: providerEvents });
    const router = new TrackingRouter({ direct: async () => ({
      result: await test.adapter.fetch(entry.carrier, entry.number, null), sourceCarrierId: entry.carrier,
      swissPostReady: null, handoffFallbackErrorType: null }), universal,
      health: { acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'synthetic-lease' }), finishTrackingProvider: vi.fn() },
      now: () => new Date('2026-04-02T10:00:00Z') });
    const value = await router.fetch({ carrier: entry.carrier, tracking_number: entry.number }, false);
    expect(universal).toHaveBeenCalledOnce();
    expect(value.result).toMatchObject({ tracking_provider: universal.mock.calls[0][0], events: providerEvents,
      routing: { last_event_at: '2026-04-01T10:00:00.000Z' } });
    expect(value.result).not.toHaveProperty('direct_local_history');
    expect(value.result).not.toHaveProperty('direct_local_fallback');
  });

  it('does not turn a delivered PostNord notification into another parcel delivery', async () => {
    const entry = cases.find(entry => entry.carrier === 'postnord')!;
    const result = await setup(entry).adapter.fetch(entry.carrier, entry.number, null);
    const rows = buildEvents({ id: 'synthetic-package', carrier: entry.carrier }, result);
    expect(rows.some(row => row.description === 'A text message notification has been delivered to the recipient.')).toBe(false);
    expect(rows.filter(row => row.stage === 'delivered')).toEqual([
      expect.objectContaining({ occurred_at: '2026-01-04T12:00:00Z', description: 'The shipment item has been delivered.' }),
    ]);
  });

  it('keeps a DTDC return active through the host until delivery back to the sender', async () => {
    const entry = cases.find(entry => entry.carrier === 'dtdc')!;
    for (const stage of ['exception', 'in_transit', 'out_for_delivery', 'returned']) {
      const test = setup(entry, `return-${stage}`);
      const result = await test.adapter.fetch(entry.carrier, entry.number, null);
      expect(result.current_stage).toBe(stage);
      expect(result).not.toHaveProperty('delivered_at');
      expect(buildEvents({ carrier: entry.carrier }, result)).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage, raw_data: expect.objectContaining({ provider_leg: 'return' }) }),
      ]));
    }
  });
});
