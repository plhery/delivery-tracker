// What the map shows up close: rivers, lakes, built-up areas, main roads and towns. The world is cut into tiles
// (`build-detail.mjs`), which the site serves itself, so a close-up reads the few tiles it shows and no map service is asked.
import { CLOSE_UP_KM, type Camera } from './camera';
import index from './detail.json';
import type { Coordinate } from './world';

type Vector = [x: number, y: number, z: number];

/** A line or an outline as unit vectors, three numbers a point, with the smallest cap around it. */
export interface DetailShape {
  /** 0 for what shows first as the map closes in, 2 for what shows last. */
  level: number;
  points: Float64Array;
  /** The points where the shape was cut at its tile's edge: its outline keeps its corner there, to meet the rest of the shape. */
  cut: Uint8Array;
  center: Vector;
  /** In radians. */
  radius: number;
}

export interface Town {
  coordinate: Coordinate;
  name: string;
  /** Its inhabitants, in thousands. */
  thousands: number;
}

export interface DetailTile {
  rivers: DetailShape[];
  lakes: DetailShape[];
  urban: DetailShape[];
  roads: DetailShape[];
  /** The largest first. */
  towns: Town[];
}

type Layer = 'rivers' | 'lakes' | 'urban' | 'roads';
type TileFile = Record<Layer, number[][]> & { towns: [number, number, string, number][] };

const EARTH_KM = 6371;
/** Where each level starts to show, in kilometres across the view, and where it is fully there. */
const LEVELS = [[CLOSE_UP_KM, 440], [400, 320], [230, 170]] as const;
/** Tiles kept once read: a few journeys' worth. */
const KEPT = 16;

const known = new Set(index.tiles);
// In the order they were last asked for, the oldest first. A new map takes its place whenever a tile is read.
let tiles = new Map<string, DetailTile>();
const asked = new Set<string>();
const listeners = new Set<() => void>();
const NONE: ReadonlyMap<string, DetailTile> = new Map();

/** The tiles read so far, by their key: a new map whenever one has been read. */
export const detailRead = (): ReadonlyMap<string, DetailTile> => tiles;
/** What a page drawn on the server has read. */
export const noDetail = () => NONE;

/** Tells `listener` when a tile has been read; returns how to stop listening. */
export function onDetailLoaded(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function shape(flat: readonly number[], precision: number): DetailShape {
  const count = (flat.length - 1) / 2;
  const points = new Float64Array(count * 3);
  const cut = new Uint8Array(count);
  const edge = index.degrees * precision;
  let longitude = 0;
  let latitude = 0;
  const sum: Vector = [0, 0, 0];
  for (let index = 0; index < count; index += 1) {
    longitude += flat[1 + index * 2];
    latitude += flat[2 + index * 2];
    if (longitude % edge === 0 || latitude % edge === 0) cut[index] = 1;
    const lambda = longitude / precision * Math.PI / 180;
    const phi = latitude / precision * Math.PI / 180;
    const vector: Vector = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
    points.set(vector, index * 3);
    for (let axis = 0; axis < 3; axis += 1) sum[axis] += vector[axis];
  }
  const length = Math.hypot(...sum) || 1;
  const center: Vector = [sum[0] / length, sum[1] / length, sum[2] / length];
  let nearest = 1;
  for (let index = 0; index < count; index += 1) {
    nearest = Math.min(nearest, points[index * 3] * center[0] + points[index * 3 + 1] * center[1] + points[index * 3 + 2] * center[2]);
  }
  return { level: flat[0], points, cut, center, radius: Math.acos(Math.max(-1, nearest)) };
}

/** A tile as its file holds it: each shape a level, then its points as steps from one to the next. */
export function decodeTile(file: TileFile, precision = index.precision): DetailTile {
  const layer = (name: Layer) => (file[name] ?? []).map(flat => shape(flat, precision));
  return {
    rivers: layer('rivers'),
    lakes: layer('lakes'),
    urban: layer('urban'),
    roads: layer('roads'),
    towns: (file.towns ?? []).map(([longitude, latitude, name, thousands]) => ({ coordinate: [longitude / precision, latitude / precision], name, thousands })),
  };
}

async function read(key: string): Promise<DetailTile> {
  const response = await fetch(`/atlas/${key}.bin?v=${index.version}`);
  if (!response.ok || !response.body) throw new Error(`Map tile ${key}: ${response.status}`);
  const file = await new Response(response.body.pipeThrough(new DecompressionStream('deflate-raw'))).json() as TileFile;
  return decodeTile(file);
}

/** Asks for the tiles that are not read yet. A tile that cannot be read, as when offline, is asked for again later. */
export function loadDetail(keys: readonly string[]): void {
  if (typeof fetch === 'undefined' || typeof DecompressionStream === 'undefined') return;
  for (const key of keys) {
    const tile = tiles.get(key);
    if (tile) {
      // Shown last, so dropped last.
      tiles.delete(key);
      tiles.set(key, tile);
    }
    if (!known.has(key) || tile || asked.has(key)) continue;
    asked.add(key);
    read(key).then((tile) => {
      asked.delete(key);
      const next = new Map(tiles).set(key, tile);
      for (const oldest of next.keys()) {
        if (next.size <= KEPT) break;
        next.delete(oldest);
      }
      tiles = next;
      for (const listener of listeners) listener();
    }, () => {
      setTimeout(() => asked.delete(key), 30_000);
    });
  }
}

/** The directions of the screen on the globe: toward the viewer through the camera's centre, and to the right and up there. */
function basis(camera: Camera): { forward: Vector; east: Vector; north: Vector } {
  const lambda = camera.center[0] * Math.PI / 180;
  const phi = camera.center[1] * Math.PI / 180;
  return {
    forward: [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)],
    east: [-Math.sin(lambda), Math.cos(lambda), 0],
    north: [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)],
  };
}

