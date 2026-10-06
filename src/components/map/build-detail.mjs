// Builds what the parcel map shows up close: rivers, lakes, built-up areas and main roads from public-domain
// Natural Earth data, and towns from GeoNames (CC BY 4.0). The world is cut into tiles, so a map only reads
// the part it shows.
// Run: node src/components/map/build-detail.mjs [cache directory]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const cache = process.argv[2] ?? '/tmp/delivery-tracker-geo';
const tiles = join(here, '..', '..', '..', 'public', 'atlas');
const naturalEarth = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const TOWNS = 'cities15000';
const sources = {
  rivers: ['ne_10m_rivers_lake_centerlines', 'ne_10m_rivers_europe', 'ne_10m_rivers_north_america', 'ne_10m_rivers_australia'],
  lakes: ['ne_10m_lakes', 'ne_10m_lakes_europe', 'ne_10m_lakes_north_america', 'ne_10m_lakes_australia'],
  urban: ['ne_10m_urban_areas'],
  roads: ['ne_10m_roads'],
};
const DEGREES = 5;
const PRECISION = 1000;
// How far a simplified line may stray from the drawn one, in degrees.
const TOLERANCE = { rivers: .0025, lakes: .002, urban: .004, roads: .0025 };
// The smallest lake and built-up area worth a shape, in square degrees.
const SMALLEST = { lakes: .00004, urban: .0004 };

async function download(url, file) {
  try {
    return await readFile(file);
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    await mkdir(cache, { recursive: true });
    await writeFile(file, data);
    return data;
  }
}

async function features(name) {
  const data = await download(`${naturalEarth}/${name}.geojson`, join(cache, `${name}.geojson`));
  return JSON.parse(data.toString('utf8')).features.filter(feature => feature.geometry);
}

function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    let farthest = -1;
    let distance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const [px, py] = points[index];
      const d = length ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / length : Math.hypot(px - ax, py - ay);
      if (d > distance) {
        distance = d;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

/** Twice a ring's area, positive when it runs clockwise on a map with north up. */
function winding(ring) {
  let area = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    area += (ring[previous][0] - ring[index][0]) * (ring[previous][1] + ring[index][1]);
  }
  return -area;
}

const area = ring => Math.abs(winding(ring)) / 2;
/** Outlines run clockwise and the islands in them the other way, so filling by winding leaves the islands dry. */
const wound = (ring, clockwise) => (winding(ring) > 0) === clockwise ? ring : [...ring].reverse();

/** The parts of a line inside a box. */
function clipLine(points, [west, south, east, north]) {
  const parts = [];
  let part = [];
  const push = (point) => {
    const last = part.at(-1);
    if (!last || last[0] !== point[0] || last[1] !== point[1]) part.push(point);
  };
  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay] = points[index - 1];
    const [bx, by] = points[index];
    let enter = 0;
    let leave = 1;
    let outside = false;
    for (const [delta, low, high] of [[bx - ax, west - ax, east - ax], [by - ay, south - ay, north - ay]]) {
      if (delta === 0) {
        if (low > 0 || high < 0) outside = true;
      } else {
        enter = Math.max(enter, Math.min(low / delta, high / delta));
        leave = Math.min(leave, Math.max(low / delta, high / delta));
      }
    }
    if (outside || enter > leave) {
      if (part.length > 1) parts.push(part);
      part = [];
      continue;
    }
    if (enter > 0 && part.length) {
      if (part.length > 1) parts.push(part);
      part = [];
    }
    push([ax + (bx - ax) * enter, ay + (by - ay) * enter]);
    push([ax + (bx - ax) * leave, ay + (by - ay) * leave]);
    if (leave < 1) {
      if (part.length > 1) parts.push(part);
      part = [];
    }
  }
  if (part.length > 1) parts.push(part);
  return parts;
}

