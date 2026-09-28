import 'server-only';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import { ambiguousAddressCodes, trackingPlace } from '../../lib/trackingLocation';
import { nameKey, nameKeys } from './names.mjs';

/** Where a scan happened, as precisely as its free-text location allows. */
export interface EventPlace {
  latitude: number;
  longitude: number;
  precision: 'city' | 'country';
  /** ISO 3166-1 alpha-2. */
  country: string;
  name: string;
}

export interface PlaceHints {
  /** Countries the parcel is likely in, strongest first: neighbouring scans, destination, carrier. */
  countries?: readonly string[];
}

interface Gazetteer {
  names: string[];
  /** Country, admin1 and admin2 as indices into `codes`: most of 230,000 places share a few thousand codes. */
  codes: string[];
  country: Uint16Array;
  admin1: Uint16Array;
  admin2: Uint16Array;
  latitude: Float32Array;
  longitude: Float32Array;
  /** In thousands. Postal localities without a census count are 0. */
  population: Uint32Array;
  /** Place indices; alternate names (exonyms, translations) are stored as ~index. */
  keys: Map<string, number | number[]>;
  postcodes: Map<string, { latitude: number; longitude: number }>;
  countries: Map<string, { name: string; latitude: number; longitude: number }>;
}

const DATA = 'src/server/places/places.tsv.br';
// Words for facilities and services rather than places ("Agence DPD de La Crau", "PAKETZENTRUM").
const FACILITY_WORDS = new Set(`
  agence agency air airport area branch bureau cedex cidex center centre centro centrum clasificacion colis
  customs delivery depot deposito destination distribution distribuicao dogana douane export facility filiale
  gateway hub import international intl livraison local location logistics logistik mail oddzial office oficina
  operations operativo origin paketzentrum briefzentrum verteilzentrum sortierzentrum zustellbasis zustellstelle
  parcel parcels plateforme platform point postal postfiliale postfach poste pz bz return service services site
  smistamento sort sorting station terminal tratamento tri unidade ufficio warehouse zentrum zoll zollamt
  dhl ups fedex gls dpd tnt usps colissimo chronopost postnl bpost evri hermes cainiao yanwen parcelforce
  planzer quickpac amazon express post home house address recipient sender neighbourhood neighborhood unknown
`.trim().split(/\s+/));
const LEADING_WORDS = new Set(['de', 'du', 'des', 'di', 'da', 'del', 'della', 'von', 'of']);
// Carriers print provinces the way the post does; GeoNames numbers them.
const ADMIN_CODES: Record<string, Record<string, string>> = {
  CA: { AB: '01', BC: '02', MB: '03', NB: '04', NL: '05', NS: '07', ON: '08', PE: '09', QC: '10', SK: '11', YT: '12', NT: '13', NU: '14' },
  AU: { ACT: '01', NSW: '02', NT: '03', QLD: '04', SA: '05', TAS: '06', VIC: '07', WA: '08' },
  BR: {
    AC: '01', AL: '02', AP: '03', AM: '04', BA: '05', CE: '06', DF: '07', ES: '08', MS: '11', MA: '13', MT: '14', MG: '15',
    PA: '16', PB: '17', PR: '18', PI: '20', RJ: '21', RN: '22', RS: '23', RO: '24', RR: '25', SC: '26', SP: '27', SE: '28',
    GO: '29', PE: '30', TO: '31',
  },
};
// A place nothing else confirms has to be a known town, not a hamlet with the same name.
const UNCONFIRMED_MIN_THOUSANDS = 15;

let loaded: Gazetteer | null = null;

