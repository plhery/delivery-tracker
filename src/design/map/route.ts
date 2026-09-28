import { geoDistance } from 'd3-geo';
import type { Stage } from '../../types';
import type { Coordinate } from './geography';

export type Precision = 'city' | 'country';

/** A geocoded location. Country-level places sit on the country's label point. */
export interface Place {
  id: string;
  name: string;
  country: string;
  coordinate: Coordinate;
  precision: Precision;
}

export interface Scan {
  at: string;
  description: string;
  stage: Stage;
  place?: Place;
}

export interface Stop {
  id: string;
  place: Place;
  scans: Scan[];
}

export interface Leg {
  id: string;
  from: Stop;
  to: Stop;
  km: number;
}

export type Scale = 'world' | 'region' | 'local' | 'city' | 'point' | 'none';
export type MapMode = 'journey' | 'now';

export interface Route {
  stops: Stop[];
  legs: Leg[];
  origin?: Stop;
  current?: Stop;
  /** False when the newest scan has no place, so the last stop is only the last known one. */
  latestLocated: boolean;
  destination?: Place;
  remainingKm?: number;
  km: number;
  countries: string[];
  extentKm: number;
  scale: Scale;
  /** The newest stops close to the current one: what the "now" camera frames. */
  near: Stop[];
}

const EARTH_KM = 6371;
/** Stops closer than this to the current one belong to the "now" view. */
export const NEAR_KM = 400;

export const distanceKm = (a: Coordinate, b: Coordinate) => geoDistance(a, b) * EARTH_KM;

export function buildRoute(scans: readonly Scan[], destination?: Place): Route {
  const stops: Stop[] = [];
  for (const scan of scans) {
    const place = scan.place;
    if (!place) continue;
    const last = stops.at(-1);
    if (last?.place.id === place.id) {
      last.scans.push(scan);
    } else if (last && last.place.country === place.country && place.precision === 'country') {
      // "Germany" after Hamburg adds nothing to the map.
      last.scans.push(scan);
    } else if (last && last.place.country === place.country && last.place.precision === 'country') {
      // A city makes an earlier country-level scan precise.
      last.place = place;
      last.scans.push(scan);
    } else {
      stops.push({ id: `${place.id}:${stops.length}`, place, scans: [scan] });
    }
  }
  const legs = stops.slice(1).map((stop, index) => ({
    id: `${stops[index].id}>${stop.id}`,
    from: stops[index],
    to: stop,
    km: distanceKm(stops[index].place.coordinate, stop.place.coordinate),
  }));
  const current = stops.at(-1);
  const arrived = current && destination && (current.place.id === destination.id
    || (destination.precision === 'country' && current.place.country === destination.country)
    || distanceKm(current.place.coordinate, destination.coordinate) < 15);
  const remaining = current && destination && !arrived ? destination : undefined;
  const points = [...stops.map(stop => stop.place.coordinate), ...(remaining ? [remaining.coordinate] : [])];
  let extentKm = 0;
  for (const a of points) for (const b of points) extentKm = Math.max(extentKm, distanceKm(a, b));
  const near: Stop[] = [];
  for (const stop of [...stops].reverse()) {
    if (!current || distanceKm(stop.place.coordinate, current.place.coordinate) > NEAR_KM) break;
    near.unshift(stop);
  }
  return {
    stops,
    legs,
    origin: stops[0],
    current,
    latestLocated: Boolean(scans.at(-1)?.place),
    destination: remaining,
    remainingKm: current && remaining ? distanceKm(current.place.coordinate, remaining.coordinate) : undefined,
    km: legs.reduce((sum, leg) => sum + leg.km, 0),
    countries: [...new Set(stops.map(stop => stop.place.country))],
    extentKm,
    scale: !points.length ? 'none'
      : points.length === 1 ? 'point'
        : extentKm > 2500 ? 'world'
          : extentKm > 400 ? 'region'
            : extentKm > 30 ? 'local' : 'city',
    near,
  };
}

/** Both views only make sense when part of the journey lies outside the close-up. */
export function hasNearView(route: Route): boolean {
  return (route.scale === 'world' || route.scale === 'region') && route.near.length < route.stops.length;
}

/** The camera follows the parcel: the whole trip while it travels, a close-up for the last mile. */
export function defaultMode(route: Route, stage?: Stage): MapMode {
  if (!hasNearView(route)) return 'journey';
  return stage === 'out_for_delivery' || stage === 'ready_for_pickup' || stage === 'failed_attempt' ? 'now' : 'journey';
}

export function formatKm(km: number): string {
  const rounded = km < 100 ? Math.round(km) : km < 1000 ? Math.round(km / 10) * 10 : Math.round(km / 100) * 100;
  return `${new Intl.NumberFormat('en').format(Math.max(rounded, 1))} km`;
}

export function flag(code: string): string {
  return [...code].map(letter => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('');
}
