import { geoDistance } from 'd3-geo';
import type { EventPlace, Stage, TrackingEvent } from '../../types';
import type { Coordinate } from './geography';

export type Precision = 'city' | 'country';

/** A located place. Country-level places sit on the country's label point. */
export interface Place {
  id: string;
  name: string;
  /** The facility's own name, longer than its town's: "Zürich-Mülligen". */
  site?: string;
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
/** Places closer than this to the current one belong to the "now" view. */
export const NEAR_KM = 400;

export const distanceKm = (a: Coordinate, b: Coordinate) => geoDistance(a, b) * EARTH_KM;

/** A server-located scan as a map place; scans a kilometre apart are the same stop. */
export function placeFromEvent(place: EventPlace): Place {
  return {
    id: `${place.latitude.toFixed(2)},${place.longitude.toFixed(2)}`,
    name: place.name,
    site: place.site,
    country: place.country,
    coordinate: [place.longitude, place.latitude],
    precision: place.precision,
  };
}

/** What to call a place: its town on a card, the facility itself on the opened map, which has the room. */
export const placeName = (place: Place, sites: boolean) => (sites && place.site) || place.name;

/** A country as a destination, drawn at its label point. */
export function countryPlace(country: string, name: string, coordinate: Coordinate): Place {
  return { id: country, name, country, coordinate, precision: 'country' };
}

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
  const points = [...stops.map((stop) => stop.place.coordinate), ...(remaining ? [remaining.coordinate] : [])];
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
    countries: [...new Set(stops.map((stop) => stop.place.country))],
    extentKm,
    scale: !points.length ? 'none'
      : points.length === 1 ? 'point'
        : extentKm > 2500 ? 'world'
          : extentKm > 400 ? 'region'
            : extentKm > 30 ? 'local' : 'city',
    near,
  };
}

/** A parcel's scans, oldest first, as a route; country-only places take the reader's name for the country. */
export function routeFromEvents(events: readonly TrackingEvent[], destination?: Place, countryName?: (code: string) => string): Route {
  const scans = [...events]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .map((event) => {
      const place = event.place ? placeFromEvent(event.place) : undefined;
      if (place?.precision === 'country' && countryName) place.name = countryName(place.country);
      return { at: event.occurredAt, description: event.description, stage: event.stage, place };
    });
  return buildRoute(scans, destination);
}

/** Both views only make sense when part of the journey, travelled or still to go, lies outside the close-up. */
export function hasNearView(route: Route): boolean {
  return route.near.length < route.stops.length || (route.remainingKm ?? 0) >= NEAR_KM;
}

/** A line between two places tells nothing their names do not: it takes a third, passed or still ahead, to be worth drawing. */
export function hasLine(route: Route): boolean {
  return route.stops.length + (route.destination ? 1 : 0) > 2;
}

/** The camera follows the parcel: the whole trip while it travels, a close-up for the last mile. */
export function defaultMode(route: Route, stage?: Stage): MapMode {
  if (!hasNearView(route)) return 'journey';
  return stage === 'out_for_delivery' || stage === 'ready_for_pickup' || stage === 'failed_attempt' ? 'now' : 'journey';
}

/** Kilometres, rounded as a journey is told: "8 km", "450 km", "9,300 km". */
export function formatKm(km: number, languageTag = 'en'): string {
  const rounded = km < 100 ? Math.round(km) : km < 1000 ? Math.round(km / 10) * 10 : Math.round(km / 100) * 100;
  return new Intl.NumberFormat(languageTag, { style: 'unit', unit: 'kilometer', maximumFractionDigits: 0 }).format(Math.max(rounded, 1));
}

export function flag(code: string): string {
  return [...code].map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('');
}
