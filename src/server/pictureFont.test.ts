// @vitest-environment node
import { ImageResponse } from 'next/og';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatKm } from '../components/map/route';
import { SUPPORTED_LOCALES } from '../lib/locale';
import { languageTags } from '../lib/messages';
import { formatJourneyDuration } from '../lib/passport';
import { refuseTheWeb } from '../test/pictureRequests';
import { GEIST, pictureFont, textWidth, writable, type PictureFont } from './pictureFont';
import { messagesFor } from './requestLocale';

/** The serif of the invitation's picture: a second face, with other characters. */
const GELASIO = pictureFont('Gelasio', readFileSync(join(process.cwd(), 'public/fonts/gelasio/Gelasio-SemiBoldItalic.ttf')));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('writable', () => {
  it('keeps what the face can write, in Latin, Vietnamese and Cyrillic alike', () => {
    for (const text of ['Zürich', 'Łódź', 'São Paulo', 'Reykjavík', 'İstanbul', 'Thành phố Hồ Chí Minh', 'Москва', '9’300 km · 2d 4h', 'Aujourd’hui, 14:12']) {
      expect(writable(text, GEIST)).toBe(text);
    }
  });

  it('answers null for a character the face lacks, rather than a name with holes', () => {
    for (const text of ['深圳', 'Αθήνα', 'New sneakers 👟', 'ヤマト運輸', 'Zürich ✅']) expect(writable(text, GEIST)).toBeNull();
  });

  it('composes accents, writes every kind of space as a space and drops what cannot be seen', () => {
    expect(writable('Zu\u0308rich', GEIST)).toBe('Zürich');
    expect(writable('14:12\u202fUhr', GEIST)).toBe('14:12 Uhr');
    expect(writable('a\u2009b\u3000c', GEIST)).toBe('a b c');
    expect(writable(' Hamburg\r\n\tAltona\u0000\u200b ', GEIST)).toBe('Hamburg Altona');
    expect(writable('', GEIST)).toBe('');
  });

  it('can write everything the card says in each language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const messages = messagesFor(locale);
      const tag = languageTags[locale];
      const said = [
        messages['stage.delivered'], messages['time.today'], messages['time.yesterday'],
        messages['map.countries.one'], messages['map.countries.few'], messages['map.countries.many'].replace('{{count}}', '12'),
        formatKm(9_300, tag), formatKm(7, tag), formatJourneyDuration(51 * 3_600_000, tag), formatJourneyDuration(95 * 60_000, tag), formatJourneyDuration(12 * 60_000, tag),
      ];
      for (const text of said) expect(writable(text, GEIST), `${locale}: ${text}`).not.toBeNull();
    }
  });

  it('reads each face from its own file', () => {
    // The serif has no Cyrillic and the sans not every Latin letter.
    expect(writable('Саша', GEIST)).toBe('Саша');
    expect(writable('Саша', GELASIO)).toBeNull();
    expect(writable('Muḥammad', GELASIO)).toBe('Muḥammad');
    expect(writable('Muḥammad', GEIST)).toBeNull();
    // A space the face has stays as it is.
    expect(writable('a\u2009b', GELASIO)).toBe('a\u2009b');
    for (const face of [GEIST, GELASIO]) expect(writable('Émilie & Léa → 2', face)).toBe('Émilie & Léa → 2');
    expect(() => pictureFont('Empty', Buffer.alloc(64))).toThrow('The font Empty has no cmap table');
  });

  it('writes with several faces as the renderer does: each character in the first face that has it', () => {
    expect(writable('Саша & Muḥammad', GELASIO, GEIST)).toBe('Саша & Muḥammad');
    expect(writable('Саша & Muḥammad', GEIST, GELASIO)).toBe('Саша & Muḥammad');
    expect(writable('深圳', GELASIO, GEIST)).toBeNull();
    // A letter and the mark on it come from one face. Both faces have the k and only the sans the stroke over it.
    expect(writable('k\u0336', GEIST, GELASIO)).toBe('k\u0336');
    expect(writable('k\u0336', GELASIO, GEIST)).toBeNull();
    expect(writable('Ж\u0336', GELASIO, GEIST)).toBe('Ж\u0336');
  });
});

describe('textWidth', () => {
  it('adds up the glyphs’ advances at the size asked for', () => {
    expect(textWidth('', 11.5, GEIST)).toBe(0);
    expect(textWidth('Zürich', 11.5, GEIST)).toBeCloseTo(32.99, 1);
    expect(textWidth('Hamburg', 11.5, GEIST)).toBeCloseTo(49.27, 1);
    expect(textWidth('Zürich', 23, GEIST)).toBeCloseTo(2 * textWidth('Zürich', 11.5, GEIST), 6);
    expect(textWidth('ZürichHamburg', 11.5, GEIST)).toBeCloseTo(textWidth('Zürich', 11.5, GEIST) + textWidth('Hamburg', 11.5, GEIST), 6);
    // A narrow letter is narrower than a wide one.
    expect(textWidth('i', 11.5, GEIST)).toBeLessThan(textWidth('m', 11.5, GEIST));
    // Each face has its own measures.
    expect(textWidth('Hamburg', 11.5, GELASIO)).not.toBeCloseTo(textWidth('Hamburg', 11.5, GEIST), 1);
  });
});

describe('the renderer', () => {
  /** Draws text in a family, with the fonts loaded in the order given, and tells what it asked the web for. */
  async function drawn(text: string, family: PictureFont, fonts: PictureFont[]) {
    const asked = refuseTheWeb();
    const response = new ImageResponse(
      createElement('div', { style: { display: 'flex', flexWrap: 'wrap', width: '100%', height: '100%', fontFamily: family.name, fontSize: 20 } }, text),
      { width: 1200, height: 630, fonts: fonts.map(({ name, data }) => ({ name, data, weight: 400 as const, style: 'normal' as const })) },
    );
    await response.arrayBuffer().catch(() => undefined);
    return asked;
  }

  /** Every character the reader finds in a face. */
  function characters(face: PictureFont): string {
    let found = '';
    for (let codePoint = 0x20; codePoint <= 0xffff; codePoint += 1) {
      const character = String.fromCodePoint(codePoint);
      if (face.glyph(codePoint) && writable(character, face) === character) found += character;
    }
    return found;
  }

  it.each([GEIST, GELASIO])('draws every character the reader finds in $name without asking the web', async (face) => {
    const text = characters(face);
    expect([...text].length).toBeGreaterThan(600);
    expect(await drawn(text, face, [face])).not.toHaveBeenCalled();
  });

  it('asks the web for the text the reader does not pass, and for no other', async () => {
    // It reports each font it could not fetch.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // With the sans loaded first and the text set in the serif, as the name on the invitation is.
    for (const text of ['Саша & Muḥammad', 'Ж\u0336', 'a\u2009b']) {
      expect(writable(text, GELASIO, GEIST), text).toBe(text);
      expect(await drawn(text, GELASIO, [GEIST, GELASIO]), text).not.toHaveBeenCalled();
    }
    for (const text of ['k\u0336', 'Αθήνα', 'x\u202fy', 'Jean\u2011Luc', 'shoe 👟']) {
      expect(writable(text, GELASIO, GEIST), text).not.toBe(text);
      expect(await drawn(text, GELASIO, [GEIST, GELASIO]), text).toHaveBeenCalled();
    }
  });
});
