// The world's shapes, without React: the browser's maps and the pictures the server draws both read them here.
import { geoDistance } from 'd3-geo';
import type { MultiPolygon, Position } from 'geojson';

export type Detail = 'coarse' | 'fine';
export type Coordinate = [longitude: number, latitude: number];
type World = typeof import('./world.json');

export interface Country {
  code: string;
  name: string;
  label: Coordinate | null;
  /** Natural Earth's label rank: 1 for the largest countries, up to 10. */
  rank: number;
  shape: MultiPolygon;
}

/** A shape with the smallest cap around it, so a view can skip what it cannot see. */
export interface Part<T> { shape: T; center: Coordinate; radius: number }

export interface Geography {
  land: Part<Position[][]>[];
  borders: Part<Position[]>[];
  lakes: Part<Position[][]>[];
  countries: ReadonlyMap<string, Country>;
}

export interface City { coordinate: Coordinate; name: string; rank: number }

let world: World | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const cache = new Map<Detail, Geography>();

/** The map data is some 270 KB compressed, so it loads only when a map is about to show. */
export function loadWorld(): Promise<void> {
  loading ??= import('./world.json').then((module) => {
    world = module.default;
    for (const listener of listeners) listener();
  }, (error: unknown) => {
    // Let the next map try again, for example once the device is back online.
    loading = null;
    throw error;
  });
  return loading;
}

/** Whether the map data has loaded. */
export const worldLoaded = () => world !== null;

/** Tells `listener` when the map data has loaded; returns how to stop listening. */
export function onWorldLoaded(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function loadedWorld(): World {
  if (!world) throw new Error('The map data has not loaded yet');
  return world;
}

function decode(flat: readonly number[], precision: number): Position[] {
  const points: Position[] = [];
  let x = 0;
  let y = 0;
  for (let index = 0; index < flat.length; index += 2) {
    x += flat[index];
    y += flat[index + 1];
    points.push([x / precision, y / precision]);
  }
  return points;
}

function part<T>(shape: T, points: readonly Position[]): Part<T> {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [longitude, latitude] of points) {
    const lambda = longitude * Math.PI / 180;
    const phi = latitude * Math.PI / 180;
    x += Math.cos(phi) * Math.cos(lambda);
    y += Math.cos(phi) * Math.sin(lambda);
    z += Math.sin(phi);
  }
  const length = Math.hypot(x, y, z) || 1;
  const center: Coordinate = [Math.atan2(y, x) * 180 / Math.PI, Math.asin(z / length) * 180 / Math.PI];
  let radius = 0;
  for (const point of points) radius = Math.max(radius, geoDistance(center, point as Coordinate));
  return { shape, center, radius };
}

/** world.json stores shared arcs once, so neighbouring borders always line up. */
export function geography(detail: Detail): Geography {
  const cached = cache.get(detail);
  if (cached) return cached;
  const data = loadedWorld();
  const arcs = data.arcs[detail].map((flat) => decode(flat, data.precision));
  const ring = (indexes: readonly number[]) => {
    const points: Position[] = [];
    for (const index of indexes) {
      const arc = index < 0 ? [...arcs[~index]].reverse() : arcs[index];
      points.push(...(points.length ? arc.slice(1) : arc));
    }
    return points;
  };
  const land: Position[][][] = [];
  const countries = new Map<string, Country>();
  for (const country of data.countries) {
    const polygons = country.polygons
      .map((polygon) => polygon.map(ring).filter((points) => points.length >= 4))
      .filter((polygon) => polygon.length > 0);
    land.push(...polygons);
    if (country.code) countries.set(country.code, {
      code: country.code,
      name: country.name,
      label: country.label as Coordinate | null,
      rank: country.rank,
      shape: { type: 'MultiPolygon', coordinates: polygons },
    });
  }
  const result: Geography = {
    land: land.map((polygon) => part(polygon, polygon[0])),
    borders: data.borders.map((index) => part(arcs[index], arcs[index])),
    lakes: data.lakes.map((flat) => {
      const points = decode(flat, data.precision);
      return part([points], points);
    }),
    countries,
  };
  cache.set(detail, result);
  return result;
}

let cityList: readonly City[] | null = null;

/** Major cities, most prominent first. */
export function cities(): readonly City[] {
  cityList ??= loadedWorld().cities.map(([longitude, latitude, name, rank]) => ({
    coordinate: [longitude as number, latitude as number],
    name: name as string,
    rank: rank as number,
  }));
  return cityList;
}

export function countryLabel(code: string): Coordinate | null {
  return geography('coarse').countries.get(code)?.label ?? null;
}
