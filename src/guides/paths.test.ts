import { expect, it } from 'vitest';
import { guidePath, guidePathLanguage } from './paths';

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