function gazetteer(): Gazetteer {
  if (loaded) return loaded;
  // Parsed straight from bytes: substrings of one decompressed string would keep all 10 MB of it alive.
  const bytes = brotliDecompressSync(readFileSync(resolve(process.cwd(), DATA)));
  const rows: string[][] = [];
  for (let start = 0; start < bytes.length;) {
    let end = bytes.indexOf(10, start);
    if (end < 0) end = bytes.length;
    const fields: string[] = [];
    for (let field = start; field <= end;) {
      let stop = bytes.indexOf(9, field);
      if (stop < 0 || stop > end) stop = end;
      fields.push(bytes.toString('utf8', field, stop));
      field = stop + 1;
    }
    rows.push(fields);
    start = end + 1;
  }
  const count = rows.filter((fields) => fields[0] === 'P').length;
  const data: Gazetteer = {
    names: [], codes: [],
    country: new Uint16Array(count), admin1: new Uint16Array(count), admin2: new Uint16Array(count),
    latitude: new Float32Array(count), longitude: new Float32Array(count), population: new Uint32Array(count),
    keys: new Map(), postcodes: new Map(), countries: new Map(),
  };
  const codeIndex = new Map<string, number>();
  const code = (value: string) => {
    let index = codeIndex.get(value);
    if (index === undefined) {
      index = data.codes.push(value) - 1;
      codeIndex.set(value, index);
    }
    return index;
  };
  const add = (key: string, entry: number) => {
    const existing = data.keys.get(key);
    if (existing === undefined) data.keys.set(key, entry);
    else if (typeof existing === 'number') {
      if (existing !== entry) data.keys.set(key, [existing, entry]);
    } else if (!existing.includes(entry)) existing.push(entry);
  };
  let index = 0;
  for (const fields of rows) {
    if (fields[0] === 'P') {
      const [, name, ascii, country, admin1, admin2, latitude, longitude, population, alternates] = fields;
      data.names.push(name);
      data.country[index] = code(country);
      data.admin1[index] = code(admin1);
      data.admin2[index] = code(admin2);
      data.latitude[index] = Number(latitude);
      data.longitude[index] = Number(longitude);
      data.population[index] = Number(population);
      for (const key of [...nameKeys(name), ...(ascii ? nameKeys(ascii) : [])]) add(key, index);
      for (const key of alternates ? alternates.split(',') : []) add(key, ~index);
      index += 1;
    } else if (fields[0] === 'Z') {
      const [, country, postcode, latitude, longitude] = fields;
      data.postcodes.set(`${country}:${postcode}`, { latitude: Number(latitude), longitude: Number(longitude) });
    } else if (fields[0] === 'C') {
      const [, country, name, longitude, latitude] = fields;
      data.countries.set(country, { name, latitude: Number(latitude), longitude: Number(longitude) });
    }
  }
  loaded = data;
  return data;
}

/** Loads the gazetteer ahead of the first request that needs it. */
export function preloadPlaces(): void {
  gazetteer();
}

