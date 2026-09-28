// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOOP_RECORDER } from '@carriers/core/telemetry';
import type { CarrierResult } from '@carriers/core/result';
import type { TrawlClient } from '@carriers/core/transport';
import { createAdapterRegistry } from './adapterRegistry';
import { CarrierTrackingAdapter } from './trackingSync';
import { TrackingRouter } from './trackingRouting';
import { captureDirectLocalHistory, directLocalHistory, hasUnresolvedDirectCurrent } from './directLocalHistory';
import type { UniversalTracker } from '@carriers/providers/universal';
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
];

function setup(entry: typeof cases[number]) {
  let body = readFileSync(new URL(`../../packages/carriers/carriers/${entry.carrier}/fixtures/${entry.fixture}`, import.meta.url), 'utf8');
  if (entry.carrier === 'four-px') {
    const value = JSON.parse(body);
    for (const scan of value.data[0].tracks) scan.tkTimezone = '';
    body = JSON.stringify(value);
  }
  if (entry.carrier === 'yunexpress') {
    const value = JSON.parse(body);
    value.ResultList[0].TrackInfo.LastTrackEvent.GmtProcessTimezone = '';
    body = JSON.stringify(value);
  }
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
    if (entry.carrier === 'aramex' && String(url).includes('/track/shipments')) {
      return new Response(`<a class="shipment-card" href="/track/details?q=synthetic"><div class="shipment-num"><h5>${entry.number}</h5></div></a>`);
    }
    return new Response(body);
  });
  const trawl = entry.carrier === 'yunexpress' ? { scrape: vi.fn().mockResolvedValue({
    capturedResponses: [{ url: 'https://services.yuntrack.com/Track/Query', status: 200,
      body, base64Encoded: false, truncated: false, error: null }],
  }) } : null;
  const registry = createAdapterRegistry({ fetcher, trawl: trawl as unknown as TrawlClient | null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
  const universal = { fetch: vi.fn() };
  const adapter = new CarrierTrackingAdapter(universal as unknown as UniversalTracker, registry, NOOP_RECORDER);
  return { adapter, registry, fetcher };
}

afterEach(() => vi.restoreAllMocks());

describe('expanded direct coverage through the host', () => {
  it.each(cases)('$carrier dispatches through its registered factory', async entry => {
    const test = setup(entry);
    expect(test.registry.adapterIdFor(entry.carrier)).toBe(entry.carrier);
    const result = await test.adapter.fetch(entry.carrier, entry.number, null);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('tracking_provider');
    expect(test.fetcher).toHaveBeenCalledTimes(entry.carrier === 'yunexpress' ? 0 : entry.carrier === 'aramex' ? 2 : 1);
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
    expect(value.result).toMatchObject({ last_update: '2026-04-01T10:00:00Z', tracking_provider: 'Ship24',
      direct_local_history: { carrier: entry.carrier, number: entry.number, events: expect.any(Array) } });
    const archive = directLocalHistory(parcel, value.result)!;
    expect((archive.events as unknown[]).length).toBe(direct.events?.length);
    if (entry.carrier === 'yamato') expect(JSON.stringify(archive)).toContain('provider_time_text');
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
});
