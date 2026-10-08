import { expect, it } from 'vitest';
import { GUIDE_LINKS } from '../generated/guides';
import { SUPPORTED_LOCALES } from '../lib/locale';
import { guidePath, guidePathLanguage, namesNoGuide } from './paths';

it('puts English guides at /guides and every other language under its prefix', () => {
  expect(guidePath('en')).toBe('/guides');
  expect(guidePath('en', 'some-guide')).toBe('/guides/some-guide');
  expect(guidePath('fr')).toBe('/fr/guides');
  expect(guidePath('pl', 'inny-poradnik')).toBe('/pl/guides/inny-poradnik');
});

it('reads a guide’s language from its address, and nothing from any other address', () => {
  expect(guidePathLanguage('/guides')).toBe('en');
  expect(guidePathLanguage('/guides/some-guide')).toBe('en');
  expect(guidePathLanguage('/de/guides')).toBe('de');
  expect(guidePathLanguage('/it/guides/una-guida')).toBe('it');
  // English has no prefix, and a prefix is one of the site's languages.
  expect(guidePathLanguage('/en/guides')).toBeNull();
  expect(guidePathLanguage('/nl/guides')).toBeNull();
  expect(guidePathLanguage('/')).toBeNull();
  expect(guidePathLanguage('/de')).toBeNull();
  expect(guidePathLanguage('/guidesmore')).toBeNull();
  expect(guidePathLanguage('/p/guides')).toBeNull();
  expect(guidePathLanguage('/demo')).toBeNull();
});

it('knows an address below a language’s guides that names none of them, letter for letter', () => {
  const everySlug = SUPPORTED_LOCALES.flatMap((locale) => GUIDE_LINKS[locale].map(({ slug }) => slug));
  for (const locale of SUPPORTED_LOCALES) {
    const own = GUIDE_LINKS[locale].map(({ slug }) => slug);
    expect(namesNoGuide(guidePath(locale)), locale).toBe(false);
    for (const slug of own) expect(namesNoGuide(guidePath(locale, slug)), slug).toBe(false);
    // Another language's slug, a made-up one, one in other letters, or anything below a guide is no page in this language.
    const missing = [...everySlug.filter((slug) => !own.includes(slug)), 'no-such-guide', `${own[0]}x`, own[0].toUpperCase(), `${own[0]}/more`];
    for (const slug of missing) expect(namesNoGuide(guidePath(locale, slug)), slug).toBe(true);
  }
  // Nor is it anything to say of an address that is not the guides'.
  for (const path of ['/', '/de', '/demo', '/guidesmore', '/en/guides/x', '/GUIDES/x', '/FR/guides/x']) expect(namesNoGuide(path), path).toBe(false);
});
