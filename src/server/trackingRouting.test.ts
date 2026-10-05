import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamHttpError } from 'universal-parcel-scraper/node';
import { freshnessWindow, RoutingDeferred, routingState, TrackingRouter, type RoutedResult } from './trackingRouting';
import type { JsonObject } from './types';
import type { CarrierResult } from 'universal-parcel-scraper';
import * as monitoring from './observability';
import { universalCarrierHints } from 'universal-parcel-scraper/app';
import { IndeterminateError, InputRequiredError, NotFoundError } from 'universal-parcel-scraper';
import * as scraper from 'universal-parcel-scraper';

// Keep the published plan configurable without changing the scraper's other exports.
vi.mock(import('universal-parcel-scraper'), async importOriginal => ({ ...await importOriginal() }));

const time = new Date('2026-09-10T12:00:00Z');
const history = (stamp = '2026-09-10T11:00:00Z'): CarrierResult => ({ status: 'in_transit', current_stage: 'in_transit',
  last_update: stamp, events: [{ time: stamp, description: 'In transit', stage: 'in_transit' }] });
const thinHistory = (): CarrierResult => ({ status: 'pending', current_stage: 'pending', last_update: '2026-09-10T11:30:00Z',
  events: [{ time: '2026-09-10T11:30:00Z', description: 'Information received', stage: 'pending' }] });
const directValue = (carrier = 'ups'): RoutedResult => ({ result: history(), sourceCarrierId: carrier, swissPostReady: null, handoffFallbackErrorType: null });
const yearlessYamato = (): RoutedResult => ({ sourceCarrierId: 'yamato', swissPostReady: null, handoffFallbackErrorType: null,
  result: { status: 'in_transit', current_stage: 'accepted', last_update: null,
    events: [{ description: '荷物受付', stage: 'accepted', provider_time_text: '09月01日 10:00' }] } });
const parcel = (overrides: JsonObject = {}): JsonObject => ({ id: 'parcel', carrier: 'unknown', tracking_number: 'TEST1234', ...overrides });
const state = (extra: JsonObject = {}) => ({ version: 1, configured_carrier: 'unknown', failures: {}, probe_cursor: 0, discovery_cursor: 0, ...extra });
function setup(now = time) {
  const direct = vi.fn().mockResolvedValue(directValue());
  const universal = vi.fn().mockResolvedValue(history());
  const health = {
    acquireTrackingProvider: vi.fn().mockResolvedValue({ token: 'lease', retry_at: '2026-09-10T12:01:30Z' }),
    finishTrackingProvider: vi.fn().mockResolvedValue(undefined),
  };
  // No carrier knows the number unless a test says so.
  const recognize = vi.fn().mockResolvedValue({ known: false });
  const recognizeBrowser = vi.fn().mockResolvedValue({ known: false });
  return { direct, universal, health, recognize, recognizeBrowser,
    router: new TrackingRouter({ direct, universal, health, recognize, recognizeBrowser, now: () => now }) };
}
beforeEach(() => vi.spyOn(monitoring, 'reportRoutingEvent').mockImplementation(() => undefined));
afterEach(() => vi.restoreAllMocks());

