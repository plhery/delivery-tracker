import { describe, expect, it } from 'vitest';
import type { EventPlace, Stage, TrackingEvent } from '../../types';
import { buildRoute, countryPlace, defaultMode, flag, formatKm, hasNearView, placeFromEvent, placeName, routeFromEvents, routeLine, type Place, type Scan } from './route';

const city = (name: string, country: string, longitude: number, latitude: number): Place => ({
  id: name, name, country, coordinate: [longitude, latitude], precision: 'city',
});
const kyoto = city('Kyoto', 'JP', 135.77, 35.01);
const leipzig = city('Leipzig', 'DE', 12.37, 51.34);
const basel = city('Basel', 'CH', 7.59, 47.56);
const zurich = city('Zürich', 'CH', 8.54, 47.38);
const bern = city('Bern', 'CH', 7.45, 46.95);
const mulligen = city('Mülligen', 'CH', 8.46, 47.39);
const scan = (place?: Place, stage: Stage = 'in_transit'): Scan => ({ at: '2026-09-28T10:00:00Z', description: 'Scan', stage, place });

describe('buildRoute', () => {
  it('turns scans into stops, legs and distances', () => {
    const route = buildRoute([scan(kyoto), scan(kyoto), scan(), scan(leipzig), scan(basel), scan(zurich)]);
    expect(route.stops.map((stop) => stop.place.name)).toEqual(['Kyoto', 'Leipzig', 'Basel', 'Zürich']);
    expect(route.stops[0].scans).toHaveLength(2);
    expect(route.legs).toHaveLength(3);
    expect(route.km).toBeGreaterThan(9000);
    expect(route.countries).toEqual(['JP', 'DE', 'CH']);
    expect(route.scale).toBe('world');
    expect(route.origin?.place).toBe(kyoto);
    expect(route.current?.place).toBe(zurich);
    expect(route.latestLocated).toBe(true);
    // Leipzig is 530 km from Zürich, so only the Swiss stops are "near".
    expect(route.near.map((stop) => stop.place.name)).toEqual(['Basel', 'Zürich']);
  });

  it('keeps country-only scans honest', () => {
    const germany = countryPlace('DE', 'Germany', [10.4, 51.1]);
    const china = countryPlace('CN', 'China', [106.34, 32.5]);
    // A country after a city in it adds nothing; a city after its country replaces it.
    expect(buildRoute([scan(leipzig), scan(germany)]).stops).toHaveLength(1);
    const upgraded = buildRoute([scan(china), scan(city('Shenzhen', 'CN', 114.06, 22.54))]);
    expect(upgraded.stops).toHaveLength(1);
    expect(upgraded.stops[0].place.name).toBe('Shenzhen');
    expect(buildRoute([scan(china), scan(countryPlace('CH', 'Switzerland', [7.46, 46.72])), scan()]).latestLocated).toBe(false);
  });

  it('draws the remaining leg until the parcel reaches its destination', () => {
    const switzerland = countryPlace('CH', 'Switzerland', [7.46, 46.72]);
    const travelling = buildRoute([scan(kyoto), scan(leipzig)], switzerland);
    expect(travelling.destination).toBe(switzerland);
    expect(travelling.remainingKm).toBeGreaterThan(500);
    expect(buildRoute([scan(kyoto), scan(basel)], switzerland).destination).toBeUndefined();
    expect(buildRoute([scan(bern)], city('Bern centre', 'CH', 7.451, 46.949)).destination).toBeUndefined();
  });

  it('names the scale of each journey', () => {
    expect(buildRoute([]).scale).toBe('none');
    expect(buildRoute([scan(zurich)]).scale).toBe('point');
    expect(buildRoute([scan(zurich), scan(mulligen)]).scale).toBe('city');
    expect(buildRoute([scan(bern), scan(zurich)]).scale).toBe('local');
    expect(buildRoute([scan(leipzig), scan(zurich)]).scale).toBe('region');
  });
});

describe('camera views', () => {
  it('offers the close-up only when part of the journey is far away', () => {
    const world = buildRoute([scan(kyoto), scan(basel), scan(zurich)]);
    expect(hasNearView(world)).toBe(true);
    expect(hasNearView(buildRoute([scan(bern), scan(zurich)]))).toBe(false);
    // The way still to go counts too, when it leads out of the close-up.
    expect(hasNearView(buildRoute([scan(kyoto)], countryPlace('CH', 'Switzerland', [7.46, 46.72])))).toBe(true);
    expect(hasNearView(buildRoute([scan(bern)], zurich))).toBe(false);
    expect(defaultMode(world, 'in_transit')).toBe('journey');
    expect(defaultMode(world, 'out_for_delivery')).toBe('now');
    expect(defaultMode(world, 'ready_for_pickup')).toBe('now');
    expect(defaultMode(world, 'delivered')).toBe('journey');
    expect(defaultMode(buildRoute([scan(bern), scan(zurich)]), 'out_for_delivery')).toBe('journey');
  });
});

