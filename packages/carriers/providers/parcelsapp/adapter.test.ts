// @vitest-environment node
import { readFileSync } from 'node:fs';
import timers from 'node:timers/promises';
import { DateTime } from 'luxon';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrawlClient } from '../../core/transport';
import { carrierErrorKind, NoHistoryError } from '../../core/errors';
import type { LookupRecord, StepRecord, StepRecorder } from '../../core/telemetry';
import { ParcelsAppTracker, parseParcelsAppHtml, parseParcelsAppResponse } from './adapter';

const number = 'ZZ12345678900';
const API = 'https://parcelsapp.com/api/v2/parcels';
const announced = JSON.parse(readFileSync(new URL('./fixtures/announced.json', import.meta.url), 'utf8')) as { states: unknown[] };
const undatedLeg = JSON.parse(readFileSync(new URL('./fixtures/undated-leg.json', import.meta.url), 'utf8')) as { carriers: string[]; states: Record<string, unknown>[] };

/** The result table the page renders; the API reply itself carries no number. */
const identity = (value = number) => `<div class="tracking-info"><div class="parcel"><table class="parcel-attributes"><tr><td>Tracking number</td><td>${value}</td></tr></table></div></div>`;
const rendered = (rows: string) => identity().replace('</table>', `</table><ul class="events">${rows}</ul>`);
const row = (date: string, time: string, description: string) =>
  `<li class="event"><div class="event-time"><strong>${date}</strong><span>${time}</span></div><div class="event-content"><strong>${description}</strong></div></li>`;
const carrierRow = (date: string, time: string, description: string, carrier: string) =>
  `<li class="event"><div class="event-time"><strong>${date}</strong><span>${time}</span></div><div class="event-content"><strong>${description}</strong><div class="carrier"><div class="courier-icon"></div> ${carrier} </div></div></li>`;

const captured = (data: unknown, overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
  url: `https://parcelsapp.com/en/tracking/${number}`, html: identity(), statusCode: 200, tier: 3,
  capturedResponses: [{ url: API, body: JSON.stringify(data), status: 200, truncated: false, base64Encoded: false }],
  ...overrides,
}));

function tracker(fetcher: typeof fetch, trawlUrl = 'http://browser.test') {
  return new ParcelsAppTracker({ httpClient: null, trawl: new TrawlClient(trawlUrl, fetcher) });
}

describe('ParcelsApp YTO scans', () => {
  // YTO's scan types as ParcelsApp relays them, in Chinese or in its own translation.
  const labels = {
    chinese: ['揽收扫描', '装件入车扫描', '下车扫描', '派件扫描', '入柜|入库', 'PDA正常签收扫描', '退回件扫描'],
    english: ['Pickup scan', 'Load scan into vehicle', 'Get off scan', 'Delivery scan', 'In cabinet | In storage', 'PDA normal delivery scan', 'Return package scan'],
  };
  // ParcelsApp labels the scans' China wall clock as UTC.
  const states = (names: string[], order: number[]) => order.map((index, position) => ({
    date: `2026-05-0${position + 1}T18:00:00Z`, status: names[index], carrier: 0,
  })).reverse();
  const history = (language: keyof typeof labels, order: number[]) =>
    parseParcelsAppResponse({ carriers: ['YTO Express'], states: states(labels[language], order) }, number, identity());

  it('gives both label languages the same stages and stored wording', () => {
    const chinese = history('chinese', [0, 1, 2, 3, 4, 5]);
    expect(history('english', [0, 1, 2, 3, 4, 5]).events).toEqual(chinese.events);
    expect(chinese).toMatchObject({ status: 'delivered', current_stage: 'delivered' });
    expect(chinese.events?.map((event) => [event.time, event.description, event.stage])).toEqual([
      ['2026-05-06T10:00:00.000Z', 'Delivered', 'delivered'],
      ['2026-05-05T10:00:00.000Z', 'In a parcel locker or pickup station', 'ready_for_pickup'],
      ['2026-05-04T10:00:00.000Z', 'Out for delivery', 'out_for_delivery'],
      ['2026-05-03T10:00:00.000Z', 'Unloaded at a sorting centre', 'in_transit'],
      ['2026-05-02T10:00:00.000Z', 'Loaded for transport', 'in_transit'],
      ['2026-05-01T10:00:00.000Z', 'Picked up', 'accepted'],
    ]);
  });

  it.each(['chinese', 'english'] as const)('reads the delivery-side scans after a return scan as the trip back (%s)', (language) => {
    const returned = history(language, [0, 1, 6, 3, 4, 5]);
    expect(returned).toMatchObject({ status: 'exception', current_stage: 'returned', last_status_text: 'Returned to the sender' });
    expect(returned.events?.slice(0, 4).map((event) => [event.description, event.stage])).toEqual([
      ['Returned to the sender', 'returned'],
      ['In a parcel locker or station on its way back', 'ready_for_pickup'],
      ['Out for delivery back to the sender', 'out_for_delivery'],
      ['Return to the sender started', 'exception'],
    ]);
  });

  it.each(['chinese', 'english'] as const)('keeps return transit open before sender delivery (%s)', language => {
    expect(history(language, [0, 1, 6])).toMatchObject({ status: 'exception', current_stage: 'exception' });
    expect(history(language, [0, 1, 6, 3])).toMatchObject({ status: 'out_for_delivery', current_stage: 'out_for_delivery' });
    expect(history(language, [0, 1, 6, 3, 4])).toMatchObject({ status: 'out_for_delivery', current_stage: 'ready_for_pickup' });
    expect(history(language, [0, 1, 6, 3, 4]).events?.[0]).toMatchObject({ provider_leg: 'return' });
  });

  it('leaves labels of other carriers and unknown YTO labels to the shared rules', () => {
    const other = parseParcelsAppResponse({ carriers: ['Example Parcel Co'], states: [{ date: '2026-05-01T18:00:00Z', status: '派件扫描', carrier: 0 }] }, number, identity());
    expect(other.events?.[0]).toMatchObject({ description: '派件扫描', stage: 'pending' });
    const unknown = parseParcelsAppResponse({ carriers: ['YTO Express'], states: [{ date: '2026-05-01T18:00:00Z', status: '问题件扫描', carrier: 0 }] }, number, identity());
    expect(unknown.events?.[0]).toMatchObject({ description: '问题件扫描', stage: 'pending' });
  });

  it('reads the same scans from the rendered page', () => {
    const scan = (day: string, description: string) =>
      `<li class="event"><div class="event-time"><strong>0${day} May 2026</strong><span>18:00</span></div><div class="event-content"><strong>${description}</strong><span class="carrier">YTO Express</span></div></li>`;
    const page = rendered([scan('2', 'PDA正常签收扫描'), scan('1', '揽收扫描')].join(''));
    expect(parseParcelsAppHtml(page, number).events?.map((event) => [event.time, event.description, event.stage])).toEqual([
      ['2026-05-02T10:00:00.000Z', 'Delivered', 'delivered'],
      ['2026-05-01T10:00:00.000Z', 'Picked up', 'accepted'],
    ]);
  });
});

