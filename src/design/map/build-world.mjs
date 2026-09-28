// Builds world.json for the map design study from public-domain Natural Earth data.
// Run: node src/design/map/build-world.mjs [cache directory]
// Borders come from world-atlas, which keeps Natural Earth's shared arcs, so
// simplifying an arc moves both neighbouring countries together.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cache = process.argv[2] ?? '/tmp/delivery-tracker-geo';
const output = join(dirname(fileURLToPath(import.meta.url)), 'world.json');
const sources = {
  atlas: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json',
  countries: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
  lakes: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson',
  europeanLakes: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes_europe.geojson',
  places: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson',
};
const PRECISION = 1000;
const TOLERANCE = { coarse: .12, fine: .018 };
// Lakes small enough to matter only in close-ups are kept around the Alps.
const ALPS = [5, 44.9, 12.6, 48.4];

async function load(name) {
  const file = join(cache, `${name}.json`);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    const response = await fetch(sources[name]);
    if (!response.ok) throw new Error(`${sources[name]}: ${response.status}`);
    const text = await response.text();
    await mkdir(cache, { recursive: true });
    await writeFile(file, text);
    return JSON.parse(text);
  }
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

function encode(points) {
  const flat = [];
  let x = 0;
  let y = 0;
  for (const [longitude, latitude] of points) {
    const qx = Math.round(longitude * PRECISION);
    const qy = Math.round(latitude * PRECISION);
    if (flat.length && qx === x && qy === y) continue;
    flat.push(qx - x, qy - y);
    x = qx;
    y = qy;
  }
  return flat;
}

function bounds(rings) {
  const xs = rings.flat().map(point => point[0]);
  const ys = rings.flat().map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Natural Earth follows RFC 7946 (anticlockwise exteriors); d3-geo expects clockwise.
function clockwise(ring) {
  let area = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    area += (ring[previous][0] - ring[index][0]) * (ring[previous][1] + ring[index][1]);
  }
  return area < 0 ? ring : [...ring].reverse();
}

const [atlas, countries, lakes, europeanLakes, places] = await Promise.all(Object.keys(sources).map(load));
const [scaleX, scaleY] = atlas.transform.scale;
const [translateX, translateY] = atlas.transform.translate;
const arcs = atlas.arcs.map(arc => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scaleX + translateX, y * scaleY + translateY];
  });
});

const byNumber = new Map(countries.features.map(feature => [feature.properties.ISO_N3_EH, feature.properties]));
const byName = new Map(countries.features.map(feature => [feature.properties.NAME, feature.properties]));
const arcOwners = arcs.map(() => new Set());
const shapes = atlas.objects.countries.geometries.flatMap((geometry, index) => {
  const properties = byNumber.get(geometry.id) ?? byName.get(geometry.properties.name);
  const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.type === 'MultiPolygon' ? geometry.arcs : [];
  for (const arc of polygons.flat(2)) arcOwners[arc < 0 ? ~arc : arc].add(index);
  const code = properties?.ISO_A2_EH && properties.ISO_A2_EH !== '-99' ? properties.ISO_A2_EH : null;
  return polygons.length ? [{
    code,
    name: properties?.NAME ?? geometry.properties.name,
    label: properties ? [Math.round(properties.LABEL_X * 100) / 100, Math.round(properties.LABEL_Y * 100) / 100] : null,
    rank: properties?.LABELRANK ?? 10,
    polygons,
  }] : [];
});

function lakeRings(feature) {
  const geometry = feature.geometry;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map(polygon => clockwise(polygon[0]));
}

const seen = new Set();
const lakeShapes = [...lakes.features, ...europeanLakes.features].flatMap(feature => {
  const rings = lakeRings(feature);
  const [west, south, east, north] = bounds(rings);
  const alpine = west > ALPS[0] && east < ALPS[2] && south > ALPS[1] && north < ALPS[3];
  const large = (feature.properties.scalerank ?? 99) <= 2;
  const size = (east - west) * (north - south);
  const key = `${Math.round(west * 20)},${Math.round(south * 20)},${Math.round(east * 20)}`;
  if ((!large && !(alpine && size > .004)) || seen.has(key)) return [];
  seen.add(key);
  return rings.map(ring => encode(simplify(ring, large ? .04 : .004)));
}).filter(ring => ring.length >= 8);

// Cities give close-ups their bearings; small towns would only add noise.
const cities = places.features
  .map(({ properties }) => properties)
  .filter(city => city.scalerank <= 7 && city.pop_max >= 90000)
  .sort((a, b) => a.scalerank - b.scalerank || b.pop_max - a.pop_max)
  .map(city => [Math.round(city.longitude * 100) / 100, Math.round(city.latitude * 100) / 100, city.name, city.scalerank]);

const world = {
  source: 'Natural Earth 1:50m countries (via world-atlas) and 1:10m lakes',
  license: 'Public domain: https://www.naturalearthdata.com/about/terms-of-use/',
  precision: PRECISION,
  arcs: Object.fromEntries(Object.entries(TOLERANCE).map(([level, tolerance]) => [level, arcs.map(arc => encode(simplify(arc, tolerance)))])),
  // Arcs shared by two countries are land borders; the rest are coastline.
  borders: arcOwners.flatMap((owners, index) => owners.size > 1 ? [index] : []),
  countries: shapes,
  lakes: lakeShapes,
  cities,
};
await writeFile(output, JSON.stringify(world));
const points = level => world.arcs[level].reduce((sum, arc) => sum + arc.length / 2, 0);
console.log(`world.json: ${shapes.length} countries, ${lakeShapes.length} lakes, ${cities.length} cities, ${points('coarse')} coarse and ${points('fine')} fine points`);