describe('persistent tracking routing', () => {
  it('discovers a browser carrier before using a universal provider', async () => {
    const { router, direct, universal, recognizeBrowser } = setup();
    recognizeBrowser.mockResolvedValue({ known: true, lastActivityAt: time.toISOString() });
    direct.mockImplementation(async (_parcel, carrier) => directValue(carrier));
    const result = await router.fetch(parcel({ tracking_number: '000000000011' }), false);
    expect(result.sourceCarrierId).toBe('fedex');
    expect(recognizeBrowser).toHaveBeenCalledWith('fedex', '000000000011', expect.objectContaining({ budgetMs: 20_000 }), undefined);
    expect(universal).not.toHaveBeenCalled();
  });

  it('cools down a browser miss and does not adopt an old reused number', async () => {
    const first = setup();
    const input = parcel({ tracking_number: '000000000012' });
    const result = await first.router.fetch(input, false);
    const routing = result.result.routing;
    expect(routing).toMatchObject({ candidate_probes: { fedex: { count: 1, retry_at: '2026-09-10T13:00:00.000Z' } } });
    const next = setup(new Date('2026-09-10T12:10:00Z'));
    await next.router.fetch({ ...input, carrier_data: { routing } }, false);
    expect(next.recognizeBrowser).not.toHaveBeenCalled();
    const old = setup();
    old.recognizeBrowser.mockResolvedValue({ known: true, lastActivityAt: '2020-01-01T00:00:00Z' });
    await old.router.fetch(parcel({ tracking_number: '000000000013' }), false);
    expect(old.direct).not.toHaveBeenCalled();
    expect(old.universal).toHaveBeenCalled();
  });

  it('avoids browser discovery after a matching carrier outage or an HTTP confirmation', async () => {
    const outage = setup();
    outage.direct.mockRejectedValue(new Error('Connection failed'));
    await outage.router.fetch(parcel({ carrier: 'fedex', tracking_number: '000000000014' }), false);
    expect(outage.recognizeBrowser).not.toHaveBeenCalled();
    const http = setup();
    http.recognize.mockResolvedValue({ known: true, lastActivityAt: time.toISOString() });
    await http.router.fetch(parcel({ tracking_number: '000000000015' }), false);
    expect(http.recognizeBrowser).not.toHaveBeenCalled();
  });
  it.each([
    [{ lookup_country_hint: 'FR' }, 'FR'],
    [{ lookup_country_hint: 'FR', destination_country: 'CH' }, 'CH'],
    [{ lookup_country_hint: 'FR', destination_country_name: 'Germany' }, 'Germany'],
  ])('forwards a destination before the weak country hint: %j', async (carrier_data, country) => {
    const { router, universal } = setup();
    await router.fetch(parcel({ carrier_data }), false);
    expect(universal).toHaveBeenCalledWith('ParcelsApp', 'TEST1234', expect.any(Number), null, null, country);
  });

  it('retains actionable input failures through a deferred lookup', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new InputRequiredError('Heppner', 'postcode'));
    universal.mockRejectedValue(new Error('unavailable'));
    await expect(router.fetch(parcel({ carrier: 'heppner' }), false)).rejects.toMatchObject({
      stale: false,
      routing: { failures: { heppner: { kind: 'input_required', user_error: 'carrier:input_required' } } },
    });
  });
  it.each(['ups', 'fedex', 'usps', 'canada-post', 'aramex'])('uses a direct carrier without contacting a universal provider', async (carrier) => {
    const { router, direct, universal } = setup();
    const result = await router.fetch(parcel({ carrier }), false);
    expect(result.result.routing).toMatchObject({ confirmed_carrier: carrier, last_success_at: time.toISOString() });
    expect(direct).toHaveBeenCalledWith(expect.objectContaining({ tracking_number: 'TEST1234' }), carrier);
    expect(universal).not.toHaveBeenCalled();
  });
  it.each([false, true])('uses Royal Mail history before providers, including saved provider affinity: %s', async (saved) => {
    const { router, direct, universal } = setup();
    direct.mockResolvedValue(directValue('royal-mail'));
    const result = await router.fetch(parcel({
      carrier: 'royal-mail',
      carrier_data: saved ? { routing: state({
        configured_carrier: 'royal-mail', confirmed_carrier: 'royal-mail', confirmed_number: 'TEST1234',
        preferred_provider: 'ParcelsApp', preferred_number: 'TEST1234',
      }) } : {},
    }), false);
    expect(direct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tracking_number: 'TEST1234' }), 'royal-mail');
    expect(universal).not.toHaveBeenCalled();
    expect(result.sourceCarrierId).toBe('royal-mail');
    expect(result.result.routing).toMatchObject({ configured_carrier: 'royal-mail', confirmed_carrier: 'royal-mail' });
  });
  it('falls back to provider history when Royal Mail browser tracking fails', async () => {
    const { router, direct, universal } = setup();
    vi.spyOn(scraper, 'universalPlan').mockReturnValue({
      sources: ['ParcelsApp'], carrier: 'royal-mail', tier: () => 'full', rank: () => 0,
    });
    direct.mockRejectedValue(new Error('Browser tracking unavailable'));
    universal.mockResolvedValue({ ...history(), discovered_carrier: 'royal-mail' });
    const result = await router.fetch(parcel({ carrier: 'royal-mail' }), false);
    expect(direct).toHaveBeenCalledExactlyOnceWith(expect.any(Object), 'royal-mail');
    expect(universal).toHaveBeenCalledExactlyOnceWith('ParcelsApp', 'TEST1234', expect.any(Number), null, null);
    expect(result.result.routing).toMatchObject({ preferred_provider: 'ParcelsApp', failures: { 'royal-mail': { kind: 'transport' } } });
    expect(result.result.tracking_provider).toBe('ParcelsApp');
  });
  it('discovers in default order and remembers the working provider across instances', async () => {
    const first = setup();
    first.universal.mockRejectedValueOnce(new Error('down'));
    const result = await first.router.fetch(parcel(), false);
    expect(first.universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp', 'Ship24']);
    const second = setup(new Date('2026-09-10T12:20:00Z'));
    await second.router.fetch(parcel({ carrier_data: result.result }), false);
    expect(second.universal.mock.calls.map(([source]) => source)).toEqual(['Ship24']);
  });
  it('keeps an already successful Ship24 affinity after the default order changes', async () => {
    const { router, universal } = setup();
    await router.fetch(parcel({ carrier_data: { routing: state({ preferred_provider: 'Ship24' }) } }), false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['Ship24']);
  });
  it.each([false, true])('searches past thin preferred and fallback answers for progress (scheduled=%s)', async (scheduled) => {
    const { router, universal, health } = setup();
    universal.mockImplementation(async (source: string) => source === '17TRACK' ? history() : thinHistory());
    const result = await router.fetch(parcel({ current_stage: 'in_transit', carrier_data: { routing: state({
      preferred_provider: 'Ship24', preferred_number: 'TEST1234', last_probe_at: time.toISOString(),
      consecutive_failures: 3,
    }) } }), scheduled);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['Ship24', 'ParcelsApp', '17TRACK']);
    expect(result.result).toMatchObject({ tracking_provider: '17TRACK', routing: { preferred_provider: '17TRACK', consecutive_failures: 0 } });
    // A thin answer is a healthy transport, not a provider outage.
    expect(health.finishTrackingProvider).toHaveBeenCalledTimes(3);
    for (const call of health.finishTrackingProvider.mock.calls) expect(call[2]).toBeNull();
  });
  it('keeps the progress provider through thin fallbacks and recovers on an hourly check', async () => {
    let saved: JsonObject = { tracking_provider: 'Ship24', routing: state({ preferred_provider: 'Ship24',
      preferred_number: 'TEST1234', last_event_at: '2026-09-10T11:00:00Z', last_success_at: '2026-09-10T11:00:00Z',
      last_probe_at: time.toISOString() }) };
    for (let hour = 0; hour < 7; hour++) {
      const { router, universal } = setup(new Date(time.getTime() + hour * 3_600_000));
      universal.mockImplementation(async (source: string) => {
        if (source === 'Ship24') throw new Error('upstream timeout');
        return thinHistory();
      });
      const result = await router.fetch(parcel({ current_stage: 'in_transit', carrier_data: saved }), false);
      const routing = result.result.routing as JsonObject;
      expect(routing).toMatchObject({ preferred_provider: 'Ship24', preferred_number: 'TEST1234',
        last_event_at: '2026-09-10T11:00:00Z', last_success_at: '2026-09-10T11:00:00Z', consecutive_failures: hour + 1 });
      expect(universal.mock.calls.map(([source]) => source)).toContain('ParcelsApp');
      saved = { ...saved, routing };
    }
    // The transport backoff still applies: resume after its six-hour cap.
    const recovered = setup(new Date(time.getTime() + 13 * 3_600_000));
    const result = await recovered.router.fetch(parcel({ current_stage: 'in_transit', carrier_data: saved }), false);
    expect(recovered.universal.mock.calls.map(([source]) => source)).toEqual(['Ship24']);
    expect(result.result.routing).toMatchObject({ preferred_provider: 'Ship24', failures: {}, consecutive_failures: 0 });
  });
  it('repairs an already pinned thin provider in the same check', async () => {
    const { router, universal } = setup();
    universal.mockImplementation(async (source: string) => source === 'ParcelsApp' ? thinHistory() : history());
    const result = await router.fetch(parcel({ current_stage: 'in_transit', carrier_data: { routing: state({
      preferred_provider: 'ParcelsApp', preferred_number: 'TEST1234',
    }) } }), false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp', 'Ship24']);
    expect(result.result.routing).toMatchObject({ preferred_provider: 'Ship24' });
  });
  it('does not report a direct-support opportunity from a thin answer', async () => {
    const { router, universal } = setup();
    universal.mockResolvedValue({ ...thinHistory(), discovered_carrier: 'royal-mail' });
    await router.fetch(parcel({ carrier: 'royal-mail', current_stage: 'in_transit' }), false);
    expect(monitoring.reportRoutingEvent).not.toHaveBeenCalledWith('direct_support_opportunity', expect.anything());
  });
  it.each([
    ['registered', { ...thinHistory(), current_stage: 'registered',
      events: [{ time: '2026-09-10T11:30:00Z', description: 'Information received', stage: 'registered' }] }],
    ['unmapped', { status: 'pending', events: [{ time: '2026-09-10T11:30:00Z', description: 'Noted at the fixture desk' }] }],
  ] as const)('searches past a %s label answer without changing carrier classification', async (_label, thin) => {
    const { router, universal } = setup();
    universal.mockResolvedValueOnce(thin).mockResolvedValueOnce(history());
    const result = await router.fetch(parcel({ current_stage: 'in_transit' }), false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp', 'Ship24']);
    expect(result.result.routing).toMatchObject({ preferred_provider: 'Ship24' });
  });
  it('accepts history that has movement before its latest label scan', async () => {
    const { router, universal } = setup();
    universal.mockResolvedValue({ ...thinHistory(), events: [...thinHistory().events!, ...history().events!] });
    const result = await router.fetch(parcel({ current_stage: 'in_transit' }), false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp']);
    expect(result.result.routing).toMatchObject({ preferred_provider: 'ParcelsApp' });
  });
  it('accepts movement classified from wording when a provider names no stage', async () => {
    const { router, universal } = setup();
    universal.mockResolvedValue({ status: 'pending', events: [{ time: '2026-09-10T11:00:00Z', description: 'In transit' }] });
    const result = await router.fetch(parcel({ current_stage: 'in_transit' }), false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp']);
    expect(result.result.routing).toMatchObject({ preferred_provider: 'ParcelsApp' });
  });
  it.each(['pending', 'registered'])('keeps the first label answer when the parcel is %s', async (stage) => {
    const { router, universal } = setup();
    universal.mockResolvedValue(thinHistory());
    const result = await router.fetch(parcel({ current_stage: stage }), false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp']);
    expect(result.result.routing).toMatchObject({ preferred_provider: 'ParcelsApp' });
  });
  it('retains the first thin answer when later providers fail or defer for a rate limit', async () => {
    const { router, universal } = setup();
    universal.mockResolvedValueOnce(thinHistory())
      .mockRejectedValueOnce(new UpstreamHttpError('Ship24', 429)).mockRejectedValueOnce(new Error('timeout'));
    const result = await router.fetch(parcel({ current_stage: 'in_transit', carrier_data: { routing: state({
      preferred_provider: 'ParcelsApp', last_success_at: '2026-09-10T11:50:00Z', last_event_at: '2026-09-10T11:00:00Z',
    }) } }), false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp', 'Ship24', '17TRACK']);
    expect(result.result).toMatchObject({ tracking_provider: 'ParcelsApp', routing: {
      preferred_provider: 'ParcelsApp', last_event_at: '2026-09-10T11:00:00Z', consecutive_failures: 1,
      last_success_at: '2026-09-10T11:50:00Z',
      failures: { Ship24: { kind: 'rate_limited' }, '17TRACK': { kind: 'transport' } },
    } });
  });
  it.each(['pending', 'in_transit'])('keeps movement ahead of a newer pending-only shadow answer for a %s parcel', async (stage) => {
    const { router, universal } = setup();
    universal.mockResolvedValueOnce(history()).mockResolvedValueOnce(thinHistory());
    const result = await router.fetch(parcel({ current_stage: stage, carrier_data: { routing: state({
      preferred_provider: 'Ship24', last_probe_at: '2026-09-08T12:00:00Z',
    }) } }), true);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['Ship24', 'ParcelsApp']);
    expect(result.result).toMatchObject({ tracking_provider: 'Ship24', routing: { preferred_provider: 'Ship24' } });
  });
  it.each(['ParcelsApp', 'Ship24'] as const)('records original direct failure before a successful %s fallback', async (provider) => {
    vi.spyOn(scraper, 'universalPlan').mockReturnValue({
      sources: [provider], carrier: null, tier: () => 'unknown', rank: () => 0,
    });
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new Error('upstream token SECRET'));
    universal.mockImplementation(async () => {
      expect(monitoring.reportRoutingEvent).toHaveBeenCalledWith('provider_failed', expect.objectContaining({ provider: 'dhl' }));
      return history();
    });
    const result = await router.fetch(parcel({ carrier: 'dhl' }), false);
    expect(result.result.routing).toMatchObject({ preferred_provider: provider });
    expect(JSON.stringify(vi.mocked(monitoring.reportRoutingEvent).mock.calls)).not.toContain('SECRET');
  });
  it.each(['unknown'])('uses universals for %s and still keeps the user selection', async (carrier) => {
    const { router, direct } = setup();
    const result = await router.fetch(parcel({ carrier }), false);
    expect(direct).not.toHaveBeenCalled();
    expect(result.result.routing).toMatchObject({ configured_carrier: carrier, preferred_provider: 'ParcelsApp' });
  });
  it('confirms a strong supported-carrier correction before adopting it', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValueOnce(Object.assign(new Error('missing'), { status: 404 }));
    const result = await router.fetch(parcel({ carrier: 'dhl', tracking_number: '1Z999AA10123456784' }), false);
    expect(direct.mock.calls.map(([, carrier]) => carrier)).toEqual(['dhl', 'ups']);
    expect(result.result.routing).toMatchObject({ confirmed_carrier: 'ups', configured_carrier: 'ups' });
    expect(universal).not.toHaveBeenCalled();
  });
  it('saves a correction and clears inputs belonging to the wrong carrier', async () => {
    const { router, direct } = setup();
    direct.mockRejectedValueOnce(new Error('wrong carrier'));
    const result = await router.fetch(parcel({ carrier: 'dhl', tracking_number: '1Z999AA10123456784',
      tracking_url: 'https://private.invalid/capability', dpd_postcode: '8000' }), false);
    expect(result.correction).toEqual({ carrier: 'ups', trackingUrl: null, postcode: null });
    expect(result.result).toMatchObject({ auto_changed_from: 'dhl', auto_changed_to: 'ups', auto_changed_at: time.toISOString() });
    expect(direct.mock.calls[1][0]).toMatchObject({ tracking_url: null, dpd_postcode: null });
  });
  it('confirms a newly returned universal hint in the same sync and then uses only direct', async () => {
    const { router, direct, universal } = setup();
    universal.mockResolvedValue({ ...history(), discovered_carrier: 'ups' });
    const result = await router.fetch(parcel(), false);
    expect(universal).toHaveBeenCalledOnce();
    expect(direct).toHaveBeenCalledWith(expect.objectContaining({ tracking_number: 'TEST1234' }), 'ups');
    expect(result.correction?.carrier).toBe('ups');
    const next = setup();
    const refreshed = await next.router.fetch(parcel({ carrier: 'ups', carrier_data: result.result }), false);
    expect(refreshed.correction).toBeUndefined();
    expect(next.universal).not.toHaveBeenCalled();
  });
  it.each(['failed', 'older', 'untimed', 'placeholder', 'terminal-conflict'])('keeps universal coverage when direct confirmation is %s', async (reason) => {
    const { router, direct, universal } = setup();
    universal.mockResolvedValue({ ...history(), discovered_carrier: 'ups',
      ...(reason === 'terminal-conflict' ? { current_stage: 'delivered', status: 'delivered' } : {}) });
    if (reason === 'failed') direct.mockRejectedValue(new Error('not found'));
    if (reason === 'older') direct.mockResolvedValue({ ...directValue(), result: history('2026-09-09T11:00:00Z') });
    if (reason === 'untimed') direct.mockResolvedValue({ ...directValue(), result: { status: 'in_transit', events: [] } });
    if (reason === 'placeholder') direct.mockResolvedValue({ ...directValue(), result: { status: 'pending', events: [{ description: 'Waiting', stage: 'pending' }] } });
    const result = await router.fetch(parcel(), false);
    expect(result.correction).toBeUndefined();
    expect(result.result.tracking_provider).toBe('ParcelsApp');
    expect(result.result.routing).not.toHaveProperty('confirmed_carrier');
  });
  it('does not repeat the failing selected scraper when the universal names it', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new Error('down'));
    universal.mockResolvedValue({ ...history(), discovered_carrier: 'ups' });
    const result = await router.fetch(parcel({ carrier: 'ups' }), false);
    expect(direct).toHaveBeenCalledOnce();
    expect(result.correction).toBeUndefined();
    expect(result.result.tracking_provider).toBe('ParcelsApp');
  });
  it('does not relabel an established cross-border journey', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new Error('down'));
    universal.mockResolvedValue({ ...history(), discovered_carrier: 'ups' });
    const result = await router.fetch(parcel({ carrier: 'dhl', carrier_data: {
      original_carrier: 'dhl', active_tracking_carrier: 'swiss-post', active_tracking_number: 'LOCAL1234',
    } }), false);
    expect(direct).toHaveBeenCalledOnce();
    expect(result.correction).toBeUndefined();
  });
  it('uses a universal carrier hint only after a matching direct lookup succeeds', async () => {
    const { router, direct } = setup();
    const result = await router.fetch(parcel({ carrier_data: { routing: state({ discovered_carrier: 'ups' }) } }), false);
    expect(direct).toHaveBeenCalledWith(expect.objectContaining({ carrier: 'ups' }), 'ups');
    expect(result.result.routing).toMatchObject({ confirmed_carrier: 'ups' });
  });
  it('asks a carrier that does not know the number yet again within hours, a provider after a day', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new NotFoundError('Swiss Post'));
    universal.mockRejectedValue(new NotFoundError('Ship24'));
    await expect(router.fetch(parcel({ carrier: 'swiss-post' }), false)).rejects.toMatchObject({ routing: { failures: {
      'swiss-post': { count: 1, kind: 'not_found', retry_at: '2026-09-10T13:00:00.000Z' },
      Ship24: { count: 1, kind: 'not_found', retry_at: '2026-09-11T12:00:00.000Z' },
    } } });
    // Each further miss doubles the carrier's wait, up to six hours.
    const later = setup(new Date('2026-09-10T19:00:00Z'));
    later.direct.mockRejectedValue(new NotFoundError('Swiss Post'));
    const result = await later.router.fetch(parcel({ carrier: 'swiss-post', carrier_data: { routing: state({ configured_carrier: 'swiss-post',
      failures: { 'swiss-post': { count: 3, kind: 'not_found', retry_at: '2026-09-10T19:00:00.000Z' } } }) } }), false);
    expect(result.result.routing).toMatchObject({ failures: { 'swiss-post': { count: 4, retry_at: '2026-09-11T01:00:00.000Z' } } });
  });
  it('asks a carrier that said not found again at once when a provider shows new progress for it', async () => {
    const filed = (extra: JsonObject = {}) => parcel({ carrier: 'swiss-post', carrier_data: { routing: state({ configured_carrier: 'swiss-post',
      failures: { 'swiss-post': { count: 1, kind: 'not_found', retry_at: '2026-09-11T00:00:00.000Z' } }, ...extra }) } });
    const { router, direct, universal } = setup();
    universal.mockResolvedValue({ ...history(), discovered_carrier: 'swiss-post' });
    direct.mockResolvedValue(directValue('swiss-post'));
    const result = await router.fetch(filed(), false);
    expect(direct).toHaveBeenCalledOnce();
    expect(result.result).not.toHaveProperty('tracking_provider');
    expect(result.result.routing).toMatchObject({ confirmed_carrier: 'swiss-post', failures: {} });
    // Progress the parcel already had is no news: the carrier keeps its wait.
    const again = setup();
    again.universal.mockResolvedValue({ ...history(), discovered_carrier: 'swiss-post' });
    const kept = await again.router.fetch(filed({ last_event_at: '2026-09-10T11:00:00.000Z' }), false);
    expect(again.direct).not.toHaveBeenCalled();
    expect(kept.result.tracking_provider).toBe('ParcelsApp');
  });
  describe('recognition of the carriers a number could belong to', () => {
    // A Swiss DPD depot prefix; the number is only a suggestion by shape.
    const swissDpd = '06080000000002';
    const notFound = (carrier: string) => new NotFoundError(carrier);
    const knows = (...carriers: string[]) => async (carrier: string) => ({ known: carriers.includes(carrier) });
    const asked = (recognize: ReturnType<typeof vi.fn>) => recognize.mock.calls.map(([carrier]) => carrier);
    it('recovers an already saved compact PostLogistics number filed as unknown', async () => {
      const { router, direct, universal, recognize } = setup();
      recognize.mockImplementation(knows('postlogistics'));
      direct.mockResolvedValue(directValue('postlogistics'));

      const result = await router.fetch(parcel({ tracking_number: '12345678002' }), false);

      expect(asked(recognize)).toContain('postlogistics');
      expect(direct).toHaveBeenCalledWith(expect.objectContaining({ tracking_number: '12345678002' }), 'postlogistics');
      expect(result.correction?.carrier).toBe('postlogistics');
      expect(universal).not.toHaveBeenCalled();
    });
    it('asks before the universals and adopts a carrier that tracks the parcel', async () => {
      const { router, direct, universal, recognize } = setup();
      recognize.mockImplementation(knows('dpd'));
      direct.mockImplementation(async (_lookup: JsonObject, carrier: string) => {
        if (carrier === 'asendia') throw notFound('Asendia');
        return directValue('dpd');
      });
      const result = await router.fetch(parcel({ carrier: 'asendia', tracking_number: swissDpd, dpd_postcode: null }), false);
      // Asked at once, number evidence first, then by popularity.
      expect(asked(recognize)).toEqual(['dpd', 'seur', 'brt', 'relais-colis', 'ciblex']);
      // Only the carrier that knows the number gets a full lookup, without borrowed inputs.
      expect(direct.mock.calls.map(([, carrier]) => carrier)).toEqual(['asendia', 'dpd']);
      expect(direct.mock.calls[1][0]).toMatchObject({ carrier: 'dpd', dpd_postcode: null, tracking_url: null });
      expect(universal).not.toHaveBeenCalled();
      expect(result.correction).toEqual({ carrier: 'dpd', trackingUrl: null, postcode: null });
      expect(result.result).toMatchObject({ auto_changed_from: 'asendia', auto_changed_to: 'dpd' });
    });
    it('orders the carriers by a universal hint, number evidence, then popularity', async () => {
      // A 14-digit number whose last digit passes the Hermes check.
      const hermesShape = '12345678901231';
      const first = setup();
      await first.router.fetch(parcel({ tracking_number: hermesShape }), false);
      expect(asked(first.recognize)).toEqual(['dpd', 'seur', 'brt', 'hermes-de', 'relais-colis']);
      // A universal that named a carrier needing a postcode puts it first; one
      // needing nothing was already looked up by the correction step.
      const hinted = setup();
      await hinted.router.fetch(parcel({ tracking_number: '12345678901',
        carrier_data: { routing: state({ discovered_carrier: 'gls-de' }) } }), false);
      expect(asked(hinted.recognize)).toEqual(['gls-de', 'gls-ch', 'postlogistics']);
      // Newly supported number shapes follow the same popularity order.
      const tnt = setup();
      await tnt.router.fetch(parcel({ tracking_number: '1000000000000001' }), false);
      expect(asked(tnt.recognize)).toEqual(['tnt', 'correos-express', 'dhl-ecommerce', 'canada-post']);
      expect(tnt.direct).not.toHaveBeenCalled();
      const austria = setup();
      await austria.router.fetch(parcel({ tracking_number: '1000000000000000000001' }), false);
      expect(asked(austria.recognize)).toEqual(['austrian-post']);
      expect(austria.direct).not.toHaveBeenCalled();
      // A number no recognizable carrier fits asks nobody.
      const other = setup();
      await other.router.fetch(parcel({ tracking_number: 'ZZUNMATCHED0001' }), false);
      expect(other.recognize).not.toHaveBeenCalled();
    });

    it('confirms Chronopost after a wrong carrier fails with a transport error', async () => {
      const { router, direct, universal, recognize } = setup();
      recognize.mockImplementation(knows('chronopost'));
      direct.mockImplementation(async (_lookup: JsonObject, carrier: string) => {
        if (carrier === 'dhl') throw new Error('upstream unavailable');
        return directValue('chronopost');
      });
      const result = await router.fetch(parcel({ carrier: 'dhl', tracking_number: 'HL123456789JB',
        tracking_url: 'https://private.invalid/capability', dpd_postcode: '8000' }), false);
      expect(asked(recognize)).toEqual(['chronopost']);
      expect(direct.mock.calls.map(([, carrier]) => carrier)).toEqual(['dhl', 'chronopost']);
      expect(direct.mock.calls[1][0]).toMatchObject({ tracking_url: null, dpd_postcode: null });
      expect(result.correction).toEqual({ carrier: 'chronopost', trackingUrl: null, postcode: null });
      expect(universal).not.toHaveBeenCalled();
    });

    it.each([
      ['RR123456785FI', 'posti', ['posti', 'chronopost']],
      ['XR123456785TS', 'chronopost', ['chronopost']],
      ['33870000000000001', 'dhl-ecommerce', ['dhl-ecommerce']],
      ['505600001', 'tnt', ['tnt']],
    ])('tracks %s through its confirmed carrier before a provider', async (number, carrier, candidates) => {
      const { router, direct, universal, recognize } = setup();
      recognize.mockImplementation(knows(carrier as string));
      direct.mockResolvedValue(directValue(carrier));
      const result = await router.fetch(parcel({ carrier: 'intl-post', tracking_number: number }), false);
      expect(asked(recognize)).toEqual(candidates);
      expect(direct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tracking_number: number }), carrier);
      expect(result.correction?.carrier).toBe(carrier);
      expect(universal).not.toHaveBeenCalled();
    });
    it('asks again within hours, outside the carrier failures', async () => {
      const { router, universal, recognize } = setup();
      const result = await router.fetch(parcel({ tracking_number: swissDpd }), false);
      expect(asked(recognize)).toEqual(['dpd', 'seur', 'brt', 'relais-colis', 'ciblex']);
      expect(universal).toHaveBeenCalled();
      const routing = result.result.routing as JsonObject & { failures: JsonObject; candidate_probes: JsonObject };
      expect(routing.candidate_probes).toEqual({
        dpd: { count: 1, retry_at: '2026-09-10T13:00:00.000Z' }, seur: { count: 1, retry_at: '2026-09-10T13:00:00.000Z' },
        brt: { count: 1, retry_at: '2026-09-10T13:00:00.000Z' }, 'relais-colis': { count: 1, retry_at: '2026-09-10T13:00:00.000Z' }, ciblex: { count: 1, retry_at: '2026-09-10T13:00:00.000Z' },
      });
      // The answers decide neither the parcel's status nor a carrier cooldown.
      expect(routing.failures).toEqual({});
      // Inside the cooldown the next check goes straight to the universals.
      const next = setup(new Date('2026-09-10T12:30:00Z'));
      const again = await next.router.fetch(parcel({ tracking_number: swissDpd, carrier_data: result.result }), false);
      expect(next.recognize).not.toHaveBeenCalled();
      // After it, a second miss doubles the wait.
      const later = setup(new Date('2026-09-10T13:05:00Z'));
      const third = await later.router.fetch(parcel({ tracking_number: swissDpd, carrier_data: again.result }), false);
      expect((third.result.routing as JsonObject & { candidate_probes: JsonObject }).candidate_probes)
        .toMatchObject({ dpd: { count: 2, retry_at: '2026-09-10T15:05:00.000Z' } });
    });
    it.each([
      ['a pre-advice only', { status: 'registered', current_stage: 'registered', last_update: '2026-09-10T11:00:00Z',
        events: [{ time: '2026-09-10T11:00:00Z', description: 'Order created', stage: 'registered' }] }],
      ['history older than what the parcel has', history('2026-09-09T11:00:00Z')],
    ])('does not adopt a carrier that knows the number with %s', async (_label, answer) => {
      const { router, direct, recognize } = setup();
      recognize.mockImplementation(knows('dpd'));
      direct.mockResolvedValue({ ...directValue('dpd'), result: answer as CarrierResult });
      const saved = { routing: state({ last_event_at: '2026-09-10T10:00:00Z' }) };
      const result = await router.fetch(parcel({ tracking_number: swissDpd, carrier_data: saved }), false);
      expect(result.correction).toBeUndefined();
      expect(result.result.tracking_provider).toBe('ParcelsApp');
      expect(result.result.routing).toMatchObject({ candidate_probes: { dpd: { count: 1 } }, failures: {} });
    });
    it('offers a carrier that needs the user\'s postcode instead of looking it up', async () => {
      const { router, direct, recognize } = setup();
      // Both GLS networks answer from the same overview: the more common one is offered.
      recognize.mockImplementation(knows('gls-ch', 'gls-de'));
      const result = await router.fetch(parcel({ tracking_number: '12345678901' }), false);
      expect(asked(recognize)).toEqual(['gls-ch', 'gls-de', 'postlogistics']);
      expect(direct).not.toHaveBeenCalled();
      expect(result.result.routing).toMatchObject({ input_needed: { carrier: 'gls-ch', field: 'dpdPostcode' } });
      expect(monitoring.reportRoutingEvent).toHaveBeenCalledWith('carrier_input_needed', expect.objectContaining({ provider: 'gls-ch' }));
      // Once the user files it under GLS with the postcode and it tracks, nothing is left to ask.
      const next = setup(new Date('2026-09-10T13:30:00Z'));
      next.direct.mockResolvedValue(directValue('gls-ch'));
      const tracked = await next.router.fetch(parcel({ carrier: 'gls-ch', dpd_postcode: '8000', tracking_number: '12345678901',
        carrier_data: result.result }), false);
      expect(tracked.result.routing).not.toHaveProperty('input_needed');
      // Nor once the carrier, asked again, no longer knows the number.
      const later = setup(new Date('2026-09-11T13:30:00Z'));
      const forgotten = await later.router.fetch(parcel({ tracking_number: '12345678901', carrier_data: result.result }), false);
      expect(asked(later.recognize)).toContain('gls-ch');
      expect(forgotten.result.routing).not.toHaveProperty('input_needed');
    });
    it.each([
      ['a delivered parcel', 'asendia', swissDpd, notFound('Asendia'), { current_stage: 'delivered' }],
      ['a parcel older than a month', 'asendia', swissDpd, notFound('Asendia'), { created_at: '2026-08-01T00:00:00Z' }],
      ['a linked journey', 'asendia', swissDpd, notFound('Asendia'),
        { carrier_data: { original_carrier: 'asendia', active_tracking_carrier: 'dpd', active_tracking_number: 'LOCAL1234' } }],
      ['a transient failure of the filed carrier', 'hermes-de', '12345678901231', new Error('timeout'), {}],
      ['a number the filed carrier already confirmed', 'hermes-de', '12345678901231', notFound('Hermes'),
        { carrier_data: { routing: state({ configured_carrier: 'hermes-de', confirmed_carrier: 'hermes-de', confirmed_number: '12345678901231' }) } }],
      ['another network of the filed brand', 'gls-de', '12345678901', notFound('GLS'), {}],
    ])('does not ask for %s', async (_label, carrier, trackingNumber, error, overrides) => {
      const { router, direct, recognize } = setup();
      direct.mockRejectedValue(error);
      await router.fetch(parcel({ carrier, tracking_number: trackingNumber, ...overrides }), false);
      expect(asked(recognize)).not.toContain(carrier === 'gls-de' ? 'gls-ch' : 'dpd');
    });

    it('retains a confirmed carrier even when the number shape points elsewhere', async () => {
      const { router, direct, recognize } = setup();
      direct.mockRejectedValue(new Error('upstream unavailable'));
      await router.fetch(parcel({ carrier: 'dhl', tracking_number: 'HL123456789JB', carrier_data: {
        routing: state({ configured_carrier: 'dhl', confirmed_carrier: 'dhl', confirmed_number: 'HL123456789JB' }),
      } }), false);
      expect(recognize).not.toHaveBeenCalled();
    });
    it('keeps recognition out of the health evidence of a check that reached nobody else', async () => {
      const { router, direct, health, recognize } = setup();
      recognize.mockImplementation(knows('dpd'));
      direct.mockRejectedValue(new Error('DPD down'));
      health.acquireTrackingProvider.mockResolvedValue({ token: null, retry_at: '2026-09-10T12:30:00Z' });
      await expect(router.fetch(parcel({ tracking_number: swissDpd }), false))
        .rejects.toMatchObject({ name: 'RoutingDeferredError', attempted: 0 });
      expect(recognize).toHaveBeenCalled();
      expect(direct).toHaveBeenCalledOnce();
    });
    it('confirms DPD named by an aggregator in the same check when recognition was not due', async () => {
      const { router, direct, universal, recognize } = setup();
      universal.mockResolvedValue({ ...history(), ...universalCarrierHints(['DPD Group'], swissDpd) });
      direct.mockResolvedValue(directValue('dpd'));
      const saved = { routing: state({ candidate_probes: {
        dpd: { count: 7, retry_at: '2026-09-11T11:00:00Z' }, seur: { count: 7, retry_at: '2026-09-11T11:00:00Z' },
        brt: { count: 7, retry_at: '2026-09-11T11:00:00Z' }, 'relais-colis': { count: 7, retry_at: '2026-09-11T11:00:00Z' }, ciblex: { count: 7, retry_at: '2026-09-11T11:00:00Z' },
      } }) };
      const result = await router.fetch(parcel({ tracking_number: swissDpd, carrier_data: saved }), false);
      expect(recognize).not.toHaveBeenCalled();
      expect(direct.mock.calls.map(([, carrier]) => carrier)).toEqual(['dpd']);
      expect(result.result).toMatchObject({ auto_changed_to: 'dpd' });
    });
    it('confirms DPD named by an aggregator for a parcel older than a month', async () => {
      const { router, direct, universal } = setup();
      universal.mockResolvedValue({ ...history(), ...universalCarrierHints(['DPD Group'], swissDpd) });
      direct.mockImplementation(async (_lookup: JsonObject, carrier: string) => {
        if (carrier === 'asendia') throw notFound('Asendia');
        return directValue('dpd');
      });
      const result = await router.fetch(parcel({ carrier: 'asendia', tracking_number: swissDpd, created_at: '2026-07-01T00:00:00Z' }), false);
      expect(universal).toHaveBeenCalledOnce();
      expect(direct.mock.calls.map(([, carrier]) => carrier)).toEqual(['asendia', 'dpd']);
      expect(result.result).toMatchObject({ auto_changed_from: 'asendia', auto_changed_to: 'dpd' });
    });
  });
  it('does not borrow verification inputs from another carrier', async () => {
    const { router, direct, universal } = setup();
    await router.fetch(parcel({ dpd_postcode: '8000', carrier_data: { routing: state({ discovered_carrier: 'mondial-relay' }) } }), false);
    expect(direct).not.toHaveBeenCalled();
    expect(universal).toHaveBeenCalledOnce();
    expect(monitoring.reportRoutingEvent).toHaveBeenCalledWith('carrier_input_required', expect.anything());
  });
  it.each([
    ['2026-09-10T12:00:00Z', '2026-09-10T11:01:00Z', true],
    ['2026-09-10T12:00:00Z', '2026-09-10T11:00:00Z', false],
    ['2026-09-10T23:00:00Z', '2026-09-10T20:01:00Z', true],
    ['2026-09-10T23:00:00Z', '2026-09-10T20:00:00Z', false],
  ])('defers a 429 at %s only for a successful retrieval at %s', async (now, success, fresh) => {
    const { router, direct, universal } = setup(new Date(now));
    direct.mockRejectedValue(new UpstreamHttpError('UPS', 429, 2 * 3_600_000));
    const task = router.fetch(parcel({ carrier: 'ups', carrier_data: { routing: state({ configured_carrier: 'ups', last_success_at: success }) } }), false);
    if (fresh) {
      await expect(task).rejects.toMatchObject({ name: 'RoutingDeferredError', stale: false });
      expect(universal).not.toHaveBeenCalled();
    } else await expect(task).resolves.toMatchObject({ result: { tracking_provider: 'ParcelsApp' } });
  });
  it('does not confuse a recent failed attempt with a successful retrieval', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new UpstreamHttpError('UPS', 429));
    await router.fetch(parcel({ carrier: 'ups', last_synced_at: '2026-09-10T11:59:00Z', sync_status: 'error' }), false);
    expect(universal).toHaveBeenCalledOnce();
  });
  it('skips a shared provider cooldown and tries a healthy provider', async () => {
    const { router, health, universal } = setup();
    health.acquireTrackingProvider.mockResolvedValueOnce({ token: null, retry_at: '2026-09-10T13:00:00Z' });
    await router.fetch(parcel(), false);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['Ship24']);
  });
  it('retains provider-specific Retry-After and stops cascading on a fresh universal 429', async () => {
    const { router, universal, health } = setup();
    universal.mockRejectedValue(new UpstreamHttpError('Ship24', 429, 2 * 3_600_000));
    await expect(router.fetch(parcel({ carrier_data: { routing: state({ preferred_provider: 'Ship24', last_success_at: '2026-09-10T11:30:00Z' }) } }), false))
      .rejects.toMatchObject({ stale: false, routing: { failures: { 'Ship24': { retry_at: '2026-09-10T14:00:00.000Z' } } } });
    expect(universal).toHaveBeenCalledOnce();
    expect(health.finishTrackingProvider).toHaveBeenCalledWith('Ship24', 'lease', 'rate_limited', 7_200_000, expect.any(Number));
  });
  it('never moves the freshness watermark past the time of the check', async () => {
    const { router, direct } = setup();
    // A scan read two hours late would otherwise make the next real update look older.
    direct.mockResolvedValue({ ...directValue(), result: history('2026-09-10T13:30:00Z') });
    const result = await router.fetch(parcel({ carrier: 'ups' }), false);
    expect(result.result.routing).toMatchObject({ last_event_at: time.toISOString() });
  });
  it('keeps provider circuits closed when providers answer without history for an unknown number', async () => {
    const { router, universal, health } = setup();
    universal.mockImplementation(async (source: string) => {
      throw source === 'Ship24' ? new NotFoundError(source)
        : source === '17TRACK' ? new UpstreamHttpError(source, 502)
          : new IndeterminateError(source, `${source} has no usable shipment history`);
    });
    await expect(router.fetch(parcel(), false)).rejects.toMatchObject({ routing: { failures: {
      Ship24: { kind: 'not_found' },
      ParcelsApp: { kind: 'no_history', retry_at: '2026-09-10T12:15:00.000Z' },
      '17TRACK': { kind: 'transport' },
    } } });
    // Only the HTTP 5xx says anything about a provider's own health.
    expect(health.finishTrackingProvider.mock.calls.map(([source, , kind]) => [source, kind])).toEqual([
      ['ParcelsApp', 'not_found'], ['Ship24', 'not_found'], ['17TRACK', 'transport'],
    ]);
  });
  it('reaches 17TRACK in the same check after the first two providers fail, then remembers it', async () => {
    const first = setup();
    first.universal.mockRejectedValueOnce(new Error('ParcelsApp down')).mockRejectedValueOnce(new Error('Ship24 down'));
    const result = await first.router.fetch(parcel(), false);
    expect(first.universal.mock.calls.map(([source]) => source)).toEqual(['ParcelsApp', 'Ship24', '17TRACK']);
    expect(result.result.routing).toMatchObject({ preferred_provider: '17TRACK' });
    const second = setup();
    await second.router.fetch(parcel({ carrier_data: result.result }), false);
    expect(second.universal.mock.calls.map(([source]) => source)).toEqual(['17TRACK']);
  });
  it('tries every enabled provider only once and includes Postal Ninja only when enabled', async () => {
    const { direct, universal, health } = setup();
    universal.mockRejectedValue(new Error('down'));
    for (const enablePostalNinja of [false, true]) {
      universal.mockClear();
      const router = new TrackingRouter({ direct, universal, health, now: () => time, enablePostalNinja });
      await expect(router.fetch(parcel(), false)).rejects.toBeInstanceOf(RoutingDeferred);
      expect(universal.mock.calls.map(([source]) => source)).toEqual(
        ['ParcelsApp', 'Ship24', ...(enablePostalNinja ? ['Postal Ninja'] : []), '17TRACK']);
    }
  });
  it('counts contacted providers so a check that reached nobody is not health evidence', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new Error('carrier down'));
    universal.mockRejectedValue(new Error('down'));
    await expect(router.fetch(parcel({ carrier: 'ups' }), false)).rejects.toMatchObject({ attempted: 4 });
    const cooling = Object.fromEntries(['ups', 'Ship24', 'ParcelsApp', '17TRACK']
      .map((provider) => [provider, { count: 1, kind: 'transport', retry_at: '2026-09-10T13:00:00.000Z' }]));
    direct.mockClear(); universal.mockClear();
    await expect(router.fetch(parcel({ carrier: 'ups', carrier_data: { routing: state({ configured_carrier: 'ups', failures: cooling }) } }), false))
      .rejects.toMatchObject({ attempted: 0, stale: false });
    expect(direct).not.toHaveBeenCalled();
    expect(universal).not.toHaveBeenCalled();
  });
  it('gives 17TRACK a usable budget even after slow direct and universal failures', async () => {
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const { router, direct, universal } = setup();
    direct.mockImplementation(async () => { elapsed += 90_000.125; throw new Error('slow carrier'); });
    universal.mockImplementation(async (source, _number, timeoutMs) => {
      expect(timeoutMs).toBeGreaterThanOrEqual(29_998);
      expect(Number.isInteger(timeoutMs)).toBe(true);
      if (source === '17TRACK') return history();
      elapsed += timeoutMs + 5_000.125;
      throw new Error('slow universal');
    });
    await expect(router.fetch(parcel({ carrier: 'dhl-ecommerce' }), false))
      .resolves.toMatchObject({ result: { tracking_provider: '17TRACK' } });
    expect(universal).toHaveBeenCalledTimes(3);
  });
  it("skips an unavailable provider without spending another provider's attempt", async () => {
    const { router, health, universal } = setup();
    health.acquireTrackingProvider.mockResolvedValueOnce({ token: null, retry_at: '2026-09-10T13:00:00Z' });
    universal.mockRejectedValueOnce(new Error('Ship24 down'));
    await expect(router.fetch(parcel(), false)).resolves.toMatchObject({ result: { tracking_provider: '17TRACK' } });
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['Ship24', '17TRACK']);
  });
  it('stops when a provider overruns the total fallback budget', async () => {
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const { router, universal } = setup();
    universal.mockImplementation(async () => { elapsed = 121_000; throw new Error('overrun'); });
    await expect(router.fetch(parcel(), false)).rejects.toBeInstanceOf(RoutingDeferred);
    expect(universal).toHaveBeenCalledOnce();
  });
  it('does one daily scheduled comparison and switches only for newer data', async () => {
    const { router, universal } = setup();
    universal.mockResolvedValueOnce(history('2026-09-10T10:00:00Z')).mockResolvedValueOnce(history('2026-09-10T11:00:00Z'));
    const result = await router.fetch(parcel({ carrier_data: { routing: state({ preferred_provider: 'Ship24', last_probe_at: '2026-09-08T12:00:00Z' }) } }), true);
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['Ship24', 'ParcelsApp']);
    expect(result.result.routing).toMatchObject({ preferred_provider: 'ParcelsApp', probe_cursor: 1 });
  });
  it.each([false, true])('keeps affinity on older alternative data (scheduled=%s)', async (scheduled) => {
    const { router, universal } = setup();
    universal.mockResolvedValueOnce(history()).mockResolvedValueOnce(history('2026-09-09T11:00:00Z'));
    const result = await router.fetch(parcel({ carrier_data: { routing: state({ preferred_provider: '17TRACK', last_probe_at: '2026-09-08T12:00:00Z' }) } }), scheduled);
    expect(result.result.routing).toMatchObject({ preferred_provider: '17TRACK' });
    expect(universal).toHaveBeenCalledTimes(scheduled ? 2 : 1);
  });
  it('does not throw away successful history when a shadow check fails', async () => {
    const { router, universal } = setup();
    universal.mockResolvedValueOnce(history()).mockRejectedValueOnce(new UpstreamHttpError('ParcelsApp', 429));
    await expect(router.fetch(parcel({ carrier_data: { routing: state({ preferred_provider: 'Ship24', last_probe_at: '2026-09-08T12:00:00Z', last_success_at: '2026-09-10T11:50:00Z' }) } }), true))
      .resolves.toMatchObject({ result: { tracking_provider: 'Ship24' } });
  });
  it('tries a new manual carrier, then recovers the previous confirmed route and its own inputs', async () => {
    const { router, direct } = setup(); direct.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(directValue('dpd'));
    const result = await router.fetch(parcel({ carrier: 'dhl', carrier_data: { routing: state({ configured_carrier: 'dpd',
      confirmed_carrier: 'dpd', confirmed_number: 'TEST1234', confirmed_postcode: '8000', last_success_at: '2026-09-10T11:00:00Z' }) } }), false);
    expect(direct.mock.calls.map(([, carrier]) => carrier)).toEqual(['dhl', 'dpd']);
    expect(direct.mock.calls[1][0].dpd_postcode).toBe('8000');
    expect(result.result.routing).toMatchObject({ configured_carrier: 'dpd', confirmed_carrier: 'dpd' });
  });
  it('keeps a prior confirmed route when the new choice has no direct support', async () => {
    const { router, direct, universal } = setup();
    const result = await router.fetch(parcel({ carrier: 'j-and-t', carrier_data: { routing: state({ configured_carrier: 'ups', confirmed_carrier: 'ups', confirmed_number: 'TEST1234' }) } }), false);
    expect(direct.mock.calls.map(([, carrier]) => carrier)).toEqual(['ups']);
    expect(universal).not.toHaveBeenCalled();
    expect(result.correction?.carrier).toBe('ups');
    expect(result.result.routing).toMatchObject({ configured_carrier: 'ups', confirmed_carrier: 'ups' });
  });
  it('does not adopt an old route for a different tracking number', async () => {
    const { router, direct } = setup();
    await router.fetch(parcel({ carrier_data: { routing: state({ confirmed_carrier: 'ups', confirmed_number: 'OTHER123' }) } }), false);
    expect(direct).not.toHaveBeenCalled();
  });
  it('uses the confirmed delivery-leg number for universal recovery', async () => {
    const { router, direct, universal } = setup(); direct.mockRejectedValue(new Error('delivery unavailable'));
    await router.fetch(parcel({ carrier: 'dhl', carrier_data: { original_carrier: 'dhl', active_tracking_carrier: 'swiss-post',
      active_tracking_number: 'LOCAL1234' } }), false);
    expect(universal).toHaveBeenCalledWith('ParcelsApp', 'LOCAL1234', expect.any(Number), null, 'Europe/Zurich');
  });
  it('forwards the stored delivery postcode to universal providers', async () => {
    const { router, universal } = setup();
    await router.fetch(parcel({ dpd_postcode: '8000' }), false);
    expect(universal).toHaveBeenCalledWith('ParcelsApp', 'TEST1234', expect.any(Number), '8000', null);
  });
  it('gives universal providers the parcel carrier\'s zone for scans without a trustworthy one', async () => {
    const { router, direct, universal } = setup(); direct.mockRejectedValue(new Error('carrier down'));
    await router.fetch(parcel({ carrier: 'dpd' }), false);
    expect(universal).toHaveBeenCalledWith('ParcelsApp', 'TEST1234', expect.any(Number), null, 'Europe/Zurich');
  });
  it.each(['ParcelsApp', 'Ship24'] as const)('gives %s the confirmed carrier\'s zone when the parcel carrier keeps UTC', async (provider) => {
    vi.spyOn(scraper, 'universalPlan').mockReturnValue({
      sources: [provider], carrier: null, tier: () => 'unknown', rank: () => 0,
    });
    const { router, direct, universal } = setup(); direct.mockRejectedValue(new Error('carrier down'));
    const confirmed = (number: string) => ({ routing: state({ configured_carrier: 'asendia', confirmed_carrier: 'dpd', confirmed_number: number }) });
    await router.fetch(parcel({ carrier: 'asendia', carrier_data: confirmed('TEST1234') }), false);
    expect(universal).toHaveBeenLastCalledWith(provider, 'TEST1234', expect.any(Number), null, 'Europe/Zurich');
    // A route confirmed for another number says nothing about this one.
    await router.fetch(parcel({ carrier: 'asendia', carrier_data: confirmed('OTHER123') }), false);
    expect(universal).toHaveBeenLastCalledWith(provider, 'TEST1234', expect.any(Number), null, null);
    // The parcel carrier's own zone still comes first.
    await router.fetch(parcel({ carrier: 'dhl', carrier_data: { routing: state({ configured_carrier: 'dhl', confirmed_carrier: 'dpd-fr', confirmed_number: 'TEST1234' }) } }), false);
    expect(universal).toHaveBeenLastCalledWith(provider, 'TEST1234', expect.any(Number), null, 'Europe/Berlin');
  });
  it.each([
    // Quickpac reports Swiss wall time without an offset; the stored events read it in Zurich.
    ['quickpac', '2026-07-01T08:00:00.000Z'],
    // A zone no test machine is likely to run in, so the process zone cannot pass for it.
    ['india-post', '2026-07-01T04:30:00.000Z'],
  ])('reads a naive local last update in its carrier\'s zone for the freshness watermark (%s)', async (carrier, watermark) => {
    const { router, direct } = setup(new Date('2026-07-01T12:00:00Z'));
    const local = '2026-07-01T10:00:00.000';
    direct.mockResolvedValue({ ...directValue(carrier), result: { status: 'in_transit', current_stage: 'in_transit', last_update: local,
      events: [{ time: local, description: 'In transit', stage: 'in_transit' }] } });
    const result = await router.fetch(parcel({ carrier }), false);
    expect(result.result.routing).toMatchObject({ last_event_at: watermark });
  });
  it('sends no postcode to universal providers when the parcel stores none', async () => {
    const { router, universal } = setup();
    await router.fetch(parcel(), false);
    expect(universal).toHaveBeenCalledWith('ParcelsApp', 'TEST1234', expect.any(Number), null, null);
  });
  it('fails closed when shared coordination is unavailable, with a persisted retry', async () => {
    const { router, health, universal } = setup(); health.acquireTrackingProvider.mockRejectedValue(new Error('db down'));
    await expect(router.fetch(parcel(), false)).rejects.toMatchObject({ routing: { next_check_at: '2026-09-10T12:15:00.000Z' } });
    expect(universal).not.toHaveBeenCalled();
  });
  it('keeps valid data if the health completion write fails', async () => {
    const { router, health } = setup(); health.finishTrackingProvider.mockRejectedValue(new Error('db down'));
    await expect(router.fetch(parcel(), false)).resolves.toMatchObject({ result: { tracking_provider: 'ParcelsApp' } });
  });
  it('checks cancellation before contacting a provider', async () => {
    const { router, universal } = setup();
    await expect(router.fetch(parcel(), false, AbortSignal.abort())).rejects.toThrow();
    expect(universal).not.toHaveBeenCalled();
  });
  it('computes Zurich day/night windows across DST and resets config-specific cooldowns', () => {
    expect(freshnessWindow(new Date('2026-12-10T06:59:00Z'))).toBe(10_800_000);
    expect(freshnessWindow(new Date('2026-12-10T07:00:00Z'))).toBe(3_600_000);
    expect(routingState(parcel({ carrier: 'ups', carrier_data: { routing: state({ next_check_at: '2027-01-01T00:00:00Z' }) } })).next_check_at).toBeUndefined();
  });
  it('does not guess a regional carrier from a brand or cross-border provider list', () => {
    expect(universalCarrierHints(['DHL']).discovered_carrier).toBeUndefined();
    // A bare brand resolves only when the number leaves one of its networks.
    expect(universalCarrierHints(['DPD Group'], '06080000000002')).toMatchObject({ discovered_carrier: 'dpd' });
    expect(universalCarrierHints(['DPD Group'], '06200000000002').discovered_carrier).toBeUndefined();
    expect(universalCarrierHints(['UPS', 'Swiss Post']).discovered_carrier).toBeUndefined();
    expect(universalCarrierHints(['UPS'])).toMatchObject({ discovered_carrier: 'ups' });
    expect(universalCarrierHints(['Posti'])).toMatchObject({ discovered_carrier: 'posti' });
    expect(universalCarrierHints(['La Poste', 'Posti']).discovered_carrier).toBeUndefined();
    expect(universalCarrierHints(['https://private/token'])).toEqual({ reported_carriers: [] });
    expect(universalCarrierHints(['Chronopost France'])).toMatchObject({ discovered_carrier: 'chronopost' });
    expect(universalCarrierHints(['Chronopost Portugal']).discovered_carrier).toBeUndefined();
  });
  it('reports only carrier names the catalog does not know, once per parcel', async () => {
    const { router, universal } = setup();
    const reported = ['La Poste', 'Posti', 'Finland Post', 'UPU', 'Universal Postal Union', 'Chronopost Portugal', 'DHL Express', 'Example Parcel Co'];
    universal.mockResolvedValue({ ...history(), reported_carriers: reported });
    const coverage = () => vi.mocked(monitoring.reportRoutingEvent).mock.calls
      .filter(([code]) => code === 'carrier_coverage_discovered').map(([, context]) => context.provider);
    const first = await router.fetch(parcel(), false);
    expect(coverage()).toEqual(['Example Parcel Co']);
    expect(first.result.routing).toMatchObject({ reported_carriers_seen: reported });
    vi.mocked(monitoring.reportRoutingEvent).mockClear();
    await router.fetch(parcel({ carrier_data: { routing: first.result.routing } }), false);
    expect(coverage()).toEqual([]);
  });

  it('marks a universal result the carrier answered too, without a time zone for its newest scan', async () => {
    const { router, direct } = setup();
    direct.mockResolvedValue(yearlessYamato());
    const answered = await router.fetch(parcel({ carrier: 'yamato', tracking_number: '123456789012' }), false);
    expect(answered.result).toMatchObject({ tracking_provider: 'Ship24', carrier_answered: true });
    // A carrier that failed did not answer.
    const failed = setup();
    failed.direct.mockRejectedValue(new Error('down'));
    const fallback = await failed.router.fetch(parcel({ carrier: 'yamato', tracking_number: '123456789012' }), false);
    expect(fallback.result.tracking_provider).toBe('Ship24');
    expect(fallback.result).not.toHaveProperty('carrier_answered');
  });
  it('ignores an older parcel of another carrier that a universal returns for a reused number', async () => {
    const { router, direct, universal } = setup();
    direct.mockResolvedValue(yearlessYamato());
    universal.mockResolvedValueOnce({ ...history('2026-01-09T13:19:00Z'), reported_carriers: ['FedEx', 'GLS'] });
    const result = await router.fetch(parcel({ carrier: 'yamato', tracking_number: '123456789012', created_at: '2026-09-01T00:00:00Z' }), false);
    expect(direct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tracking_number: '123456789012' }), 'yamato');
    // ParcelsApp is left out for Yamato: it answered a Yamato number with a FedEx parcel.
    expect(universal.mock.calls.map(([source]) => source)).toEqual(['Ship24', '17TRACK']);
    expect(result.result).toMatchObject({ tracking_provider: '17TRACK', last_update: '2026-09-10T11:00:00Z' });
    expect(result.result.direct_local_history).toMatchObject({ carrier: 'yamato', number: '123456789012',
      events: [{ provider_time_text: '09月01日 10:00', stage: 'accepted' }] });
    expect(result.result.routing).toMatchObject({ failures: { Ship24: { kind: 'no_history' } } });
    expect(vi.mocked(monitoring.reportRoutingEvent)).toHaveBeenCalledWith('foreign_history_rejected', expect.objectContaining({ provider: 'Ship24' }));
  });
  it.each([
    ['a name for the filed carrier', { carrier: 'yamato' }, ['Yamato Transport'], '2026-01-09T13:19:00Z'],
    ['a name the catalog does not know', { carrier: 'yamato' }, ['Example Parcel Co'], '2026-01-09T13:19:00Z'],
    ["only the postal union's feed", { carrier: 'yamato' }, ['UPU'], '2026-01-09T13:19:00Z'],
    ['no filed carrier', { carrier: 'unknown' }, ['FedEx'], '2026-01-09T13:19:00Z'],
    ['a recent history', { carrier: 'yamato' }, ['FedEx'], '2026-08-20T10:00:00Z'],
  ])('keeps a universal history with %s', async (_label, filed, reported, stamp) => {
    const { router, direct, universal } = setup();
    direct.mockResolvedValue(yearlessYamato());
    universal.mockResolvedValueOnce({ ...history(stamp), reported_carriers: reported });
    const result = await router.fetch(parcel({ ...filed, tracking_number: '123456789012', created_at: '2026-09-01T00:00:00Z' }), false);
    if (filed.carrier === 'yamato') {
      expect(direct).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tracking_number: '123456789012' }), 'yamato');
      expect(result.result.direct_local_history).toMatchObject({ carrier: 'yamato' });
    } else expect(direct).not.toHaveBeenCalled();
    expect(universal).toHaveBeenCalledTimes(1);
    expect(result.result).toMatchObject({ tracking_provider: universal.mock.calls[0][0], last_update: stamp });
  });

  it('asks a carrier whose answer has only local clocks again in 6 h, not on every check', async () => {
    const { router, direct } = setup();
    direct.mockResolvedValue(yearlessYamato());
    // A rate limit's cooldown that ended an hour ago must not keep the carrier due.
    const saved = state({ configured_carrier: 'yamato', preferred_provider: 'Ship24', direct_retry_at: '2026-09-10T11:00:00.000Z' });
    const filed = (routing: JsonObject) => parcel({ carrier: 'yamato', tracking_number: '123456789012', carrier_data: { routing } });
    const first = await router.fetch(filed(saved), true);
    expect(direct).toHaveBeenCalledOnce();
    expect(first.result).toMatchObject({ tracking_provider: 'Ship24', routing: { direct_retry_at: '2026-09-10T18:00:00.000Z' } });
    const later = setup(new Date('2026-09-10T12:30:00Z'));
    await later.router.fetch(filed(first.result.routing as JsonObject), true);
    expect(later.direct).not.toHaveBeenCalled();
    expect(later.universal).toHaveBeenCalledOnce();
  });

  it('keeps the origin watermark when a verified delivery partner confirms the same completion', async () => {
    const { router, direct, universal } = setup();
    direct.mockResolvedValue({ sourceCarrierId: 'posti', swissPostReady: null, handoffFallbackErrorType: null,
      earlierCarrierId: 'la-poste', earlierResult: { status: 'delivered', last_update: '2026-09-10T11:00:00Z' },
      result: { status: 'delivered', last_update: '2026-09-10T10:00:00Z',
        original_carrier: 'la-poste', active_tracking_carrier: 'posti', active_tracking_number: 'CW123456785FR' } });
    const result = await router.fetch(parcel({ carrier: 'la-poste', tracking_number: 'CW123456785FR' }), false);
    expect(result.result.routing).toMatchObject({ last_event_at: '2026-09-10T11:00:00.000Z' });
    expect(result.result.active_tracking_carrier).toBe('posti');
    expect(result.correction).toBeUndefined();
    expect(universal).not.toHaveBeenCalled();
  });
});