describe('ParcelsApp result parsing', () => {
  it('does not treat postal-code prompts or delivery preferences as movement', () => {
    const result = parseParcelsAppResponse(announced, number, identity());
    expect(result).toMatchObject({ status: 'pending', current_stage: 'registered', tracking_provider: 'ParcelsApp' });
    expect(result.events).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(() => parseParcelsAppResponse({ states: [{ date: '2026-08-18T00:00:00Z', status: 'Enter the recipient postal code', require_fields: [{}] }] }, number, identity())).toThrow();
  });

  it.each(['json', 'html'])('classifies French preparation and carrier acceptance separately (%s)', (transport) => {
    // Synthetic identifier, dates and depot; preserve only the wording that caused the bug.
    const states = [
      { date: '2026-01-05T08:30:00Z', status: 'Prise en charge de votre colis sur notre site logistique de VILLE-EXEMPLE.' },
      { date: '2026-01-04T09:15:00Z', status: "Colis en préparation chez l'expéditeur" },
    ];
    const parsed = transport === 'json' ? parseParcelsAppResponse({ states }, number, identity())
      : parseParcelsAppHtml(rendered(row('05 Jan 2026', '08:30', states[0].status) + row('04 Jan 2026', '09:15', states[1].status)), number);
    expect(parsed).toMatchObject({ status: 'in_transit', current_stage: 'accepted',
      last_update: '2026-01-05T08:30:00.000Z', tracking_provider: 'ParcelsApp' });
    expect(parsed.events?.map(({ stage }) => stage)).toEqual(['accepted', 'registered']);
    const preparationOnly = parseParcelsAppResponse({ states: [states[1]] }, number, identity());
    expect(preparationOnly).toMatchObject({ status: 'pending', current_stage: 'registered' });
  });

  it.each(['json', 'html'])('reads the TIPSA labels it relays twice over (%s)', (transport) => {
    // TIPSA's wording, written twice as its own page shows it; synthetic dates and agency.
    const scans = [
      ['08', '18:50', 'ENTREGADO'],
      ['07', '08:30', 'REPARTO'],
      ['06', '15:00', 'Ausente'],
      ['06', '08:30', 'REPARTO'],
      ['05', '17:20', 'LECTURA EN AGENCIA DESTINO EJEMPLO 01'],
      ['05', '17:10', 'LEIDO EN DESTINO'],
      ['02', '22:20', 'TRANSITO'],
      ['02', '17:50', 'PENDIENTE DE ENTREGAR A TIPSA'],
    ];
    const parsed = transport === 'json'
      ? parseParcelsAppResponse({ carriers: ['TIPSA'], states: scans.map(([day, time, label]) => ({
        date: `2026-05-${day}T${time}:00Z`, status: label + label, carrier: 0,
      })) }, number, identity())
      : parseParcelsAppHtml(rendered(scans.map(([day, time, label]) => carrierRow(`${day} May 2026`, time, label + label, 'TIPSA')).join('')), number);
    expect(parsed).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_status_text: 'Delivered' });
    // TIPSA's history is on Madrid time, Portuguese agencies included.
    expect(parsed.events?.map(({ time, description, stage }) => [time, description, stage])).toEqual([
      ['2026-05-08T16:50:00.000Z', 'Delivered', 'delivered'],
      ['2026-05-07T06:30:00.000Z', 'REPARTO', 'out_for_delivery'],
      ['2026-05-06T13:00:00.000Z', 'Ausente', 'failed_attempt'],
      ['2026-05-06T06:30:00.000Z', 'REPARTO', 'out_for_delivery'],
      ['2026-05-05T15:20:00.000Z', 'LECTURA EN AGENCIA DESTINO EJEMPLO 01', 'in_transit'],
      ['2026-05-05T15:10:00.000Z', 'LEIDO EN DESTINO', 'in_transit'],
      ['2026-05-02T20:20:00.000Z', 'TRANSITO', 'in_transit'],
      ['2026-05-02T15:50:00.000Z', 'PENDIENTE DE ENTREGAR A TIPSA', 'registered'],
    ]);
  });

  it('collapses only a label made of two identical halves', () => {
    const parsed = parseParcelsAppResponse({ states: [
      { date: '2026-05-02T10:00:00Z', status: 'ENTREGADOENTREGADA' },
      { date: '2026-05-01T10:00:00Z', status: 'REPARTO REPARTO' },
    ] }, number, identity());
    expect(parsed.events?.map(({ description }) => description)).toEqual(['ENTREGADOENTREGADA', 'REPARTO REPARTO']);
  });

  it('binds a numberless response to its rendered result', () => {
    for (const html of [identity('OTHER123'), `<input value="${number}">`, identity() + identity()]) {
      expect(() => parseParcelsAppResponse(announced, number, html)).toThrow('identity missing');
    }
  });

  it('rejects malformed timestamps and error-only responses', () => {
    // Unlike a missing date, a malformed one fails the reply, even beside dated scans.
    for (const date of ['today', '2026-02-31T03:04:00', '2026-02-31T03:04:00Z']) {
      const states = [{ date, status: 'Delivered' }, { date: '2026-08-17T03:04:00Z', status: 'In transit' }];
      expect(() => parseParcelsAppResponse({ states }, number, identity())).toThrow();
    }
    expect(() => parseParcelsAppResponse({ error: 'NO_TRACKER', states: [] }, number, identity())).toThrow();
  });

  it('counts a state without a date instead of failing the reply or reading it as the latest scan', () => {
    // Live shape (2026-09-29): an Asendia Spain leg with no date after dated US scans.
    const undated = undatedLeg.states.find((state) => !('date' in state))!;
    const dated = undatedLeg.states.filter((state) => state !== undated);
    for (const states of [undatedLeg.states, [{ ...undated, date: null, status: 'Delivered' }, ...dated]]) {
      const parsed = parseParcelsAppResponse({ ...undatedLeg, states }, number, identity());
      expect(parsed).toMatchObject({ status: 'in_transit', current_stage: 'in_transit', last_status_text: 'Dispatched by Asendia',
        last_update: '2026-03-10T18:10:00.000Z', undated_event_count: 1 });
      expect(parsed.events?.map((scan) => scan.time)).toEqual(dated.map((state) => DateTime.fromISO(String(state.date)).toUTC().toISO()));
    }
    expect(() => parseParcelsAppResponse({ ...undatedLeg, states: [undated] }, number, identity())).toThrow('No usable tracking events');
  });

  it('counts an offset-less date that no zone resolves, and places one that a zone resolves', () => {
    const states = [
      { date: '2026-03-11T09:00:00', status: 'Out for delivery' },
      { date: '2026-03-10T18:10:00Z', status: 'Departed from the sorting centre' },
    ];
    // A later wall time with no zone is no instant, so it cannot become the newest scan.
    expect(parseParcelsAppResponse({ states }, number, identity())).toMatchObject({ current_stage: 'in_transit',
      last_update: '2026-03-10T18:10:00.000Z', undated_event_count: 1, events: [{ description: 'Departed from the sorting centre' }] });
    const placed = parseParcelsAppResponse({ states }, number, identity(), 'Europe/Zurich');
    expect(placed).toMatchObject({ current_stage: 'out_for_delivery', last_update: '2026-03-11T08:00:00.000Z' });
    expect(placed.undated_event_count).toBeUndefined();
  });

  it('reads the undated state the page prints as "aN Inv NaN" as the JSON reply does', () => {
    // The page formats a missing date through Date.parse, so every field is NaN.
    const page = rendered(undatedLeg.states.map((state) => {
      const date = typeof state.date === 'string' ? DateTime.fromISO(state.date, { zone: 'UTC', locale: 'en' }) : null;
      return carrierRow(date?.toFormat('dd LLL yyyy') ?? 'aN Inv NaN', date?.toFormat('HH:mm') ?? 'aN:aN',
        String(state.status), undatedLeg.carriers[Number(state.carrier)]);
    }).join(''));
    const html = parseParcelsAppHtml(page, number);
    const json = parseParcelsAppResponse(undatedLeg, number, identity());
    expect(html).toMatchObject({ undated_event_count: 1, last_update: json.last_update, current_stage: json.current_stage });
    expect(html.events).toEqual(json.events);
    expect(new Set(html.reported_carriers as string[])).toEqual(new Set(json.reported_carriers as string[]));
    expect(() => parseParcelsAppHtml(rendered(carrierRow('aN Inv NaN', 'aN:aN', 'Departed from Asendia', 'Asendia Spain')), number))
      .toThrow('No usable tracking events');
  });

  it('keeps unknown historical wording pending rather than inheriting delivered', () => {
    const result = parseParcelsAppResponse({ states: [
      { date: '2026-08-18T03:04:00Z', status: 'Delivered by mailbox, PIN: PRIVATE' },
      { date: '2026-08-17T03:04:00Z', status: 'Additional information provided' },
    ] }, number, identity());
    expect(result.current_stage).toBe('delivered');
    expect(result.events?.[1].stage).toBe('pending');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('keeps a Quickpac pre-advice from reporting the parcel as delivered', () => {
    // Observed wording (2026-09-21); synthetic number and dates.
    const result = parseParcelsAppResponse({
      carriers: ['Planzer', 'Quickpac'],
      states: [{ date: '2026-06-10T12:22:20Z', carrier: 1, status: 'Shipment recorded by sender (data delivered)' }],
    }, number, identity(), 'Europe/Zurich');
    expect(result).toMatchObject({ status: 'pending', current_stage: 'registered' });
    expect(result.events?.[0]).toMatchObject({ stage: 'registered', description: 'Shipment recorded by sender (data delivered)' });
  });

  it('re-reads each scan in its carrier\'s or location\'s zone instead of the UTC ParcelsApp labels', () => {
    // Live shapes (2026-09-22): the carrier's local clock as "+00:00" or shifted into "+02:00".
    const result = parseParcelsAppResponse({
      carriers: ['India Post', 'Universal Postal Union', 'Swiss Post'],
      states: [
        { date: '2026-06-12T13:30:00+02:00', status: 'Delivered', carrier: 2 },
        { date: '2026-06-11T18:10:00+02:00', status: 'Shipment was sorted', carrier: 1, location: 'Example Parcel Centre, Switzerland' },
        { date: '2026-06-08T15:20:00Z', status: 'Arrived at international sorting center', carrier: 1, location: 'EXAMPLE AIR HUB' },
        { date: '2026-06-05T20:30:00Z', status: 'Item booked', carrier: 0 },
      ],
    }, number, identity());
    expect(result.events?.map((scan) => scan.time)).toEqual([
      '2026-06-12T09:30:00.000Z', // Swiss Post: 11:30 in Zurich
      '2026-06-11T14:10:00.000Z', // unmapped carrier, located in Switzerland
      '2026-06-08T15:20:00.000Z', // no zone to resolve: kept as labeled
      '2026-06-05T15:00:00.000Z', // India Post: 20:30 in Kolkata
    ]);
  });

  it('falls back to the parcel carrier\'s zone when a scan names no usable carrier or place', () => {
    const payload = { carriers: ['Example Parcel Co'], states: [{ date: '2026-06-10T14:05:00+00:00', status: 'Return to sender', carrier: 0 }] };
    expect(parseParcelsAppResponse(payload, number, identity(), 'Europe/Zurich').events?.[0]?.time).toBe('2026-06-10T12:05:00.000Z');
    expect(parseParcelsAppResponse(payload, number, identity()).events?.[0]?.time).toBe('2026-06-10T14:05:00.000Z');
    expect(parseParcelsAppHtml(rendered(row('10 Jun 2026', '14:05', 'Return to sender')), number, 'Europe/Zurich').events?.[0]?.time)
      .toBe('2026-06-10T12:05:00.000Z');
  });

  it('keeps a scan located in another country as labeled instead of reading it in the parcel carrier\'s zone', () => {
    // Live shape (2026-09-29): Asendia USA scans on a number filed under Swiss
    // Post, labeled with the UTC instants of Asendia's own feed.
    const times = (payload: Record<string, unknown>) =>
      parseParcelsAppResponse(payload, number, identity(), 'Europe/Zurich').events?.map((scan) => scan.time);
    expect(times(undatedLeg)).toEqual([
      '2026-03-10T18:10:00.000Z', '2026-03-10T15:40:00.000Z', '2026-03-10T06:15:00.000Z',
      '2026-03-10T00:00:00.000Z', // WNDirect, with no location, on Zurich time
      '2026-03-09T21:30:00.000Z',
    ]);
    const scan = (location: string, carriers = ['Example Parcel Co']) => times({
      carriers, states: [{ date: '2026-07-02T18:30:00+00:00', status: 'In transit', carrier: 0, location }],
    })?.[0];
    // A country with several clocks, by name or code, or one with no listed zone.
    for (const location of ['EXAMPLE CITY, CA, United States', 'EXAMPLE CITY, CA, US', 'EXAMPLE CITY, South Africa']) {
      expect(scan(location)).toBe('2026-07-02T18:30:00.000Z');
    }
    // The parcel carrier's country, or a place with no country it can tell.
    for (const location of ['Example Hub, Switzerland', 'Example Hub', 'Example City, ON']) {
      expect(scan(location)).toBe('2026-07-02T16:30:00.000Z');
    }
    // The country a carrier name ends with is a guess too: it can be a branch.
    expect(scan('EXAMPLE CITY, United States', ['Cainiao (China)'])).toBe('2026-07-02T18:30:00.000Z');
    expect(times({ states: [{ date: '2026-07-02T18:30:00+00:00', status: 'In transit', location: 'EXAMPLE CITY, South Africa' }] }))
      .toEqual(['2026-07-02T18:30:00.000Z']);
  });

  it('reads a bare brand in the clock all of its catalog networks keep', () => {
    // Live shape (2026-09-26): scans named only "DPD Group", without a location,
    // on a parcel filed under a carrier with no local clock.
    const scans = (carriers: string[], dates: string[], extra: Record<string, unknown> = {}) => parseParcelsAppResponse({
      carriers, states: dates.map((date) => ({ date, status: 'In transit', carrier: 0, ...extra })),
    }, number, identity()).events?.map((scan) => scan.time);
    expect(scans(['DPD Group'], ['2026-07-02T18:30:00+00:00', '2026-01-14T09:15:00+00:00'])).toEqual([
      '2026-07-02T16:30:00.000Z', // summer: CEST
      '2026-01-14T08:15:00.000Z', // winter: CET
    ]);
    expect(scans(['GLS'], ['2026-07-02T18:30:00+00:00'])).toEqual(['2026-07-02T16:30:00.000Z']);
    expect(scans(['Hermes'], ['2026-01-14T09:15:00+00:00'])).toEqual(['2026-01-14T08:15:00.000Z']);
    // A network the name or location places elsewhere keeps that country's clock.
    expect(scans(['DPD UK'], ['2026-07-02T18:30:00+00:00'])).toEqual(['2026-07-02T17:30:00.000Z']);
    expect(scans(['DPD Group'], ['2026-07-02T18:30:00+00:00'], { location: 'Example Hub, United Kingdom' }))
      .toEqual(['2026-07-02T17:30:00.000Z']);
    // A location it cannot place may be a network outside the catalog: no brand clock.
    for (const location of ['EXAMPLE CITY, CA, US', 'Example City, ON', 'Example Hub']) {
      expect(scans(['GLS'], ['2026-07-02T18:30:00+00:00'], { location })).toEqual(['2026-07-02T18:30:00.000Z']);
    }
    // A name's country can be a branch: the scan's own location comes first.
    expect(scans(['Cainiao (China)'], ['2026-07-02T18:30:00+00:00'], { location: 'Example Hub, Spain' }))
      .toEqual(['2026-07-02T16:30:00.000Z']);
    expect(scans(['Cainiao (China)'], ['2026-07-02T18:30:00+00:00'])).toEqual(['2026-07-02T10:30:00.000Z']);
    // DHL eCommerce keeps no local clock, so the bare brand has no zone of its own.
    expect(scans(['DHL'], ['2026-07-02T18:30:00+00:00'])).toEqual(['2026-07-02T18:30:00.000Z']);
    expect(parseParcelsAppResponse({ carriers: ['DHL'], states: [{ date: '2026-07-02T18:30:00+00:00', status: 'In transit', carrier: 0 }] },
      number, identity(), 'Europe/Zurich').events?.[0]?.time).toBe('2026-07-02T16:30:00.000Z');
  });

  it('reports the carriers it aggregated and resolves a bare brand with the number', () => {
    const reply = (carriers: string[]) => ({
      carriers, services: carriers.map((name) => ({ slug: name.toLowerCase().replace(/ /g, '-'), name, isFinished: true })),
      states: [{ date: '2026-07-02T08:30:00+00:00', status: 'Delivered', carrier: 0 }],
    });
    // A Swiss DPD depot prefix picks DPD Switzerland out of the DPD networks.
    const swiss = '06080000000002';
    expect(parseParcelsAppResponse(reply(['DPD Group']), swiss, identity(swiss))).toMatchObject({
      reported_carriers: ['DPD Group'], discovered_carrier: 'dpd',
    });
    // Another depot matches both DPD networks: the brand stays a hint only.
    const austrian = '06200000000002';
    const unresolved = parseParcelsAppResponse(reply(['DPD Group']), austrian, identity(austrian));
    expect(unresolved.reported_carriers).toEqual(['DPD Group']);
    expect(unresolved.discovered_carrier).toBeUndefined();
    // Two carriers on one journey never pick one.
    const journey = reply(['Swiss Post', 'DPD Group']);
    journey.states.push({ date: '2026-07-01T16:00:00+00:00', status: 'In transit', carrier: 1 });
    expect(parseParcelsAppResponse(journey, swiss, identity(swiss)).discovered_carrier).toBeUndefined();
    expect(parseParcelsAppResponse(reply(['Swiss Post']), number, identity()).discovered_carrier).toBe('swiss-post');
  });

  it('takes the hint from the carrier every scan names, not from carriers asked without an answer', () => {
    // Live shape (2026-09-28): the carriers ParcelsApp tried, with every scan from one of them.
    const reply = (carriers: string[], states: Record<string, unknown>[]) => parseParcelsAppResponse({
      carriers, services: carriers.map((name) => ({ slug: name.toLowerCase(), name })), states,
    }, '123456784', identity('123456784'));
    const scan = (carrier?: number) => ({ date: '2026-07-02T08:30:00+00:00', status: 'Shipment in transit', ...(carrier === undefined ? {} : { carrier }) });
    expect(reply(['TNT', 'TNT', 'Example Transport'], [scan(0), scan(1)])).toMatchObject({
      reported_carriers: ['TNT', 'Example Transport'], discovered_carrier: 'tnt',
    });
    expect(reply(['TNT', 'Example Transport'], [scan(0), scan(1)]).discovered_carrier).toBeUndefined();
    expect(reply(['TNT', 'Example Transport'], [scan(0), scan()]).discovered_carrier).toBeUndefined();
    expect(reply(['Example Transport', 'TNT'], [scan(0)]).discovered_carrier).toBeUndefined();
  });

  it('keeps the UTC instants ParcelsApp gives TNT international scans', () => {
    // Checked against tnt.com's offsets (2026-09-28); a TNT France number keeps the French clock.
    const scan = (trackingNumber: string) => parseParcelsAppResponse({
      carriers: ['TNT'], states: [{ date: '2026-07-02T11:20:00+00:00', status: 'Shipment in transit', carrier: 0, location: 'Example Hub, China' }],
    }, trackingNumber, identity(trackingNumber)).events?.[0]?.time;
    expect(scan('123456784')).toBe('2026-07-02T11:20:00.000Z');
    expect(scan('1000000000000001')).toBe('2026-07-02T09:20:00.000Z');
  });

  it('reads Asendia scans filed under another name in their place\'s clock, not as UTC', () => {
    // Live shape (2026-09-30): an eBay shipment whose Asendia scans ParcelsApp
    // files under "EasyShip", on local clocks. Ship24's instants agree.
    const result = parseParcelsAppResponse({
      carriers: ['Asendia United States', 'EasyShip'],
      states: [
        { date: '2026-03-20T06:40:00Z', status: 'Arrived at delivery centre', carrier: 1, location: 'Japan, Japan' },
        { date: '2026-03-12T05:20:00Z', status: 'Departure transit facility', carrier: 1, location: 'Switzerland, Switzerland' },
        { date: '2026-03-05T18:45:10Z', status: 'Dispatched by Asendia', carrier: 1, location: 'United States, United States' },
      ],
    }, number, identity());
    expect(result.events?.map((scan) => scan.time)).toEqual([
      '2026-03-19T21:40:00.000Z', // 06:40 in Tokyo
      '2026-03-12T04:20:00.000Z', // 05:20 in Zurich
      '2026-03-05T18:45:10.000Z', // a US local clock no step can place: as labeled
    ]);
  });

  it('keeps the UTC instants ParcelsApp gives Asendia USA scans wherever they happened', () => {
    // Live shape (2026-09-30): an Asendia USA return through Switzerland, filed
    // under Swiss Post. Asendia's A1 feed has the same instants, and Swiss
    // Post's own scan (its local clock shifted into "+02:00") agrees.
    const result = parseParcelsAppResponse({
      carriers: ['Swiss Post', 'Asendia United States', 'Asendia USA'],
      states: [
        { date: '2026-05-06T19:40:30+02:00', status: 'Arrival in destination country', carrier: 0, location: 'Example Centre, Switzerland, 100000' },
        { date: '2026-05-06T15:40:00Z', status: 'Arrived at destination', carrier: 1, location: 'EXAMPLE CITY, Switzerland' },
        { date: '2026-04-21T06:10:00Z', status: 'Out for delivery', carrier: 1, location: 'Germany' },
        { date: '2026-04-20T09:30:00Z', status: 'Arrived at destination', carrier: 2, location: 'EXAMPLE CITY, Germany' },
        { date: '2026-04-10T14:05:12Z', status: 'Shipment Information Received', carrier: 1 },
      ],
    }, number, identity(), 'Europe/Zurich');
    expect(result.events?.map((scan) => scan.time)).toEqual([
      '2026-05-06T15:40:30.000Z', // Swiss Post: 17:40:30 in Zurich
      '2026-05-06T15:40:00.000Z',
      '2026-04-21T06:10:00.000Z',
      '2026-04-20T09:30:00.000Z',
      '2026-04-10T14:05:12.000Z',
    ]);
  });

  it('keeps the instants of scans whose carrier resolved before brand and country names did', () => {
    // A Chronopost + DHL Parcel Netherlands handoff: the DHL scans carry no
    // location and were read in the parcel carrier's zone (Berlin). Their name
    // now reads them in Amsterdam, which keeps the same clock, so stored rows
    // keep their identity.
    const result = parseParcelsAppResponse({
      carriers: ['Chronopost France', 'DHL Parcel Netherlands'],
      states: [
        { date: '2026-07-03T11:42:00+00:00', status: 'Delivered', carrier: 0, location: 'EXAMPLE-VILLE' },
        { date: '2026-07-02T19:05:00+00:00', status: 'Handed over to the delivery partner', carrier: 1 },
        { date: '2026-03-29T01:30:00+00:00', status: 'Sorted at the parcel centre', carrier: 1 },
        { date: '2026-01-14T07:20:00+00:00', status: 'Received by the carrier', carrier: 1 },
      ],
    }, number, identity(), 'Europe/Berlin');
    expect(result.events?.map((scan) => scan.time)).toEqual([
      '2026-07-03T09:42:00.000Z',
      '2026-07-02T17:05:00.000Z',
      '2026-03-29T00:30:00.000Z',
      '2026-01-14T06:20:00.000Z',
    ]);
  });

  it('reads rendered scans in the clock of the carrier each one names, as the JSON reply does', () => {
    const swiss = '06080000000002';
    const page = identity(swiss).replace('</table>', `</table><ul class="events">${
      carrierRow('02 Jul 2026', '10:37', 'Delivered', 'DPD Group')}${carrierRow('14 Jan 2026', '09:15', 'Parcel handed', 'DPD Group')}</ul>`);
    const rendered = parseParcelsAppHtml(page, swiss);
    const json = parseParcelsAppResponse({ carriers: ['DPD Group'], states: [
      { date: '2026-07-02T10:37:00+00:00', status: 'Delivered', carrier: 0 },
      { date: '2026-01-14T09:15:00+00:00', status: 'Parcel handed', carrier: 0 },
    ] }, swiss, identity(swiss));
    expect(rendered.events?.map((scan) => scan.time)).toEqual(['2026-07-02T08:37:00.000Z', '2026-01-14T08:15:00.000Z']);
    expect(rendered.events?.map((scan) => scan.time)).toEqual(json.events?.map((scan) => scan.time));
    expect(rendered).toMatchObject({ reported_carriers: ['DPD Group'], discovered_carrier: 'dpd' });
  });

  it('parses rendered history without parsing the surrounding marketing copy', () => {
    const html = rendered(row('18 Aug 2026', '03:04', 'Electronic information submitted by shipper'));
    expect(parseParcelsAppHtml(html + '<p>Delivered 2026-09-01</p>', number))
      .toMatchObject({ current_stage: 'registered', last_update: '2026-08-18T03:04:00.000Z' });
  });

  it('skips notice rows that render a date without a time', () => {
    // Observed live on 2026-09-11 for a not-yet-scanned Colissimo label.
    const notice = row('11 Sep 2026', '', "No information about your package. We've checked all relevant couriers for «Suisse». If the country is not correct, please select the destination country below.");
    const scan = row('10 Sep 2026', '08:30', 'Electronic information submitted by shipper');
    expect(parseParcelsAppHtml(rendered(notice + scan), number)).toMatchObject({ current_stage: 'registered', last_update: '2026-09-10T08:30:00.000Z' });
    expect(() => parseParcelsAppHtml(rendered(notice), number)).toThrow('No usable tracking events');
    expect(() => parseParcelsAppHtml(rendered(row('today', '08:30', 'Electronic information submitted by shipper')), number)).toThrow('invalid event date');
  });
});

