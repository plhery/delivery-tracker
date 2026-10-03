import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The face the email's picture is written in, and what a layout must know of it before drawing: which characters it
// has, and how wide they are. The image renderer fetches a font from the web for any character its fonts lack; an
// email's picture must not do that, so its words are checked here first.

/** The face, as the social images load it: the one the renderer ships with. */
export const FONT_NAME = 'Geist';
export const fontData = readFileSync(join(process.cwd(), 'node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf'));

const view = new DataView(fontData.buffer, fontData.byteOffset, fontData.byteLength);

/** Where each table of the TrueType file starts. */
const tables = new Map<string, number>();
for (let index = 0; index < view.getUint16(4); index += 1) {
  const record = 12 + index * 16;
  tables.set(fontData.toString('latin1', record, record + 4), view.getUint32(record + 8));
}

function table(name: string): number {
  const offset = tables.get(name);
  if (offset === undefined) throw new Error(`The font has no ${name} table`);
  return offset;
}

const unitsPerEm = view.getUint16(table('head') + 18);
const metricCount = view.getUint16(table('hhea') + 34);

/** The Unicode character map, format 4: runs of code points and how each run finds its glyphs. */
function characterMap(): number {
  const cmap = table('cmap');
  for (let index = 0; index < view.getUint16(cmap + 2); index += 1) {
    const record = cmap + 4 + index * 8;
    const platform = view.getUint16(record);
    const subtable = cmap + view.getUint32(record + 4);
    if ((platform === 0 || (platform === 3 && view.getUint16(record + 2) === 1)) && view.getUint16(subtable) === 4) return subtable;
  }
  throw new Error('The font has no Unicode character map');
}

const map = characterMap();
const segments = view.getUint16(map + 6) / 2;
const ends = map + 14;
const starts = ends + segments * 2 + 2;
const deltas = starts + segments * 2;
const ranges = deltas + segments * 2;
const glyphs = new Map<number, number>();

/** The glyph of a character; 0 when the face has none. */
function glyph(codePoint: number): number {
  const known = glyphs.get(codePoint);
  if (known !== undefined) return known;
  let found = 0;
  for (let segment = 0; codePoint <= 0xffff && segment < segments; segment += 1) {
    if (codePoint > view.getUint16(ends + segment * 2)) continue;
    const start = view.getUint16(starts + segment * 2);
    if (codePoint < start) break;
    const delta = view.getUint16(deltas + segment * 2);
    const range = view.getUint16(ranges + segment * 2);
    const listed = range ? view.getUint16(ranges + segment * 2 + range + (codePoint - start) * 2) : codePoint;
    found = listed ? (listed + delta) & 0xffff : 0;
    break;
  }
  glyphs.set(codePoint, found);
  return found;
}

/** How far a glyph moves the pen, in font units; the last metric stands for every glyph after it. */
function advance(index: number): number {
  return view.getUint16(table('hmtx') + Math.min(index, metricCount - 1) * 4);
}

/**
 * Text as the face can write it, on one line: composed characters, plain
 * spaces for the kinds of space it lacks, nothing invisible. Null when a
 * character has no glyph, so a name is left out rather than fetched or mangled.
 */
export function writable(text: string): string | null {
  let written = '';
  for (const character of text.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ' ')) {
    if (glyph(character.codePointAt(0)!)) written += character;
    else if (/\p{White_Space}/u.test(character)) written += ' ';
    else return null;
  }
  return written.replace(/ {2,}/g, ' ').trim();
}

/** The width of writable text at a font size, as the sum of its glyphs' advances. */
export function textWidth(text: string, size: number): number {
  let units = 0;
  for (const character of text) units += advance(glyph(character.codePointAt(0)!));
  return units / unitsPerEm * size;
}