/** How wide the view is across its shorter side, in kilometres. */
export const spanKm = (camera: Camera, size: { width: number; height: number }) => Math.min(size.width, size.height) / camera.scale * EARTH_KM;

/** The tiles a close-up shows; none while the view is too wide for them. */
export function tilesInView(camera: Camera, size: { width: number; height: number }): string[] {
  if (spanKm(camera, size) >= CLOSE_UP_KM) return [];
  const { forward, east, north } = basis(camera);
  const keys = new Set<string>();
  // The view is far smaller than a tile, so a few points across it find every tile it touches.
  for (let column = 0; column <= 6; column += 1) {
    for (let row = 0; row <= 8; row += 1) {
      const x = (size.width * column / 6 - camera.offset[0]) / camera.scale;
      const y = (camera.offset[1] - size.height * row / 8) / camera.scale;
      const depth = 1 - x * x - y * y;
      if (depth < 0) continue;
      const z = Math.sqrt(depth);
      const vector = [0, 1, 2].map(axis => east[axis] * x + north[axis] * y + forward[axis] * z);
      const longitude = Math.atan2(vector[1], vector[0]) * 180 / Math.PI;
      const latitude = Math.asin(Math.max(-1, Math.min(1, vector[2]))) * 180 / Math.PI;
      const key = `${Math.min(360 / index.degrees - 1, Math.floor((longitude + 180) / index.degrees))}_${Math.min(180 / index.degrees - 1, Math.floor((latitude + 90) / index.degrees))}`;
      if (known.has(key)) keys.add(key);
    }
  }
  return [...keys].sort();
}

/** How strongly each level shows in a view this wide: 0 not at all, 1 fully. */
export const levelStrengths = (kilometres: number) => LEVELS.map(([from, full]) => Math.max(0, Math.min(1, (from - kilometres) / (from - full))));

export interface DetailColors { water: string; urban: string; road: string }

/**
 * Draws the tiles over the land: built-up areas, then roads, then water. Up close the globe is all but flat, so
 * a point's place on screen is two dot products, and a shape the view cannot hold is skipped whole. The shapes are
 * drawn for a far wider view than the closest one, so their corners are rounded: a river bends, it does not turn.
 */
