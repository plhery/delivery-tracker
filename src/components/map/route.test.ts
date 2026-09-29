import { describe, expect, it } from 'vitest';
import type { EventPlace, Stage, TrackingEvent } from '../../types';
import { buildRoute, countryPlace, defaultMode, flag, formatKm, hasNearView, placeFromEvent, routeFromEvents, type Place, type Scan } from './route';

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