describe('coverage-based provider order', () => {
  const sources = (universal: ReturnType<typeof vi.fn>) => universal.mock.calls.map(([source]) => source);
  it('asks the providers with a carrier\'s fullest history first', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new Error('carrier down'));
    universal.mockRejectedValueOnce(new IndeterminateError('17TRACK', 'no history'));
    await router.fetch(parcel({ carrier: 'usps' }), false);
    // Only 17TRACK had USPS history; the others follow, HTTP first.
    expect(sources(universal)).toEqual(['17TRACK', 'ParcelsApp']);
  });
  it('orders by the carrier a provider discovered when the parcel has none', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new Error('carrier down'));
    await router.fetch(parcel({ carrier_data: { routing: state({ discovered_carrier: 'usps' }) } }), false);
    expect(sources(universal)).toEqual(['17TRACK']);
  });
  it('asks a fuller provider before the one a parcel stays with, within its own backoff', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new Error('carrier down'));
    // Ship24 was label-only for a UPS reference.
    const pinned = (extra: JsonObject = {}) => parcel({ carrier: 'ups', carrier_data: { routing: state({
      configured_carrier: 'ups', preferred_provider: 'Ship24', preferred_number: 'TEST1234', ...extra }) } });
    const moved = await router.fetch(pinned(), false);
    expect(sources(universal)).toEqual(['ParcelsApp']);
    expect(moved.result.routing).toMatchObject({ preferred_provider: 'ParcelsApp' });
    // Fuller providers without this parcel wait out their backoff while the parcel stays where it was.
    universal.mockClear().mockRejectedValueOnce(new IndeterminateError('ParcelsApp', 'no history'))
      .mockRejectedValueOnce(new IndeterminateError('17TRACK', 'no history'));
    const kept = await router.fetch(pinned(), false);
    expect(sources(universal)).toEqual(['ParcelsApp', '17TRACK', 'Ship24']);
    expect(kept.result.routing).toMatchObject({ preferred_provider: 'Ship24', failures: {
      ParcelsApp: { kind: 'no_history', retry_at: '2026-09-10T12:15:00.000Z' }, '17TRACK': { kind: 'no_history' } } });
    universal.mockClear();
    await router.fetch(parcel({ carrier: 'ups', carrier_data: kept.result }), false);
    expect(sources(universal)).toEqual(['Ship24']);
  });
  it('compares only with providers whose history for the carrier is as full', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new Error('carrier down'));
    const routing = state({ configured_carrier: 'ups', preferred_provider: 'ParcelsApp', preferred_number: 'TEST1234',
      last_probe_at: '2026-09-08T12:00:00Z' });
    for (const cursor of [0, 1]) {
      universal.mockClear();
      await router.fetch(parcel({ carrier: 'ups', carrier_data: { routing: { ...routing, probe_cursor: cursor } } }), true);
      // Never the label-only Ship24.
      expect(sources(universal)).toEqual(['ParcelsApp', '17TRACK']);
    }
  });
  it('logs results that contradict the coverage evidence', async () => {
    const { router, direct, universal } = setup();
    direct.mockRejectedValue(new Error('carrier down'));
    universal.mockRejectedValueOnce(new IndeterminateError('17TRACK', 'no history'));
    await router.fetch(parcel({ carrier: 'usps' }), false);
    expect(monitoring.reportRoutingEvent).toHaveBeenCalledWith('coverage_contradicted', expect.objectContaining({ provider: 'ParcelsApp', category: 'history' }));
    expect(monitoring.reportRoutingEvent).toHaveBeenCalledWith('coverage_contradicted', expect.objectContaining({ provider: '17TRACK', category: 'no_history' }));
    vi.mocked(monitoring.reportRoutingEvent).mockClear();
    // Without evidence for the carrier, nothing contradicts it.
    const other = setup();
    other.universal.mockRejectedValueOnce(new IndeterminateError('ParcelsApp', 'no history'));
    await other.router.fetch(parcel(), false);
    expect(monitoring.reportRoutingEvent).not.toHaveBeenCalledWith('coverage_contradicted', expect.anything());
  });
});