export function paintDetail(context: CanvasRenderingContext2D, shown: readonly DetailTile[], camera: Camera,
  size: { width: number; height: number }, colors: DetailColors, cutsWater: boolean) {
  const kilometres = spanKm(camera, size);
  const strengths = levelStrengths(kilometres);
  if (!shown.length || strengths[0] <= 0) return;
  const { forward, east, north } = basis(camera);
  const [offsetX, offsetY] = camera.offset;
  const scale = camera.scale;
  const reach = Math.max(...[[0, 0], [size.width, 0], [0, size.height], [size.width, size.height]]
    .map(([x, y]) => Math.hypot(x - offsetX, y - offsetY))) / scale;
  const angle = Math.asin(Math.min(1, reach)) + .01;
  const seen = ({ center, radius }: DetailShape) => Math.acos(Math.max(-1, Math.min(1, center[0] * forward[0] + center[1] * forward[1] + center[2] * forward[2]))) - radius < angle;
  let flat = new Float64Array(512);
  let sharp = new Uint8Array(256);
  const trace = ({ points, cut }: DetailShape, closed: boolean) => {
    const total = points.length / 3;
    if (flat.length < total * 2) {
      flat = new Float64Array(total * 2);
      sharp = new Uint8Array(total);
    }
    // A point that falls on the one before it adds nothing to the line: a wide view keeps one point in three.
    let count = 0;
    for (let index = 0; index < total; index += 1) {
      const at = index * 3;
      const x = offsetX + scale * (points[at] * east[0] + points[at + 1] * east[1]);
      const y = offsetY - scale * (points[at] * north[0] + points[at + 1] * north[1] + points[at + 2] * north[2]);
      if (count && !cut[index] && index < total - 1 && Math.abs(x - flat[count * 2 - 2]) + Math.abs(y - flat[count * 2 - 1]) < 1.6) continue;
      flat[count * 2] = x;
      flat[count * 2 + 1] = y;
      sharp[count] = cut[index];
      count += 1;
    }
    if (count < (closed ? 3 : 2)) return;
    // Each corner is rounded between the middles of the two sides that meet there.
    const first = closed ? 0 : 1;
    const last = closed ? count - 1 : count - 2;
    if (closed) context.moveTo((flat[count * 2 - 2] + flat[0]) / 2, (flat[count * 2 - 1] + flat[1]) / 2);
    else context.moveTo(flat[0], flat[1]);
    for (let index = first; index <= last; index += 1) {
      const next = (index + 1) % count;
      const x = flat[index * 2];
      const y = flat[index * 2 + 1];
      const middleX = (x + flat[next * 2]) / 2;
      const middleY = (y + flat[next * 2 + 1]) / 2;
      if (sharp[index]) {
        context.lineTo(x, y);
        context.lineTo(middleX, middleY);
      } else {
        context.quadraticCurveTo(x, y, middleX, middleY);
      }
    }
    if (closed) context.closePath();
    else context.lineTo(flat[count * 2 - 2], flat[count * 2 - 1]);
  };
  /** One path for each level of a layer, as strong as the level shows. */
  const layer = (name: Layer, closed: boolean, paint: (level: number) => void) => {
    for (let level = 0; level < strengths.length; level += 1) {
      if (strengths[level] <= 0) continue;
      context.beginPath();
      let any = false;
      for (const tile of shown) {
        for (const item of tile[name]) {
          // Shapes come sorted by level, and one too small to see is not worth its points.
          if (item.level > level) break;
          if (item.level < level || (closed && item.radius * scale < .6) || !seen(item)) continue;
          trace(item, closed);
          any = true;
        }
      }
      if (!any) continue;
      context.globalAlpha = strengths[level];
      paint(level);
    }
    context.globalAlpha = 1;
  };
  // Lines grow a little as the map closes in, like the map itself.
  const zoom = Math.max(1, Math.min(1.8, (260 / kilometres) ** .4));
  context.lineJoin = 'bevel';
  context.lineCap = 'butt';
  context.fillStyle = colors.urban;
  layer('urban', true, () => context.fill());
  context.strokeStyle = colors.road;
  layer('roads', false, (level) => {
    context.lineWidth = [1.15, .85, .65][level] * zoom;
    context.stroke();
  });
  if (cutsWater) context.globalCompositeOperation = 'destination-out';
  context.fillStyle = cutsWater ? '#000' : colors.water;
  context.strokeStyle = context.fillStyle;
  layer('rivers', false, (level) => {
    context.lineWidth = [1.4, 1.05, .8][level] * zoom;
    context.stroke();
  });
  layer('lakes', true, () => context.fill());
  context.globalCompositeOperation = 'source-over';
}