describe('ParcelsApp browser capture', () => {
  it('asks the browser service for the page and reads its captured API response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(captured(announced));
    await expect(tracker(fetcher, 'http://browser.test/v1').fetch(number)).resolves.toMatchObject({ tracking_provider: 'ParcelsApp', current_stage: 'registered' });
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://browser.test/scrape');
    expect(JSON.parse(String(options!.body))).toMatchObject({
      url: `https://parcelsapp.com/en/tracking/${number}`, skipHttp: true, maxTier: 3,
      captureResponses: [API], settleTimeout: 15_000,
    });
  });

  it('falls back to the rendered history when no API body was captured', async () => {
    const html = rendered(row('18 Aug 2026', '03:04', 'Electronic information submitted by shipper'));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(captured(null, { html, capturedResponses: [] }));
    await expect(tracker(fetcher).fetch(number)).resolves.toMatchObject({ current_stage: 'registered', last_update: '2026-08-18T03:04:00.000Z' });
  });

  it('rejects a page rendered for another shipment instead of reporting its history', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(captured(announced, { html: identity('OTHER123') }));
    await expect(tracker(fetcher).fetch(number)).rejects.toThrow('identity missing');
  });

  it('needs the browser service and never requests an arbitrary user URL', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new ParcelsAppTracker({ httpClient: null }).fetch(number)).rejects.toThrow('tracking browser service');
    await expect(tracker(fetcher).fetch('http://localhost')).rejects.toThrow('Invalid tracking number');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('ParcelsApp direct lookup', () => {
  const reply = (data: unknown) => new Response(JSON.stringify(data));
  const prompt = { states: [{ date: '2026-01-01T00:00:00', status: 'Enter recipient details',
    require_fields: [{ name: 'zipcode', type: 'text' }] }] };

  it('retrieves history without a browser and sends the stored postcode only in the form body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(announced));
    const result = await new ParcelsAppTracker({ fetcher }).fetch(number, 10_000, ' 01234 ');
    expect(result).toMatchObject({ current_stage: 'registered', tracking_source: 'structured-web-response' });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(API);
    expect(new URLSearchParams(String(init!.body)).get('extra[zipcode]')).toBe('01234');
    expect(JSON.stringify(result)).not.toContain('01234');
  });

  it('keeps interleaved numberless responses bound to their own requests', async () => {
    let finishFirst!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(reply({ states: [{ date: '2026-01-02T12:00:00Z', status: 'Delivered' }] }));
    const tracker = new ParcelsAppTracker({ fetcher });
    const first = tracker.fetch(number);
    const second = await tracker.fetch('ZZ98765432100');
    finishFirst(reply(announced));
    expect(second.current_stage).toBe('delivered');
    expect((await first).current_stage).toBe('registered');
    expect(String(fetcher.mock.calls[0][1]!.body)).not.toBe(String(fetcher.mock.calls[1][1]!.body));
  });

  it('reports a postcode gate without treating it as a scan or retrying in a browser', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(prompt));
    const tracker = new ParcelsAppTracker({ fetcher, trawl: new TrawlClient('http://browser.test', fetcher) });
    for (const postcode of [undefined, '99999']) {
      const error = await tracker.fetch(number, 10_000, postcode).catch((error: unknown) => error);
      expect(error).toMatchObject({ kind: 'input_required', field: 'postcode' });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns the dated history of a reply with an undated state, without a browser retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(undatedLeg));
    await expect(new ParcelsAppTracker({ fetcher, trawl: new TrawlClient('http://browser.test', fetcher) }).fetch(number))
      .resolves.toMatchObject({ tracking_source: 'structured-web-response', undated_event_count: 1 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('retains actual scans alongside a postcode gate', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ states: [...prompt.states, ...announced.states] }));
    const result = await new ParcelsAppTracker({ fetcher }).fetch(number);
    expect(result.events).toHaveLength(1);
    expect(result.current_stage).toBe('registered');
  });

  it('records challenge recovery and retains the browser identity check', async () => {
    const steps: StepRecord[] = [];
    const lookups: LookupRecord[] = [];
    const recorder: StepRecorder = { step: (record) => { steps.push(record); }, lookup: (record) => { lookups.push(record); } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ error: 'RELOAD' })).mockResolvedValueOnce(captured(announced));
    const result = await new ParcelsAppTracker({ fetcher, recorder, trawl: new TrawlClient('http://browser.test', fetcher) }).fetch(number);
    expect(result.current_stage).toBe('registered');
    expect(steps).toMatchObject([{ step: 'direct', outcome: 'challenge' }, { step: 'trawl', outcome: 'ok', fallbackFrom: 'direct' }]);
    expect(lookups).toMatchObject([{ finalStep: 'trawl', attempts: 2, outcome: 'ok' }]);

    fetcher.mockResolvedValueOnce(reply({ error: 'RELOAD' })).mockResolvedValueOnce(captured(announced, { html: identity('OTHER123') }));
    await expect(new ParcelsAppTracker({ fetcher, trawl: new TrawlClient('http://browser.test', fetcher) }).fetch(number)).rejects.toThrow('identity missing');
  });

  it.each([429, 500, 503])('does not amplify HTTP %i with a browser retry', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status, headers: { 'Retry-After': '120' } }));
    await expect(new ParcelsAppTracker({ fetcher, trawl: new TrawlClient('http://browser.test', fetcher) }).fetch(number))
      .rejects.toMatchObject({ status, retryAfterMs: 120_000 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([{ error: 'NO_DATA' }, { error: 'NO_TRACKER' }, { states: [] }])('leaves no-history replies inconclusive without browser retries: %j', async (payload) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(payload));
    const error = await new ParcelsAppTracker({ fetcher, trawl: new TrawlClient('http://browser.test', fetcher) }).fetch(number).catch((error: unknown) => error);
    expect(carrierErrorKind(error)).toBe('indeterminate');
    expect(error).toBeInstanceOf(NoHistoryError);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([{ correctId: 'OTHER123', ...announced }, { states: [{}] }, { states: [null] }, { states: Array(1001).fill({}) }, { uuid: 'unfinished' }])('rejects aliases, malformed and intermediate replies', async (payload) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(payload));
    await expect(new ParcelsAppTracker({ fetcher }).fetch(number)).rejects.toThrow();
  });
});

