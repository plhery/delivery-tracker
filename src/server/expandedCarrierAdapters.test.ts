// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOOP_RECORDER } from '@carriers/core/telemetry';
import type { CarrierResult } from '@carriers/core/result';
import type { TrawlClient } from '@carriers/core/transport';
import { createAdapterRegistry } from './adapterRegistry';
import { buildEvents, CarrierTrackingAdapter } from './trackingSync';
import { TrackingRouter } from './trackingRouting';
import { captureDirectLocalHistory, directLocalHistory, hasUnresolvedDirectCurrent, hasUnresolvedDirectHistory } from './directLocalHistory';
import type { UniversalTracker } from '@carriers/providers/universal';
import * as observability from './observability';
import { CorreiosOcr } from '@carriers/carriers/correios-br/ocr';
import { UkrposhtaTracker } from '@carriers/carriers/ukrposhta/adapter';
import { parseUkrposhtaHistory, parseUkrposhtaOverview } from '@carriers/carriers/ukrposhta/parser';
import * as yundaChallenge from '@carriers/carriers/yunda/challenge';

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
];

function setup(entry: typeof cases[number], transform = (body: string) => body) {
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
  if (entry.carrier === 'spring-gds') {
    const value = JSON.parse(body);
    value.data.items[0].events[0].country_code = 'US';
    value.data.items[0].events[0].country_name = 'United States';
    body = JSON.stringify(value);
  }
  if (entry.carrier === 'uniuni') {
    const value = JSON.parse(body);
    delete value.data.valid_tno[0].spath_list.at(-1).dateTime.ts;
    body = JSON.stringify(value);
  }
  if (entry.carrier === 'ctt-express') {
    const value = JSON.parse(body);
    value.data.shipping_history.events.at(-1).event_date = '2026-01-04T10:00:00';
    body = JSON.stringify(value);
  }
  if (entry.carrier === 'pos-malaysia') {
    body = JSON.stringify({ code: 'S0000', message: 'Success', data: [JSON.parse(body)] });
  }
  if (entry.carrier === 'seur') {
    const value = JSON.parse(body);
    value.situaciones[0].fecha = '2026-01-23T13:13:05';
    body = JSON.stringify(value);
  }
  if (entry.carrier === 'landmark-global') body = body.replace(/<input id="utc_server_offset"[^>]*>/, '');
  if (entry.carrier === 'nz-post') {
    const value = JSON.parse(body);
    value.results[0].tracking_events.at(-1).date_time = '2026-01-05T10:00:00';
    body = JSON.stringify(value);
  }
  if (entry.carrier === 'gofo') {
    const value = JSON.parse(body);
    value.data.success[0].trackEventList[0].processDate = '2026-01-04T12:00:00.000';
    value.data.success[0].lastTrackEvent.processDate = '2026-01-04T12:00:00.000';
    body = JSON.stringify(value);
  }
  if (entry.carrier === 'ecoscooting') {
    const value = JSON.parse(body);
    delete value.statuses[0].opTimestamp;
    body = JSON.stringify(value);
  }
  if (entry.carrier === 'the-courier-guy') {
    const value = JSON.parse(body);
    value.shipments[0].tracking_events[0].date = '2026-01-06T12:00:00';
    body = JSON.stringify(value);
  }
  if (entry.carrier === 'bring-posten') {
    const value = JSON.parse(body);
    const parcel = value.consignmentWithDomainAsync.packageSet[0];
    parcel.eventSet[0].dateIso = parcel.domain.latestSignificantEvent.dateIso = '2026-01-06T12:00:00';
    body = JSON.stringify(value);
  }
  if (entry.carrier === 'canada-post') {
    const value = JSON.parse(body);
    delete value.events[0].datetime.zoneOffset;
    body = JSON.stringify(value);
  }
  body = transform(body);
  if (entry.carrier === 'ukrposhta') {
    const payload = JSON.parse(body);
    vi.spyOn(UkrposhtaTracker.prototype, 'fetch').mockResolvedValue(
      parseUkrposhtaHistory(payload.history, parseUkrposhtaOverview(payload.overview, entry.number)));
  }
  if (entry.carrier === 'correios-br') vi.spyOn(CorreiosOcr.prototype, 'solve').mockResolvedValue('abcd');
  if (entry.carrier === 'yunda') vi.spyOn(yundaChallenge, 'solveYundaSlider').mockResolvedValue({ x: 100, y: 40 });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => {
    if (entry.carrier === 'nacex') {
      if (String(url).endsWith('/irSeguimiento.do')) {
        return new Response('<form name="seguimientoFormulario" method="post" action="/seguimientoFormulario.do"><input name="agencia_origen"><input name="numero_albaran"></form>',
          { headers: { 'set-cookie': 'JSESSIONID=synthetic-session; Path=/' } });
      }
      if (String(url).endsWith('/seguimientoFormulario.do')) {
        return new Response(null, { status: 302, headers: {
          location: '/seguimientoDetalle.do?agencia_origen=9900&numero_albaran=99000002&estado=1&internacional=0&externo=N&usr=null&pas=null',
        } });
      }
      return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (entry.carrier === 'estafeta' && String(url).endsWith('/GetTrackingItemHistory')) {
      return new Response(readFileSync(new URL('../../packages/carriers/carriers/estafeta/fixtures/delivered-history.html', import.meta.url), 'utf8'));
    }
    if (entry.carrier === 'poczta-polska' && String(url) === 'https://emonitoring.poczta-polska.pl/') {
      return new Response(readFileSync(new URL('../../packages/carriers/carriers/poczta-polska/fixtures/bootstrap.html', import.meta.url), 'utf8'));
    }
    if (entry.carrier === 'spring-gds' && String(url).endsWith('/auth/token')) return Response.json({ access_token: 'synthetic-visitor-token' });
    if (entry.carrier === 'yunda') {
      if (String(url).includes('/captcha_type?')) return Response.json({ code: 200, data: 1 });
      if (String(url).includes('/captcha?')) return Response.json({ code: 200, data: {} });
    }
    if (entry.carrier === 'correios-br') {
      if (String(url).includes('/app/index.php')) return new Response('<html>Tracking</html>');
      if (String(url).includes('/securimage_show.php')) return new Response('synthetic image', { headers: { 'content-type': 'image/png' } });
    }
    if (entry.carrier === 'aramex' && String(url).includes('/track/shipments')) {
      return new Response(`<a class="shipment-card" href="/track/details?q=synthetic"><div class="shipment-num"><h5>${entry.number}</h5></div></a>`);
    }
    return new Response(body, { headers: { 'content-type': entry.carrier === 'brt' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8' } });
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
    expect(test.fetcher).toHaveBeenCalledTimes(['yunexpress', 'ukrposhta'].includes(entry.carrier) ? 0 : ['aramex', 'spring-gds', 'poczta-polska', 'estafeta'].includes(entry.carrier) ? 2 : ['correios-br', 'yunda', 'nacex'].includes(entry.carrier) ? 3 : 1);
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

  it.each(['yto', 'correios-br', 'yunda'])('archives an unresolved %s current clock and asks providers for dated progress', async carrier => {
    const entry = cases.find(entry => entry.carrier === carrier)!;
    const test = setup(entry, (body) => {
      const payload = JSON.parse(body);
      if (carrier === 'yto') payload[0].waybillProcessInfo[0].opTime = '2026-02-30 18:00:00';
      else if (carrier === 'correios-br') payload.eventos[0].dtHrCriado.date = '2026-02-30 18:00:00';
      else payload.data.logistic[entry.number].gn.at(-1).scanTm = '2026-02-30 18:00:00';
      return JSON.stringify(payload);
    });
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
    expect(value.result).toMatchObject({ tracking_provider: 'Ship24', direct_local_history: {
      carrier, events: expect.arrayContaining([expect.objectContaining({ provider_time_text: '2026-02-30 18:00:00' })]),
    } });
  });

  it.each(['ontrac', 'aramex'])('%s asks providers when the current scan has no clock at all', async carrier => {
    vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => undefined);
    const entry = cases.find(entry => entry.carrier === carrier)!;
    const test = setup(entry, body => {
      if (carrier === 'aramex') return body.replaceAll(/<span class="(?:date|time)">[^<]*<\/span>/g, '');
      const payload = JSON.parse(body);
      delete payload.Packages[0].Events[0].ZonedEventDateTime;
      return JSON.stringify(payload);
    });
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
    expect(value.result).toMatchObject({ tracking_provider: 'Ship24', direct_local_history: {
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
    const direct = await setup(entry, body => {
      const payload = JSON.parse(body);
      payload.data[0].process_status = 'DELIVERED';
      return JSON.stringify(payload);
    }).adapter.fetch(entry.carrier, entry.number, null);
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
    const test = setup(entry, body => {
      const payload = JSON.parse(body);
      const item = payload.ResultList[0];
      for (const group of item.TrackData.ProcessGroupList) {
        for (const scan of group.ProcessDetailList) scan.ProcessDate += '-04:00';
      }
      item.TrackInfo.LastTrackEvent.ProcessDate += '-04:00';
      item.TrackInfo.LastTrackEvent.ProcessLocation = 'Different facility';
      return JSON.stringify(payload);
    });
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
    expect(value.result).toMatchObject({ tracking_provider: 'Ship24', events: providerEvents,
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
    for (const [wording, stage] of [['RTO Booked', 'exception'], ['In Transit', 'in_transit'], ['Out For Delivery', 'out_for_delivery'], ['Delivered', 'returned']]) {
      const test = setup(entry, body => {
        const payload = JSON.parse(body);
        Object.assign(payload.data, { type: 'rto', status_external: wording, current_event_description: wording, timestamp: 1767790800000 });
        return JSON.stringify(payload);
      });
      const result = await test.adapter.fetch(entry.carrier, entry.number, null);
      expect(result.current_stage).toBe(stage);
      expect(result).not.toHaveProperty('delivered_at');
      expect(buildEvents({ carrier: entry.carrier }, result)).toEqual(expect.arrayContaining([
        expect.objectContaining({ stage, raw_data: expect.objectContaining({ provider_leg: 'return' }) }),
      ]));
    }
  });
});
