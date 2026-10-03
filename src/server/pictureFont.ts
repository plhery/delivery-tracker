import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The faces the server's pictures are written in, and what a picture must know of them before drawing: which
// characters they have, and how wide they are. The image renderer fetches a font from the web for any character its
// fonts lack, and a drawing for any emoji; a picture must not do that, so its words are checked here first.

/** A face, as the renderer is given it and as its TrueType file describes it. */
export interface PictureFont {
  name: string;
  data: Buffer;
  unitsPerEm: number;
  /** The glyph of a character; 0 when the face has none. */
  glyph(codePoint: number): number;
  /** How far a glyph moves the pen, in font units. */
  advance(glyph: number): number;
}

/** Reads a face from its TrueType file. */
export function pictureFont(name: string, data: Buffer): PictureFont {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  /** Where each table of the file starts. */
  const tables = new Map<string, number>();
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const record = 12 + index * 16;
    tables.set(data.toString('latin1', record, record + 4), view.getUint32(record + 8));
  }
  const table = (tag: string): number => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`The font ${name} has no ${tag} table`);
    return offset;
  };

  /**
   * The Unicode character map the renderer reads: the last one listed.
   * Format 4: runs of code points and how each run finds its glyphs.
   */
  const characterMap = (): number => {
    const cmap = table('cmap');
    for (let index = view.getUint16(cmap + 2) - 1; index >= 0; index -= 1) {
      const record = cmap + 4 + index * 8;
      const platform = view.getUint16(record);
      const encoding = view.getUint16(record + 2);
      if (!(platform === 0 ? encoding <= 4 : platform === 3 && [0, 1, 10].includes(encoding))) continue;
      const subtable = cmap + view.getUint32(record + 4);
      if (view.getUint16(subtable) === 4) return subtable;
      break;
    }
    throw new Error(`The font ${name} has no Unicode character map in format 4`);
  };

  const map = characterMap();
  const segments = view.getUint16(map + 6) / 2;
  const ends = map + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  const glyphs = new Map<number, number>();
  const metrics = table('hmtx');
  const metricCount = view.getUint16(table('hhea') + 34);

  return {
    name,
    data,
    unitsPerEm: view.getUint16(table('head') + 18),
    glyph(codePoint) {
      const known = glyphs.get(codePoint);
      if (known !== undefined) return known;
      let found = 0;
      // The last run only closes the map.
      for (let segment = 0; codePoint <= 0xffff && segment < segments - 1; segment += 1) {
        if (codePoint > view.getUint16(ends + segment * 2)) continue;
        const start = view.getUint16(starts + segment * 2);
        if (codePoint < start) break;
        const delta = view.getUint16(deltas + segment * 2);
        const range = view.getUint16(ranges + segment * 2);
        const listed = range ? view.getUint16(ranges + segment * 2 + range + (codePoint - start) * 2) : codePoint;
        found = range && !listed ? 0 : (listed + delta) & 0xffff;
        break;
      }
      glyphs.set(codePoint, found);
      return found;
    },
    // The last metric stands for every glyph after it.
    advance: (glyph) => view.getUint16(metrics + Math.min(glyph, metricCount - 1) * 4),
  };
}

/** The sans of every picture: the face the renderer ships with. */
export const GEIST = pictureFont('Geist', readFileSync(join(process.cwd(), 'node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf')));

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Text as the faces can write it, on one line: composed characters, plain
 * spaces for the kinds of space they lack, nothing invisible. Null when a
 * character has no glyph, so a name is left out rather than fetched or mangled.
 *
 * `faces` come in the order the renderer tries them: the family the text is
 * set in, then the picture's fonts in the order it loads them. A character and
 * the marks on it are written in the first face that has the character, and
 * that face must have the marks too.
 */
export function writable(text: string, ...faces: PictureFont[]): string | null {
  const glyph = (face: PictureFont, character: string) => face.glyph(character.codePointAt(0)!);
  const plain = text.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\p{White_Space}/gu, (space) => faces.some((face) => glyph(face, space)) ? space : ' ')
    .replace(/ {2,}/g, ' ').trim();
  for (const { segment } of graphemes.segment(plain)) {
    const [character, ...marks] = segment;
    const face = faces.find((candidate) => glyph(candidate, character));
    if (!face || marks.some((mark) => !glyph(face, mark))) return null;
  }
  return plain;
}

/** The width of text a face can write at a font size, as the sum of its glyphs' advances. */
export function textWidth(text: string, size: number, face: PictureFont): number {
  let units = 0;
  for (const character of text) units += face.advance(face.glyph(character.codePointAt(0)!));
  return units / face.unitsPerEm * size;
}