describe('ParcelsApp slow lookup recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    // The ESM promise timer retains Node's clock in this Vitest environment.
    vi.spyOn(timers, 'setTimeout').mockImplementation(<T>(ms = 1, value?: T) =>
      new Promise<T>((resolve) => { setTimeout(() => resolve(value as T), ms); }));
    // Node's native AbortSignal timer is not driven by fake timers. Keep its
    // abort behavior while exercising the real bounded HTTP client below.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
      return controller.signal;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function timedFetch(replies: { afterMs: number; payload?: unknown; failure?: Error }[]) {
    let attempt = 0;
    return vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((resolve, reject) => {
      const reply = replies[attempt++];
      const signal = init!.signal!;
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        if (reply.failure) reject(reply.failure);
        else resolve(Response.json(reply.payload));
      }, reply.afterMs);
      signal.addEventListener('abort', abort, { once: true });
    }));
  }

  it('lets a cold lookup finish after the old ten-second cutoff without another request', async () => {
    const fetcher = timedFetch([{ afterMs: 12_000, payload: announced }]);
    const lookup = new ParcelsAppTracker({ fetcher }).fetch(number);
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(lookup).resolves.toMatchObject({ current_stage: 'registered' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('retries a timed-out POST once after two seconds, preserving input and both attempt records', async () => {
    const steps: StepRecord[] = [], lookups: LookupRecord[] = [];
    const recorder: StepRecorder = { step: (r) => { steps.push(r); }, lookup: (r) => { lookups.push(r); } };
    const fetcher = timedFetch([{ afterMs: 40_000, payload: announced }, { afterMs: 100, payload: announced }]);
    const tracker = new ParcelsAppTracker({ fetcher, recorder, trawl: new TrawlClient('http://browser.test', fetcher) });
    const lookup = tracker.fetch(number, undefined, ' 01234 ');
    await vi.advanceTimersByTimeAsync(31_999);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(101);
    await expect(lookup).resolves.toMatchObject({ tracking_source: 'structured-web-response', current_stage: 'registered' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([API, API]);
    expect(String(fetcher.mock.calls[1][1]!.body)).toBe(String(fetcher.mock.calls[0][1]!.body));
    expect(new URLSearchParams(String(fetcher.mock.calls[1][1]!.body)).get('extra[zipcode]')).toBe('01234');
    expect(steps).toMatchObject([
      { step: 'direct', outcome: 'transport' }, { step: 'retry', outcome: 'ok', fallbackFrom: 'direct' },
    ]);
    expect(lookups).toMatchObject([{ finalStep: 'retry', attempts: 2, outcome: 'ok', durationMs: 32_100 }]);
  });

  it('stops after two network failures without starting the same lookup again in a browser', async () => {
    const fetcher = timedFetch([
      { afterMs: 10, failure: new TypeError('connection reset') },
      { afterMs: 10, failure: new TypeError('connection reset again') },
    ]);
    const failure = expect(new ParcelsAppTracker({ fetcher, trawl: new TrawlClient('http://browser.test', fetcher) }).fetch(number))
      .rejects.toMatchObject({ kind: 'transport' });
    await vi.advanceTimersByTimeAsync(2_020);
    await failure;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects an unverified alias returned by the retry', async () => {
    const fetcher = timedFetch([
      { afterMs: 10, failure: new TypeError('connection reset') },
      { afterMs: 10, payload: { ...announced, correctId: 'OTHER123' } },
    ]);
    const failure = expect(new ParcelsAppTracker({ fetcher }).fetch(number)).rejects.toThrow('unverified tracking alias');
    await vi.advanceTimersByTimeAsync(2_020);
    await failure;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry when a shorter caller deadline cannot accommodate the backoff', async () => {
    const fetcher = timedFetch([{ afterMs: 40_000, payload: announced }]);
    const failure = expect(new ParcelsAppTracker({ fetcher }).fetch(number, 31_000)).rejects.toMatchObject({ kind: 'transport' });
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('aborts the second request at the original deadline, including its backoff time', async () => {
    const fetcher = timedFetch([{ afterMs: 40_000, payload: announced }, { afterMs: 40_000, payload: announced }]);
    const failure = expect(new ParcelsAppTracker({ fetcher }).fetch(number)).rejects.toMatchObject({ kind: 'transport' });
    await vi.advanceTimersByTimeAsync(45_000);
    await failure;
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([, init]) => init!.signal!.aborted)).toBe(true);
  });
});