/** The part of a ring inside a box: where the ring leaves the box, its outline follows the box's edge. */
function clipRing(ring, [west, south, east, north]) {
  let points = ring;
  for (const [axis, limit, keepsAbove] of [[0, west, true], [0, east, false], [1, south, true], [1, north, false]]) {
    const inside = point => keepsAbove ? point[axis] >= limit : point[axis] <= limit;
    const next = [];
    for (let index = 0; index < points.length; index += 1) {
      const a = points[(index + points.length - 1) % points.length];
      const b = points[index];
      if (inside(a) !== inside(b)) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        const crossing = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        crossing[axis] = limit;
        next.push(crossing);
      }
      if (inside(b)) next.push(b);
    }
    points = next;
    if (points.length < 3) return [];
  }
  return points;
}

/** A level and the points that follow it: the first as it is, each next one as its step from the one before. */
function encode(level, points, closed) {
  const flat = [level];
  let x = 0;
  let y = 0;
  let count = 0;
  for (const [longitude, latitude] of points) {
    const qx = Math.round(longitude * PRECISION);
    const qy = Math.round(latitude * PRECISION);
    if (count && qx === x && qy === y) continue;
    flat.push(qx - x, qy - y);
    x = qx;
    y = qy;
    count += 1;
  }
  // A closed ring ends where it began, which the reader knows.
  if (closed && count > 1 && x === flat[1] && y === flat[2]) {
    flat.length -= 2;
    count -= 1;
  }
  return count >= (closed ? 3 : 2) ? flat : null;
}

const world = new Map();
function tile(x, y) {
  const key = `${x}_${y}`;
  if (!world.has(key)) world.set(key, { rivers: [], lakes: [], urban: [], roads: [], towns: [] });
  return world.get(key);
}
const column = longitude => Math.max(0, Math.min(360 / DEGREES - 1, Math.floor((longitude + 180) / DEGREES)));
const row = latitude => Math.max(0, Math.min(180 / DEGREES - 1, Math.floor((latitude + 90) / DEGREES)));

/** Hands a shape to every tile it reaches, cut to that tile. */
function place(layer, level, points, closed) {
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [longitude, latitude] of points) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }
  for (let x = column(west); x <= column(east); x += 1) {
    for (let y = row(south); y <= row(north); y += 1) {
      const box = [x * DEGREES - 180, y * DEGREES - 90, (x + 1) * DEGREES - 180, (y + 1) * DEGREES - 90];
      const parts = closed ? [clipRing(points, box)] : clipLine(points, box);
      for (const part of parts) {
        const flat = part.length ? encode(level, part, closed) : null;
        if (flat) tile(x, y)[layer].push(flat);
      }
    }
  }
}

const lines = geometry => geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
const polygons = geometry => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
/** Three levels of importance: 0 shows first as the map closes in, 2 last. */
const level = (rank, first, second) => rank <= first ? 0 : rank <= second ? 1 : 2;

for (const name of sources.rivers) {
  for (const { properties, geometry } of await features(name)) {
    // A river is drawn to the lake it runs into, not across it.
    if (properties.featurecla === 'Lake Centerline') continue;
    for (const line of lines(geometry)) place('rivers', level(properties.scalerank ?? 12, 5, 9), simplify(line, TOLERANCE.rivers), false);
  }
}

const seen = new Set();
for (const name of sources.lakes) {
  for (const { geometry } of await features(name)) {
    for (const [outline, ...islands] of polygons(geometry)) {
      const [x, y] = outline[0];
      // The regional files repeat some of the world's lakes.
      const key = `${Math.round(x * 50)},${Math.round(y * 50)},${Math.round(area(outline) * 1000)}`;
      if (seen.has(key) || area(outline) < SMALLEST.lakes) continue;
      seen.add(key);
      // Every lake shows as soon as the tiles do: the wide map already draws the large ones.
      place('lakes', 0, wound(simplify(outline, TOLERANCE.lakes), true), true);
      for (const island of islands) {
        if (area(island) >= SMALLEST.lakes * 4) place('lakes', 0, wound(simplify(island, TOLERANCE.lakes), false), true);
      }
    }
  }
}

for (const { properties, geometry } of await features(sources.urban[0])) {
  for (const [outline] of polygons(geometry)) {
    if (area(outline) < SMALLEST.urban) continue;
    place('urban', level(properties.scalerank ?? 9, 5, 7), wound(simplify(outline, TOLERANCE.urban), true), true);
  }
}