describe('routingFailure with carrier package errors', () => {
  it('classifies by error kind before falling back to status sniffing', async () => {
    const { routingFailure } = await import('./trackingRouting');
    const errors = await import('universal-parcel-scraper');
    expect(routingFailure(new errors.NotFoundError('CTT'))).toEqual({ kind: 'not_found', retryAfterMs: 0 });
    expect(routingFailure(new errors.RateLimitedError('Ship24', 30_000))).toEqual({ kind: 'rate_limited', retryAfterMs: 30_000 });
    expect(routingFailure(new errors.ChallengeError('UPS'))).toEqual({ kind: 'verification', retryAfterMs: 0 });
    expect(routingFailure(new errors.SchemaError('DHL'))).toEqual({ kind: 'schema', retryAfterMs: 0 });
    expect(routingFailure(new errors.InputRequiredError('Heppner', 'the delivery postcode'))).toEqual({ kind: 'input_required', retryAfterMs: 0 });
    expect(routingFailure(new errors.InvalidInputError('Evri', 'Evri requires a 16-character tracking number'))).toEqual({ kind: 'schema', retryAfterMs: 0 });
    expect(routingFailure(new errors.IndeterminateError('Colisweb'))).toEqual({ kind: 'transport', retryAfterMs: 0 });
    expect(routingFailure(new Error('wrapped', { cause: new errors.NotFoundError('CTT') }))).toEqual({ kind: 'not_found', retryAfterMs: 0 });
    // Errors outside the taxonomy keep the historical status-based classification.
    expect(routingFailure(Object.assign(new Error('legacy'), { status: 429, retryAfterMs: 1_000 }))).toEqual({ kind: 'rate_limited', retryAfterMs: 1_000 });
    expect(routingFailure(new TypeError('bad payload'))).toEqual({ kind: 'schema', retryAfterMs: 0 });
  });
});