describe('summary line', () => {
  const switzerland = countryPlace('CH', 'Switzerland', [7.46, 46.72]);

  it('takes a third place, passed or still ahead, to be worth drawing', () => {
    expect(routeLine(buildRoute([scan(kyoto), scan(basel), scan(zurich)]))).not.toBeNull();
    // Two places are named beside each other already.
    expect(routeLine(buildRoute([scan(kyoto), scan(zurich)]))).toBeNull();
    expect(routeLine(buildRoute([scan(kyoto)], switzerland))).toBeNull();
    expect(routeLine(buildRoute([scan(kyoto), scan(leipzig)], switzerland))).not.toBeNull();
  });

  it('marks the places passed, further apart the longer the way between them', () => {
    const line = routeLine(buildRoute([scan(bern), scan(basel), scan(zurich), scan(mulligen)]))!;
    // The parcel is at the end; the three places before it are marked, and no border was crossed.
    expect(line.now).toBe(1);
    expect(line.borders).toEqual([]);
    expect(line.stops).toHaveLength(3);
    expect(line.stops[0]).toBe(0);
    const [first, second, last] = [line.stops[1], line.stops[2] - line.stops[1], 1 - line.stops[2]];
    // Zürich to Mülligen is a few kilometres: it keeps the room two dots need, and no more than the longer legs.
    expect(last).toBeGreaterThan(.045);
    expect(last).toBeLessThan(second);
    expect(last).toBeLessThan(first);
  });

  it('flies a new country’s flag halfway along the leg that crosses into it', () => {
    const line = routeLine(buildRoute([scan(kyoto), scan(leipzig), scan(basel), scan(zurich)]))!;
    expect(line.borders.map((border) => border.country)).toEqual(['DE', 'CH']);
    expect(line.borders[0].at).toBeCloseTo(line.stops[1] / 2);
    expect(line.borders[1].at).toBeCloseTo((line.stops[1] + line.stops[2]) / 2);
    // A flag has room between its two places, however short the leg; a flight is still the longest.
    expect(line.stops[2] - line.stops[1]).toBeGreaterThan(.09);
    expect(line.stops[1]).toBeGreaterThan(line.stops[2] - line.stops[1]);
  });

  it('leaves the way still to go bare until the parcel has arrived', () => {
    const route = buildRoute([scan(kyoto), scan(leipzig)], switzerland);
    const line = routeLine(route)!;
    expect(line.stops).toEqual([0]);
    expect(line.now).toBeGreaterThan(.5);
    expect(line.now).toBeLessThan(1);
    // Germany was reached; Switzerland has not been yet.
    expect(line.borders.map((border) => border.country)).toEqual(['DE']);
    // Delivered, it is at the end, wherever its last scan with a place was.
    const arrived = routeLine(route, true)!;
    expect(arrived.now).toBe(1);
    expect(arrived.borders.map((border) => border.country)).toEqual(['DE', 'CH']);
    // The last leg now keeps room for its flag, so Leipzig stands a little earlier.
    expect(arrived.stops).toHaveLength(2);
    expect(arrived.stops[1]).toBeLessThan(line.now);
    expect(arrived.borders[1].at).toBeCloseTo((arrived.stops[1] + 1) / 2);
  });

  it('thins the places of a crowded line', () => {
    const round = Array.from({ length: 30 }, () => [scan(zurich), scan(mulligen)]).flat();
    const route = buildRoute([scan(kyoto), ...round]);
    const line = routeLine(route)!;
    expect(line.stops.length).toBeLessThan(route.stops.length - 1);
    expect(line.stops.length).toBeGreaterThan(20);
    line.stops.slice(1).forEach((at, index) => expect(at - line.stops[index]).toBeGreaterThanOrEqual(.02));
    expect(line.stops.at(-1)).toBeLessThan(1);
    expect(line.borders).toHaveLength(1);
  });
});

describe('routeFromEvents', () => {
  const place = (name: string, latitude: number, longitude: number, country: string, precision: EventPlace['precision'] = 'city'): EventPlace => ({
    latitude, longitude, country, name, precision,
  });
  const event = (at: string, located?: EventPlace): TrackingEvent => ({
    id: at, parcelId: 'parcel', stage: 'in_transit', description: 'Scan', occurredAt: at, place: located,
  });

  it('orders scans by time and names countries in the reader’s language', () => {
    const route = routeFromEvents([
      event('2026-09-28T08:00:00Z', place('Zürich', 47.37, 8.55, 'CH')),
      event('2026-09-20T08:00:00Z', place('China', 32.5, 106.34, 'CN', 'country')),
      event('2026-09-24T08:00:00Z'),
    ], undefined, (code) => (code === 'CN' ? 'Chine' : code));
    expect(route.stops.map((stop) => stop.place.name)).toEqual(['Chine', 'Zürich']);
    expect(route.latestLocated).toBe(true);
    expect(placeFromEvent(place('Zürich', 47.3667, 8.55, 'CH'))).toMatchObject({ id: '47.37,8.55', coordinate: [8.55, 47.3667] });
    expect(routeFromEvents([event('2026-09-20T08:00:00Z', place('China', 32.5, 106.34, 'CN', 'country'))]).stops[0].place.name).toBe('China');
  });

  it('calls a facility by its town on a card and by its own name on the opened map', () => {
    const centre = placeFromEvent({ ...place('Zürich', 47.3959, 8.4695, 'CH'), site: 'Zürich-Mülligen' });
    expect([placeName(centre, false), placeName(centre, true)]).toEqual(['Zürich', 'Zürich-Mülligen']);
    const town = placeFromEvent(place('Zürich', 47.37, 8.55, 'CH'));
    expect([placeName(town, false), placeName(town, true)]).toEqual(['Zürich', 'Zürich']);
  });
});

describe('formatting', () => {
  it('rounds distances the way a journey is told, in the reader’s locale', () => {
    expect(formatKm(0.2)).toBe('1 km');
    expect(formatKm(8.4)).toBe('8 km');
    expect(formatKm(447)).toBe('450 km');
    expect(formatKm(9321)).toBe('9,300 km');
    expect(formatKm(9321, 'de-CH')).toMatch(/^9.300 km$/);
    expect(flag('CH')).toBe('🇨🇭');
  });
});
