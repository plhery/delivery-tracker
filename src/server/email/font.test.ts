// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatKm } from '../../components/map/route';
import { SUPPORTED_LOCALES } from '../../lib/locale';
import { languageTags } from '../../lib/messages';
import { formatJourneyDuration } from '../../lib/passport';
import { messagesFor } from '../requestLocale';
import { textWidth, writable } from './font';

describe('writable', () => {
  it('keeps what the face can write, in Latin, Vietnamese and Cyrillic alike', () => {
    for (const text of ['Zürich', 'Łódź', 'São Paulo', 'Reykjavík', 'İstanbul', 'Thành phố Hồ Chí Minh', 'Москва', '9’300 km · 2d 4h', 'Aujourd’hui, 14:12']) {
      expect(writable(text)).toBe(text);
    }
  });

  it('answers null for a character the face lacks, rather than a name with holes', () => {
    for (const text of ['深圳', 'Αθήνα', 'New sneakers 👟', 'ヤマト運輸', 'Zürich ✅']) expect(writable(text)).toBeNull();
  });

  it('composes accents, writes every kind of space as a space and drops what cannot be seen', () => {
    expect(writable('Zu\u0308rich')).toBe('Zürich');
    expect(writable('14:12\u202fUhr')).toBe('14:12 Uhr');
    expect(writable('a\u2009b\u3000c')).toBe('a b c');
    expect(writable(' Hamburg\r\n\tAltona\u0000\u200b ')).toBe('Hamburg Altona');
    expect(writable('')).toBe('');
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
      for (const text of said) expect(writable(text), `${locale}: ${text}`).not.toBeNull();
    }
  });
});

describe('textWidth', () => {
  it('adds up the glyphs’ advances at the size asked for', () => {
    expect(textWidth('', 11.5)).toBe(0);
    expect(textWidth('Zürich', 11.5)).toBeCloseTo(32.99, 1);
    expect(textWidth('Hamburg', 11.5)).toBeCloseTo(49.27, 1);
    expect(textWidth('Zürich', 23)).toBeCloseTo(2 * textWidth('Zürich', 11.5), 6);
    expect(textWidth('ZürichHamburg', 11.5)).toBeCloseTo(textWidth('Zürich', 11.5) + textWidth('Hamburg', 11.5), 6);
    // A narrow letter is narrower than a wide one.
    expect(textWidth('i', 11.5)).toBeLessThan(textWidth('m', 11.5));
  });
});
