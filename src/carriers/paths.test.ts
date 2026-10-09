import { expect, it } from 'vitest';
import { CARRIER_LINKS } from '../generated/carriers';
import { SUPPORTED_LOCALES } from '../lib/locale';
import { carrierPath, carrierPathLanguage, namesNoCarrier } from './paths';

it('puts the English carriers’ pages at /carriers and every other language under its prefix', () => {
  expect(carrierPath('en')).toBe('/carriers');
  expect(carrierPath('en', 'some-carrier-tracking')).toBe('/carriers/some-carrier-tracking');
  expect(carrierPath('fr')).toBe('/fr/carriers');
  expect(carrierPath('pl', 'sledzenie-przesylki')).toBe('/pl/carriers/sledzenie-przesylki');
});

it('reads a carrier page’s language from its address, and nothing from any other address', () => {
  expect(carrierPathLanguage('/carriers')).toBe('en');
  expect(carrierPathLanguage('/carriers/some-carrier')).toBe('en');
  expect(carrierPathLanguage('/de/carriers')).toBe('de');
  expect(carrierPathLanguage('/it/carriers/un-corriere')).toBe('it');
  // English has no prefix, and a prefix is one of the site's languages.
  expect(carrierPathLanguage('/en/carriers')).toBeNull();
  expect(carrierPathLanguage('/nl/carriers')).toBeNull();
  expect(carrierPathLanguage('/')).toBeNull();
  expect(carrierPathLanguage('/de')).toBeNull();
  expect(carrierPathLanguage('/carriersmore')).toBeNull();
  expect(carrierPathLanguage('/guides')).toBeNull();
  expect(carrierPathLanguage('/p/carriers')).toBeNull();
});

it('knows an address below a language’s carriers that names none written in it, letter for letter', () => {
  const everySlug = SUPPORTED_LOCALES.flatMap((locale) => CARRIER_LINKS[locale].map(({ slug }) => slug));
  expect(CARRIER_LINKS.en.length).toBeGreaterThan(0);
  for (const locale of SUPPORTED_LOCALES) {
    const own = CARRIER_LINKS[locale].map(({ slug }) => slug);
    // The carriers' own page exists in every language, with or without carriers in it.
    expect(namesNoCarrier(carrierPath(locale)), locale).toBe(false);
    for (const slug of own) expect(namesNoCarrier(carrierPath(locale, slug)), slug).toBe(false);
    // Another language's slug, a carrier this language has no page of, a made-up slug, or anything below a page is no page here.
    const missing = [...everySlug.filter((slug) => !own.includes(slug)), 'no-such-carrier', ...own.flatMap((slug) => [`${slug}x`, slug.toUpperCase(), `${slug}/more`])];
    for (const slug of missing) expect(namesNoCarrier(carrierPath(locale, slug)), slug).toBe(true);
  }
  // Nor is it anything to say of an address that is not the carriers'.
  for (const path of ['/', '/de', '/demo', '/carriersmore', '/en/carriers/x', '/CARRIERS/x', '/FR/carriers/x', '/guides/x']) expect(namesNoCarrier(path), path).toBe(false);
});
