import { geoDistance } from 'd3-geo';
import type { MultiPolygon, Position } from 'geojson';
import world from './world.json';

export type Detail = 'coarse' | 'fine';
export type Coordinate = [longitude: number, latitude: number];

export interface Country {
  code: string;
  name: string;
  label: Coordinate | null;
  /** Natural Earth's label rank: 1 for the largest countries, up to 10. */
  rank: number;
  shape: MultiPolygon;
}

/** A shape with the smallest cap around it, so views can skip what they can't see. */
export interface Part<T> { shape: T; center: Coordinate; radius: number }

export interface Geography {
  land: Part<Position[][]>[];
  borders: Part<Position[]>[];
  lakes: Part<Position[][]>[];
  countries: ReadonlyMap<string, Country>;
}

const cache = new Map<Detail, Geography>();

function decode(flat: readonly number[]): Position[] {
  const points: Position[] = [];
  let x = 0;
  let y = 0;
  for (let index = 0; index < flat.length; index += 2) {
    x += flat[index];
    y += flat[index + 1];
    points.push([x / world.precision, y / world.precision]);
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
  const arcs = world.arcs[detail].map(decode);
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
  for (const country of world.countries) {
    const polygons = country.polygons
      .map(polygon => polygon.map(ring).filter(points => points.length >= 4))
      .filter(polygon => polygon.length > 0);
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
    land: land.map(polygon => part(polygon, polygon[0])),
    borders: world.borders.map(index => part(arcs[index], arcs[index])),
    lakes: world.lakes.map(flat => {
      const ring = decode(flat);
      return part([ring], ring);
    }),
    countries,
  };
  cache.set(detail, result);
  return result;
}

export interface City { coordinate: Coordinate; name: string; rank: number }

/** Major cities, most prominent first. */
export const cities: readonly City[] = world.cities.map(([longitude, latitude, name, rank]) => ({
  coordinate: [longitude as number, latitude as number],
  name: name as string,
  rank: rank as number,
}));

export function countryLabel(code: string): Coordinate | null {
  return geography('coarse').countries.get(code)?.label ?? null;
}
