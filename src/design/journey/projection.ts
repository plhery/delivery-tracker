import type { Coordinate } from './scenarios';

export type Point = readonly [x: number, y: number];
const radians = Math.PI / 180;

export function mercator([longitude, latitude]: Coordinate): Point {
  const clamped = Math.max(-85, Math.min(85, latitude)) * radians;
  return [longitude * radians, -Math.log(Math.tan(Math.PI / 4 + clamped / 2))];
}

export function fitJourney(coordinates: readonly Coordinate[], width: number, height: number, padding: { top: number; bottom: number } = { top: 55, bottom: 50 }) {
  const points = coordinates.map(mercator);
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // Keep single scans and short local journeys at a readable regional scale.
  const spanX = Math.max(maxX - minX, .028);
  const spanY = Math.max(maxY - minY, .018);
  const availableHeight = Math.max(height - padding.top - padding.bottom, 1);
  const scale = Math.min(Math.max(width - 130, 1) / spanX, availableHeight / spanY);
  const x = width / 2 - (minX + maxX) / 2 * scale;
  const y = padding.top + availableHeight / 2 - (minY + maxY) / 2 * scale;
  return {
    x, y, scale,
    project: (coordinate: Coordinate): Point => {
      const point = mercator(coordinate);
      return [point[0] * scale + x, point[1] * scale + y];
    },
  };
}

/** A visual connection between reported stops, not a measured transport route. */
export function connectionPath(from: Point, to: Point, curved: boolean): string {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const distance = Math.hypot(x2 - x1, y2 - y1);
  const bend = curved ? Math.min(distance * .2, 40) : 0;
  const direction = x2 >= x1 ? 1 : -1;
  const cx = (x1 + x2) / 2 + (distance ? (y2 - y1) / distance * bend * direction : 0);
  const cy = (y1 + y2) / 2 - (distance ? (x2 - x1) / distance * bend * direction : 0);
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
}