for (const { properties, geometry } of await features(sources.roads[0])) {
  if (/ferry|track/i.test(properties.type ?? '')) continue;
  for (const line of lines(geometry)) place('roads', level(properties.scalerank ?? 9, 4, 6), simplify(line, TOLERANCE.roads), false);
}

// Towns the wide map has no room for. The cities it does name stay as it names them.
const cities = JSON.parse(await readFile(join(here, 'world.json'), 'utf8')).cities;
const km = (a, b) => {
  const radians = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * radians / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin((b[0] - a[0]) * radians / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const plain = name => name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const cityGrid = new Map();
for (const city of cities) {
  const key = `${Math.round(city[0])},${Math.round(city[1])}`;
  cityGrid.set(key, [...(cityGrid.get(key) ?? []), city]);
}
const named = (longitude, latitude, name) => {
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
    for (const city of cityGrid.get(`${Math.round(longitude) + dx},${Math.round(latitude) + dy}`) ?? []) {
      const distance = km([longitude, latitude], city);
      if (distance < 4 || (distance < 15 && (plain(city[2]) === plain(name) || plain(name).startsWith(`${plain(city[2])} `)))) return true;
    }
  }
  return false;
};
await download(`https://download.geonames.org/export/dump/${TOWNS}.zip`, join(cache, `${TOWNS}.zip`));
const rows = execFileSync('unzip', ['-p', join(cache, `${TOWNS}.zip`), `${TOWNS}.txt`], { maxBuffer: 1 << 28 }).toString('utf8').split('\n');
for (const line of rows) {
  const [, name, , , latitude, longitude, kind, code, , , , , , , population] = line.split('\t');
  // A town, not a district of one, nor a place that is no more.
  if (kind !== 'P' || /^PPL[XHQW]|^PPLCH$|^STLMT$/.test(code)) continue;
  const point = [Number(longitude), Number(latitude)];
  if (named(point[0], point[1], name)) continue;
  tile(column(point[0]), row(point[1])).towns.push([Math.round(point[0] * PRECISION), Math.round(point[1] * PRECISION), name, Math.round(Number(population) / 1000)]);
}

await rm(tiles, { recursive: true, force: true });
await mkdir(tiles, { recursive: true });
const hash = createHash('sha256');
const keys = [...world.keys()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
let bytes = 0;
let packed = 0;
const points = { rivers: 0, lakes: 0, urban: 0, roads: 0 };
for (const key of keys) {
  const content = world.get(key);
  for (const layer of Object.keys(points)) {
    content[layer].sort((a, b) => a[0] - b[0]);
    points[layer] += content[layer].reduce((sum, flat) => sum + (flat.length - 1) / 2, 0);
  }
  // The largest towns first: they are the first to be named.
  content.towns.sort((a, b) => b[3] - a[3] || a[2].localeCompare(b[2], 'en'));
  const json = Buffer.from(JSON.stringify(content));
  const data = deflateRawSync(json, { level: 9 });
  hash.update(key).update(json);
  bytes += json.length;
  packed += data.length;
  await writeFile(join(tiles, `${key}.bin`), data);
}
await writeFile(join(here, 'detail.json'), `${JSON.stringify({
  source: 'Natural Earth 1:10m rivers, lakes, urban areas and roads; GeoNames cities',
  license: 'Natural Earth: public domain, https://www.naturalearthdata.com/about/terms-of-use/. GeoNames: CC BY 4.0, https://www.geonames.org/',
  // Changes with the tiles, so a browser never keeps a tile from an older set.
  version: hash.digest('hex').slice(0, 12),
  degrees: DEGREES,
  precision: PRECISION,
  tiles: keys,
})}\n`);
const towns = keys.reduce((sum, key) => sum + world.get(key).towns.length, 0);
console.log(`${keys.length} tiles, ${(bytes / 1e6).toFixed(1)} MB as JSON, ${(packed / 1e6).toFixed(1)} MB packed: ${towns} towns, `
  + Object.entries(points).map(([layer, count]) => `${count} points of ${layer}`).join(', '));
