import fs from 'node:fs';
import path from 'node:path';

export const locales = ['en', 'de', 'fr', 'it'];

export function validateLocalizationCatalogs(catalogs) {
  const englishKeys = Object.keys(catalogs.en ?? {}).sort();
  if (!englishKeys.length) throw new Error('Missing English localization catalog');
  const variables = (text) => [...text.matchAll(/\{\{([A-Za-z0-9_.-]+)\}\}/g)]
    .map((match) => match[1]).sort().join(',');
  for (const locale of locales) {
    const catalog = catalogs[locale];
    if (!catalog) throw new Error(`Missing ${locale} localization catalog`);
    const missing = englishKeys.filter((key) => !(key in catalog));
    const extra = Object.keys(catalog).filter((key) => !englishKeys.includes(key));
    if (missing.length || extra.length) {
      throw new Error(`${locale} catalog keys differ. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.`);
    }
    for (const key of englishKeys) {
      if (typeof catalog[key] !== 'string') throw new Error(`${locale}.${key} must be a string`);
      if (variables(catalog[key]) !== variables(catalogs.en[key])) {
        throw new Error(`${locale}.${key} must preserve the English interpolation variables`);
      }
    }
  }
}

export function readLocalizationCatalogs(directory) {
  const catalogs = Object.fromEntries(locales.map((locale) => [
    locale, JSON.parse(fs.readFileSync(path.join(directory, `${locale}.json`), 'utf8')),
  ]));
  validateLocalizationCatalogs(catalogs);
  return Object.fromEntries(locales.map((locale) => [locale,
    Object.fromEntries(Object.entries(catalogs[locale]).sort(([a], [b]) => a.localeCompare(b))),
  ]));
}