function distanceKm(latitude1: number, longitude1: number, latitude2: number, longitude2: number): number {
  const radians = Math.PI / 180;
  const a = Math.sin((latitude2 - latitude1) * radians / 2) ** 2
    + Math.cos(latitude1 * radians) * Math.cos(latitude2 * radians) * Math.sin((longitude2 - longitude1) * radians / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

interface Token { key: string; start: number; end: number }

function tokens(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].flatMap((match) => {
    // "BARCELONA2": a depot number glued to the town.
    const word = /\p{L}/u.test(match[0]) ? match[0].replace(/\d+$/u, '') : match[0];
    const key = nameKey(word);
    return key ? [{ key, start: match.index, end: match.index + word.length }] : [];
  });
}

/** Phrases worth looking up, most specific first: "zurich mulligen", then "zurich". */
function phrases(field: string): { key: string; text: string; rank: number }[] {
  const all = tokens(field).filter((token) => !/^\d+$/.test(token.key));
  const found: { key: string; text: string; rank: number }[] = [];
  const add = (list: Token[], rank: number) => {
    if (!list.length) return;
    const key = list.map((token) => token.key).join(' ');
    if (key.length >= 3 && !found.some((phrase) => phrase.key === key)) {
      found.push({ key, text: field.slice(list[0].start, list.at(-1)!.end), rank });
    }
  };
  add(all, 0);
  let words = all.filter((token) => !FACILITY_WORDS.has(token.key));
  while (words.length && LEADING_WORDS.has(words[0].key)) words = words.slice(1);
  for (let count = words.length; count > 0; count -= 1) add(words.slice(0, count), words.length - count + 1);
  for (let start = 1; start < words.length; start += 1) add(words.slice(start), words.length + start);
  return found;
}

const candidate = (entry: number) => ({ index: entry < 0 ? ~entry : entry, alternate: entry < 0 });

/**
 * Turns one carrier location ("ZUERICH, CH", "Härkingen 4622", "Agence DPD de
 * La Crau (283)", "Germany") into a place, or null when the text names no
 * place we can be confident about. A wrong dot is worse than no dot.
 */
export function locatePlace(location: string | null | undefined, hints: PlaceHints = {}): EventPlace | null {
  const text = location?.trim();
  if (!text) return null;
  const data = gazetteer();
  const explicit = trackingPlace(text);
  let country = explicit.country && data.countries.has(explicit.country) ? explicit.country : null;
  let rest = explicit.country ? explicit.place : text;
  const hinted = [...(hints.countries ?? [])];
  const admin: string[] = [];
  const postcodes: string[] = [];

  // A trailing code without a comma ("ZUERICH CH"), or one that is also a state
  // or canton ("KOELN, DE", "Buchs SG"): a hint either way.
  const trailing = /[\s,;]+([A-Z]{2})$/.exec(rest)?.[1];
  if (!country && trailing && data.countries.has(trailing)) {
    rest = rest.slice(0, -trailing.length).replace(/[\s,;]+$/, '');
    hinted.unshift(trailing);
    admin.push(trailing);
    if (!/,|;/.test(text.slice(0, -trailing.length)) && !ambiguousAddressCodes.has(trailing)) country = trailing;
  }
  for (const match of rest.matchAll(/\b([A-Z]{2,3})\b/g)) admin.push(match[1]);
  for (const match of rest.matchAll(/(?:\b[A-Z]{1,2}-)?\b(\d{4,5})\b/g)) postcodes.push(match[1]);
  // French departments and Italian provinces in brackets: "Sausheim 68 (68)", "Cologne (BS)".
  for (const match of rest.matchAll(/\((\d{2}|[A-Z]{2})\)|(?:^|\s)(\d{2})(?=\s|$)/g)) admin.push(match[1] ?? match[2]);

  // Postcodes only confirm a name, and only in a country the scan or the parcel
  // names: on its own, "2024" is more likely a year than a village.
  const countries = country ? [country] : hinted;
  let postcode: { latitude: number; longitude: number; country: string } | null = null;
  for (const code of postcodes) {
    for (const candidateCountry of countries) {
      const entry = data.postcodes.get(`${candidateCountry}:${code}`);
      if (entry) {
        postcode = { ...entry, country: candidateCountry };
        break;
      }
    }
    if (postcode) break;
  }

  let best: { index: number; score: number; text: string } | null = null;
  const fields = rest.split(/[,;|()]|\s+-\s+/).map((field) => field.trim()).filter(Boolean);
  for (const [fieldIndex, field] of fields.entries()) {
    for (const phrase of phrases(field)) {
      for (const entry of [data.keys.get(phrase.key) ?? []].flat()) {
        const { index, alternate } = candidate(entry);
        const placeCountry = data.codes[data.country[index]];
        if (country && placeCountry !== country) continue;
        const hint = hinted.indexOf(placeCountry);
        const admin1 = data.codes[data.admin1[index]];
        const adminCodes = [admin1, data.codes[data.admin2[index]]].filter(Boolean);
        const adminMatch = admin.some((code) => adminCodes.includes(code) || ADMIN_CODES[placeCountry]?.[code] === admin1);
        const postcodeMatch = postcode !== null && postcode.country === placeCountry
          && distanceKm(postcode.latitude, postcode.longitude, data.latitude[index], data.longitude[index]) < 30;
        const confirmed = Boolean(country) || hint >= 0 || adminMatch || postcodeMatch;
        const thousands = data.population[index];
        if (!confirmed && thousands < UNCONFIRMED_MIN_THOUSANDS) continue;
        const score = Math.log10(Math.max(thousands, .3) * 1000)
          + (alternate ? 0 : 1.8)
          + (country ? 4 : hint >= 0 ? 2.5 - Math.min(hint, 3) * .4 : 0)
          + (adminMatch ? 3 : 0) + (postcodeMatch ? 3 : 0)
          - phrase.rank * .3 - fieldIndex * .5;
        if (!best || score > best.score) best = { index, score, text: phrase.text };
      }
    }
  }

  if (best) {
    const { index, text: written } = best;
    return {
      latitude: round(data.latitude[index]),
      longitude: round(data.longitude[index]),
      precision: 'city',
      country: data.codes[data.country[index]],
      // Keep the carrier's spelling unless it is shouting: "La Crau", but "Köln" for "KOELN".
      name: /\p{Ll}/u.test(written) ? written : data.names[index],
    };
  }
  const area = country ? data.countries.get(country) : null;
  return area && country ? { latitude: area.latitude, longitude: area.longitude, precision: 'country', country, name: area.name } : null;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

const cache = new Map<string, EventPlace | null>();
const CACHE_SIZE = 20_000;

function cachedPlace(location: string | null | undefined, countries: readonly string[]): EventPlace | null {
  const key = `${countries.join(',')}|${location ?? ''}`;
  if (cache.has(key)) return cache.get(key)!;
  const place = locatePlace(location, { countries });
  if (cache.size >= CACHE_SIZE) cache.clear();
  cache.set(key, place);
  return place;
}

/**
 * Places for a parcel's scans, oldest first. A scan that names no country
 * borrows one from the scans around it, then the destination and the
 * carrier's home countries, so "Buchs" after "Zürich" stays in Switzerland.
 */
export function placesForEvents(
  locations: readonly (string | null | undefined)[],
  { destinationCountry, carrierCountries = [] }: { destinationCountry?: string | null; carrierCountries?: readonly string[] } = {},
): (EventPlace | null)[] {
  const base = [...new Set([destinationCountry, ...carrierCountries].filter((code): code is string => Boolean(code)))];
  const first = locations.map((location) => cachedPlace(location, base));
  return locations.map((location, index) => {
    if (!location?.trim()) return null;
    const before = first.slice(0, index).reverse().find(Boolean)?.country;
    const after = first.slice(index + 1).find(Boolean)?.country;
    const neighbours = [...new Set([before, after].filter((code): code is string => Boolean(code)))];
    if (!neighbours.length || neighbours.every((code) => base.includes(code))) return first[index];
    return cachedPlace(location, [...neighbours, ...base.filter((code) => !neighbours.includes(code))]) ?? first[index];
  });
}
