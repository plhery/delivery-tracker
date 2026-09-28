// Builds src/server/places/places.tsv.br, the offline gazetteer that turns the
// free-text locations carriers print into map places.
//
// Sources, downloaded into a cache directory on the first run:
// - GeoNames cities1000 and postal codes, CC BY 4.0: https://www.geonames.org
// - Country label points from src/components/map/world.json (Natural Earth, public domain)
//
// Run: node scripts/generate-places.mjs [cache directory]. Needs `unzip`.
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { nameKey, nameKeys } from '../src/server/places/names.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = process.argv[2] ?? '/tmp/delivery-tracker-places';
const output = join(root, 'src/server/places/places.tsv.br');
// Small towns in these countries often host sorting centres, so every
// locality in their postal files becomes a place.
const LOCALITY_COUNTRIES = ['CH', 'LI', 'AT', 'DE', 'FR', 'IT'];
// Only these carriers print postcodes ("Härkingen 4622").
const POSTCODE_COUNTRIES = new Set(['CH', 'LI']);
// Exonyms and translations ("Genf", "Cologne") matter for towns, not hamlets,
// and for smaller towns only where they have several official names.
const ALTERNATES_FROM = 50_000;
const BILINGUAL_FROM = 10_000;
const MULTILINGUAL = new Set(['CH', 'LI', 'AT', 'DE', 'FR', 'IT', 'BE', 'LU', 'NL']);
const SKIPPED_FEATURES = new Set(['PPLH', 'PPLQ', 'PPLW', 'PPLCH']);

async function download(file, url) {
  const path = join(cache, file);
  try {
    await access(path);
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    await mkdir(cache, { recursive: true });
    await writeFile(path, Buffer.from(await response.arrayBuffer()));
  }
  return path;
}

const unzip = (zip, entry) => execFileSync('unzip', ['-p', zip, entry], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
const lines = (text) => text.split('\n').filter(Boolean).map((line) => line.split('\t'));
// About 100 m: plenty for a dot on a city.
const round = (value) => Math.round(Number(value) * 1e3) / 1e3;
const latin = (name) => /^[\p{Script=Latin} '’.\-()]{3,40}$/u.test(name) && !/^[A-Z]{2,5}$/.test(name);

function distanceKm([lat1, lon1], [lat2, lon2]) {
  const radians = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * radians / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin((lon2 - lon1) * radians / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

const cities = unzip(await download('cities1000.zip', 'https://download.geonames.org/export/dump/cities1000.zip'), 'cities1000.txt');
const places = [];
const byKey = new Map();
function remember(place) {
  places.push(place);
  for (const key of place.primary) {
    const list = byKey.get(`${place.country}:${key}`) ?? [];
    list.push(place);
    byKey.set(`${place.country}:${key}`, list);
  }
}

for (const [, name, ascii, alternates, lat, lon, featureClass, feature, country, , admin1, admin2, , , population] of lines(cities)) {
  if (featureClass !== 'P' || SKIPPED_FEATURES.has(feature)) continue;
  const primary = new Set([...nameKeys(name), ...nameKeys(ascii)]);
  const alternate = new Set();
  if (Number(population) >= (MULTILINGUAL.has(country) ? BILINGUAL_FROM : ALTERNATES_FROM)) {
    for (const other of alternates.split(',')) {
      if (!latin(other)) continue;
      for (const key of nameKeys(other)) if (!primary.has(key)) alternate.add(key);
    }
  }
  remember({
    name, ascii, country, admin1, admin2: country === 'FR' || country === 'IT' ? admin2 : '', lat: round(lat), lon: round(lon),
    population: Number(population) || 0, primary: [...primary], alternate: [...alternate],
  });
}
const listed = places.length;

// Postal files: every locality, and for CH and LI every postcode.
const postcodes = new Map();
for (const country of LOCALITY_COUNTRIES) {
  const rows = lines(unzip(await download(`${country}.zip`, `https://download.geonames.org/export/zip/${country}.zip`), `${country}.txt`));
  for (const [, code, rawName, , admin1, , admin2, , , lat, lon, accuracy] of rows) {
    // "Buchs SG 1" and "Paris 01" are postal subdivisions of "Buchs" and "Paris".
    const name = rawName.replace(/(\s+(\d+|[A-Z]{2}|SC|PF))+$/u, '').trim();
    const point = [round(lat), round(lon)];
    if (POSTCODE_COUNTRIES.has(country) && !postcodes.has(`${country}:${code}`)) {
      postcodes.set(`${country}:${code}`, { country, code, name, lat: point[0], lon: point[1] });
    }
    // Rows without an accuracy are companies and post boxes, not places.
    if (!accuracy || !latin(name)) continue;
    const keys = nameKeys(name);
    const known = keys.some((key) => (byKey.get(`${country}:${key}`) ?? [])
      .some((place) => distanceKm(point, [place.lat, place.lon]) < 15));
    if (known) continue;
    remember({
      name, ascii: name, country, admin1, admin2: country === 'FR' || country === 'IT' ? admin2 : '', lat: point[0], lon: point[1],
      population: 0, primary: keys, alternate: [],
    });
  }
}

const world = JSON.parse(await readFile(join(root, 'src/components/map/world.json'), 'utf8'));
const countries = world.countries.filter((country) => country.code && country.label)
  .map((country) => [country.code, country.name, country.label[0], country.label[1]])
  .sort(([a], [b]) => a.localeCompare(b));

places.sort((a, b) => a.country.localeCompare(b.country) || nameKey(a.name).localeCompare(nameKey(b.name)) || a.lat - b.lat || a.lon - b.lon);
const text = [
  '# Places for carrier scan locations. Generated by scripts/generate-places.mjs.',
  '# GeoNames (https://www.geonames.org), CC BY 4.0. Country points: Natural Earth, public domain.',
  ...countries.map((country) => ['C', ...country].join('\t')),
  // Primary keys are recomputed from the names when the file is read, and
  // population in thousands is all the ranking needs.
  ...places.map((place) => ['P', place.name, nameKey(place.ascii) === nameKey(place.name) ? '' : place.ascii, place.country,
    place.admin1, place.admin2, place.lat, place.lon, Math.round(place.population / 1000), place.alternate.join(',')].join('\t')),
  ...[...postcodes.values()].sort((a, b) => a.country.localeCompare(b.country) || a.code.localeCompare(b.code))
    .map((entry) => ['Z', entry.country, entry.code, entry.lat, entry.lon, entry.name].join('\t')),
].join('\n');
const compressed = brotliCompressSync(text, { params: {
  [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: text.length,
} });
await writeFile(output, compressed);
console.log(`places.tsv.br: ${countries.length} countries, ${listed} GeoNames places, ${places.length - listed} postal localities, `
  + `${postcodes.size} postcodes, ${Math.round(text.length / 1024)} KB, ${Math.round(compressed.length / 1024)} KB compressed`);