describe('universal preflight and recipient input', () => {
  it('labels prefetched provider history without waiting for blocked direct confirmation', async () => {
    const value = setup();
    value.router.options.takePrefetchedUniversal = vi.fn((source) => source === 'Ship24' ? { ...history(),
      discovered_carrier: 'dhl-express', reported_carriers: ['DHL Express'] } : undefined);
    const result = await value.router.fetch(parcel({ tracking_number: '1234567891' }), false);
    expect(result.correction).toEqual({ carrier: 'dhl-express', trackingUrl: null, postcode: null });
    expect(result.sourceCarrierId).toBe('unknown');
    expect(result.result.tracking_provider).toBe('Ship24');
    expect(result.result.routing).toMatchObject({ configured_carrier: 'dhl-express' });
    expect(result.result.routing).not.toHaveProperty('confirmed_carrier');
    expect(result.result).not.toHaveProperty('auto_changed_from');
    expect(value.direct).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'ups'])('keeps provider history and changes only an unknown carrier: %s', async (carrier) => {
    const value = setup();
    value.direct.mockRejectedValue(new Error('carrier blocked'));
    value.universal.mockResolvedValue({ ...history(), discovered_carrier: 'dhl-express', reported_carriers: ['DHL Express'] });
    const result = await value.router.fetch(parcel({ carrier, tracking_number: '1234567891' }), false);
    expect(result.correction?.carrier).toBe(carrier === 'unknown' ? 'dhl-express' : undefined);
    expect(result.result.tracking_provider).toBe('Ship24');
    expect(result.result.routing).not.toHaveProperty('confirmed_carrier');
  });

  it('reuses a matching history before acquiring an upstream lease', async () => {
    const value = setup();
    value.router.options.takePrefetchedUniversal = vi.fn((source) => source === 'Ship24' ? { ...history(), discovered_carrier: 'dhl-express' } : undefined);
    const result = await value.router.fetch(parcel({ tracking_number: '1234567891' }), false);
    expect(result.result.tracking_provider).toBe('Ship24');
    expect(value.health.acquireTrackingProvider).not.toHaveBeenCalled();
    expect(value.universal).not.toHaveBeenCalled();
    expect(value.recognize).not.toHaveBeenCalled();
    expect(value.recognizeBrowser).not.toHaveBeenCalled();
    expect(value.direct).not.toHaveBeenCalled();
  });
  it('retains an explicit postcode requirement and keeps it out of global failure cooldowns', async () => {
    const value = setup();
    value.universal.mockImplementation(async (source) => { if (source === 'ParcelsApp') throw new InputRequiredError(source, 'postcode'); throw new NotFoundError(source); });
    const error = await value.router.fetch(parcel({ tracking_number: '1234567891' }), false).catch((error) => error);
    expect(error).toBeInstanceOf(RoutingDeferred);
    expect(error.routing).toMatchObject({ provider_input_needed: { provider: 'ParcelsApp', field: 'dpdPostcode' }, failures: { ParcelsApp: { kind: 'input_required' } } });
    expect(value.health.finishTrackingProvider.mock.calls.every((call) => call[2] === 'not_found')).toBe(true);
  });
  it('submits provider credentials only for their bound number and clears the prompt after recovery', async () => {
    const matching = setup();
    const result = await matching.router.fetch(parcel({ tracking_number: '1234567891', dpd_postcode: '9999', carrier_data: {
      universal_input: { number: '1234567891', postcode: '8000' },
      routing: { version: 1, provider_input_needed: { provider: 'ParcelsApp', field: 'dpdPostcode' } },
    } }), false);
    expect(matching.universal).toHaveBeenCalledWith('Ship24', '1234567891', expect.any(Number), '8000', null);
    expect(result.result.routing).not.toHaveProperty('provider_input_needed');
    const foreign = setup();
    await foreign.router.fetch(parcel({ tracking_number: '1234567891', carrier_data: { universal_input: { number: '1234567880', postcode: '8000' } } }), false);
    expect(foreign.universal).toHaveBeenCalledWith('Ship24', '1234567891', expect.any(Number), null, null);
  });
});
