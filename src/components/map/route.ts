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

/** The journey as a line: how far along it each mark stands, from 0 at the first place to 1 at the last, or at the destination. */
export interface RouteLine {
  /** The places passed, in order, without the one the parcel is at. */
  stops: number[];
  /** Each new country's flag, halfway along the leg that crosses into it. */
  borders: { at: number; country: string }[];
  /** Where the parcel is. The line beyond it is the way still to go. */
  now: number;
}

/** The share of the line a leg keeps however short it is, so that no two places touch; a leg over a border keeps room for its flag. */
const LINE_GAP = .045;
const LINE_BORDER = .09;
/** On a line crowded with places, one standing closer than this to the one before it is left out. */
const LINE_APART = .02;

/**
 * The line under the summary's two names. A long leg is longer on it, by its square root: to scale, a flight would leave
 * the last mile no room. Between two places the line would tell nothing their names do not, so it takes a third, passed
 * or still ahead, to be worth drawing. A delivered parcel has arrived, wherever its last scan with a place was.
 */
export function routeLine(route: Route, arrived = false): RouteLine | null {
  const places = [...route.stops.map((stop) => stop.place), ...(route.destination ? [route.destination] : [])];
  if (places.length < 3) return null;
  // The place the parcel is at: its last stop, or the destination once it is delivered.
  const here = arrived ? places.length - 1 : route.stops.length - 1;
  const legs = places.slice(1).map((place, index) => ({
    root: Math.sqrt(route.legs[index]?.km ?? route.remainingKm ?? 0),
    // The way still to go has crossed no border yet.
    border: index < here && place.country !== places[index].country,
  }));
  const borders = legs.filter((leg) => leg.border).length;
  const plain = legs.length - borders;
  let border = LINE_BORDER;
  let gap = LINE_GAP;
  // A journey of many legs shares out most of the line, the flags first.
  if (borders * border + plain * gap > .7) {
    border = Math.min(border, .5 / borders);
    gap = plain ? (.7 - borders * border) / plain : 0;
  }
  const free = 1 - borders * border - plain * gap;
  const roots = legs.reduce((sum, leg) => sum + leg.root, 0);
  const at = [0];
  legs.forEach((leg, index) => at.push(at[index] + (leg.border ? border : gap) + free * (roots ? leg.root / roots : 1 / legs.length)));
  at[at.length - 1] = 1;
  const stops: number[] = [];
  route.stops.forEach((_, index) => {
    if (index !== here && (!stops.length || at[index] - stops[stops.length - 1] >= LINE_APART)) stops.push(at[index]);
  });
  return {
    stops,
    borders: legs.flatMap((leg, index) => leg.border ? [{ at: (at[index] + at[index + 1]) / 2, country: places[index + 1].country }] : []),
    now: at[here],
  };
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
