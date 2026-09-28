import { geoDistance, geoInterpolate, geoOrthographic, type GeoProjection } from 'd3-geo';
import type { Coordinate } from './geography';

/**
 * One orthographic projection serves every scale: zoomed out it is a globe,
 * zoomed in it is indistinguishable from a flat map, so the camera can move
 * between the two without switching projections.
 */
export interface Camera {
  center: Coordinate;
  /** Globe radius in CSS pixels. */
  scale: number;
  /** Where the camera centre sits on screen. */
  offset: [number, number];
}

export interface Box { x: number; y: number; width: number; height: number }

const EARTH_KM = 6371;

export function projection(camera: Camera): GeoProjection {
  return geoOrthographic()
    .rotate([-camera.center[0], -camera.center[1]])
    .scale(camera.scale)
    .translate(camera.offset)
    .clipAngle(90)
    .precision(.4);
}

function sphericalMean(points: readonly Coordinate[]): Coordinate {
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
  const length = Math.hypot(x, y, z);
  if (length < 1e-6) return points[0];
  return [Math.atan2(y, x) * 180 / Math.PI, Math.asin(z / length) * 180 / Math.PI];
}

export function angularExtent(points: readonly Coordinate[]): number {
  let extent = 0;
  for (const a of points) for (const b of points) extent = Math.max(extent, geoDistance(a, b));
  return extent;
}

export interface FitOptions {
  shape: 'rect' | 'circle';
  /** The smallest area worth showing, so a single town still has context. */
  minSpanKm: number;
  /** Past this angular extent the whole globe is shown instead. */
  globeAbove?: number;
  /**
   * Looks at a long route from nearer the equator. A great circle through the
   * centre of the view is a straight line; seen from the side it bows toward
   * the pole, the way flights do on a map.
   */
  tilt?: boolean;
}

const vector = ([longitude, latitude]: Coordinate) => {
  const lambda = longitude * Math.PI / 180;
  const phi = latitude * Math.PI / 180;
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
};

function tilted(points: readonly Coordinate[], center: Coordinate): Coordinate {
  let pair: [Coordinate, Coordinate] = [points[0], points[0]];
  let extent = 0;
  for (const a of points) for (const b of points) {
    const distance = geoDistance(a, b);
    if (distance > extent) {
      extent = distance;
      pair = [a, b];
    }
  }
  const angle = Math.min(.5, extent * .32);
  if (angle < .05) return center;
  const [ax, ay, az] = vector(pair[0]);
  const [bx, by, bz] = vector(pair[1]);
  let [nx, ny, nz] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  const length = Math.hypot(nx, ny, nz) || 1;
  const [mx, my, mz] = vector(center);
  // Step off the route toward the equator.
  const side = (nz / length) * mz > 0 ? -1 : 1;
  [nx, ny, nz] = [nx / length * side, ny / length * side, nz / length * side];
  const x = Math.cos(angle) * mx + Math.sin(angle) * nx;
  const y = Math.cos(angle) * my + Math.sin(angle) * ny;
  const z = Math.cos(angle) * mz + Math.sin(angle) * nz;
  return [Math.atan2(y, x) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, z))) * 180 / Math.PI];
}

export function fitCamera(points: readonly Coordinate[], box: Box, { shape, minSpanKm, globeAbove = 2.4, tilt = false }: FitOptions): Camera {
  const mean = sphericalMean(points);
  const center = tilt ? tilted(points, mean) : mean;
  const radius = Math.min(box.width, box.height) / 2;
  if (angularExtent(points) > globeAbove) {
    return { center, scale: radius * (shape === 'circle' ? .98 : .94), offset: [box.x + box.width / 2, box.y + box.height / 2] };
  }
  const unit = geoOrthographic().rotate([-center[0], -center[1]]).scale(1).translate([0, 0]);
  const projected = points.map(point => unit(point) ?? [0, 0]);
  const minimum = minSpanKm / EARTH_KM;
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, y] of projected) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  let scale: number;
  if (shape === 'circle') {
    const reach = Math.max(minimum / 2, ...projected.map(([x, y]) => Math.hypot(x - midX, y - midY)));
    scale = radius / reach;
  } else {
    scale = Math.min(box.width / Math.max(maxX - minX, minimum), box.height / Math.max(maxY - minY, minimum));
  }
  // Never zoom out past the whole globe.
  scale = Math.max(scale, radius * .94);
  return { center, scale, offset: [box.x + box.width / 2 - scale * midX, box.y + box.height / 2 - scale * midY] };
}

/** Flies between cameras, easing out to a wider view when the move is long. */
export function interpolateCamera(from: Camera, to: Camera, viewport: number) {
  const center = geoInterpolate(from.center, to.center);
  const travel = geoDistance(from.center, to.center) * Math.min(from.scale, to.scale);
  const lift = travel > viewport ? Math.min(Math.log(travel / viewport) * .8, 2.2) : 0;
  const a = Math.log(from.scale);
  const b = Math.log(to.scale);
  return (t: number): Camera => ({
    center: center(t) as Coordinate,
    scale: Math.exp(a + (b - a) * t - lift * Math.sin(Math.PI * t)),
    offset: [from.offset[0] + (to.offset[0] - from.offset[0]) * t, from.offset[1] + (to.offset[1] - from.offset[1]) * t],
  });
}

export const easeInOut = (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** Where the sun is overhead, accurate to a degree or so: enough for a soft night side. */
export function subsolarPoint(date: Date): Coordinate {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = (date.getTime() - start) / 864e5;
  const declination = -23.44 * Math.cos(2 * Math.PI / 365 * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  return [((-15 * (hours - 12) + 540) % 360) - 180, declination];
}
