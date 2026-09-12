/*
 * Generates the brand assets both clients render, from the carrier folders:
 *
 *   carriers/<id>/carrier.json   brand.color, brand.family, brand.palette, brand.decal
 *   core/brand/palette.json      the default and fallback colors, the nine
 *                                properties and how each is mixed
 *   core/brand/truck.json        the truck geometry
 *     -> packages/carriers/generated/brand.ts        (web, through core/brand)
 *     -> ios/.../Resources/Brand.json                (written by
 *                                                     scripts/generate-ios-resources.mjs,
 *                                                     read by the native parity test)
 *
 * Families: several carrier ids can share one visual identity. Each member
 * declares `brand.family`, and exactly one member of the family declares the
 * `brand.palette` and `brand.decal` the whole family wears. The generated
 * tables are keyed by carrier id, so a client never has to know the rule.
 *
 * `--check` fails when the committed packages/carriers/generated/brand.ts is
 * stale.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brandRoot = path.join(packageRoot, 'core', 'brand');
const carriersRoot = path.join(packageRoot, 'carriers');
const outputPath = path.join(packageRoot, 'generated', 'brand.ts');

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * The brand data, as both generated artifacts describe it. Shared with
 * scripts/generate-ios-resources.mjs so Brand.json and brand.ts cannot disagree.
 */
export function readBrandData() {
  const palette = readJson(path.join(brandRoot, 'palette.json'));
  const truck = readJson(path.join(brandRoot, 'truck.json'));
  const properties = new Set(palette.properties);

  const folders = readdirSync(carriersRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const carriers = folders.map((id) => ({ id, brand: readJson(path.join(carriersRoot, id, 'carrier.json')).brand ?? {} }));

  const families = {};
  const members = new Map();
  for (const carrier of carriers) {
    const family = carrier.brand.family ?? carrier.id;
    if (family !== carrier.id) families[carrier.id] = family;
    members.set(family, [...(members.get(family) ?? []), carrier]);
  }

  const palettes = {};
  const decals = {};
  for (const [family, group] of members) {
    for (const key of ['palette', 'decal']) {
      const declaring = group.filter((carrier) => carrier.brand[key] !== undefined);
      if (declaring.length > 1) {
        throw new Error(
          `Brand family ${family} declares brand.${key} in several folders `
          + `(${declaring.map((carrier) => carrier.id).join(', ')}). `
          + 'Exactly one member owns the family identity; the others only declare brand.family.',
        );
      }
      if (declaring.length === 0) continue;
      const value = declaring[0].brand[key];
      if (key === 'palette') {
        for (const property of Object.keys(value)) {
          if (!properties.has(property)) {
            throw new Error(`packages/carriers/carriers/${declaring[0].id}/carrier.json declares an unknown brand property ${property}`);
          }
        }
      }
      for (const carrier of group) (key === 'palette' ? palettes : decals)[carrier.id] = value;
    }
  }

  return {
    defaultColor: palette.defaultColor,
    fallbackColor: palette.fallbackColor,
    properties: palette.properties,
    derivation: palette.derivation,
    families: sortedByKey(families),
    palettes: sortedByKey(palettes),
    decals: sortedByKey(decals),
    truck,
  };
}

function sortedByKey(value) {
  return Object.fromEntries(Object.entries(value).sort(([first], [second]) => first.localeCompare(second)));
}

function inlineJson(value) {
  return Array.isArray(value) ? `[${value.map(inlineJson).join(', ')}]` : JSON.stringify(value);
}

/** JSON.stringify(value, null, 2), except that coordinate arrays stay on one line. */
function renderJson(value, indent = 0) {
  const pad = ' '.repeat(indent);
  const step = ' '.repeat(indent + 2);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inline = inlineJson(value);
    if (!inline.includes('{') && inline.length + indent <= 92) return inline;
    return `[\n${value.map((item) => step + renderJson(item, indent + 2)).join(',\n')}\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const members = entries.map(([key, item]) => `${step}${JSON.stringify(key)}: ${renderJson(item, indent + 2)}`);
    return `{\n${members.join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}

/** The payload ios/SwissDeliveryTracker/Resources/Brand.json carries. */
export function renderBrandJson(brand) {
  return `${renderJson(brand)}\n`;
}

function generatedBrand(brand) {
  return `${[
    '/* This file is generated by packages/carriers/scripts/generate-brand.mjs. Do not edit. */',
    '',
    "import type { CarrierDecal, CarrierPalette, TruckGeometry } from '../core/brand/types';",
    '',
    `export const DEFAULT_CARRIER_COLOR = ${JSON.stringify(brand.defaultColor)};`,
    '',
    `export const CARRIER_FAMILIES: Record<string, string> = ${renderJson(brand.families)};`,
    '',
    `export const CARRIER_PALETTES: Record<string, Partial<CarrierPalette>> = ${renderJson(brand.palettes)};`,
    '',
    `export const CARRIER_DECALS: Record<string, CarrierDecal> = ${renderJson(brand.decals)};`,
    '',
    `export const CARRIER_TRUCK: TruckGeometry = ${renderJson(brand.truck)};`,
  ].join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const expected = generatedBrand(readBrandData());
  if (process.argv.includes('--check')) {
    const current = readFileSync(outputPath, 'utf8');
    if (current !== expected) {
      throw new Error('packages/carriers/generated/brand.ts is stale. Run npm run contract:generate.');
    }
    console.log('Generated brand assets are current.');
  } else {
    writeFileSync(outputPath, expected);
    console.log(`Wrote ${path.relative(path.resolve(packageRoot, '..', '..'), outputPath)}`);
  }
}
