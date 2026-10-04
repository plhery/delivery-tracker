import { describe, expect, it } from 'vitest';
import { ADDRESS_LANGUAGES, languagePath, pathLanguage, SUPPORTED_LOCALES } from './locale';

describe('language addresses', () => {
  it('gives every language but English an address of its own, and English `/`', () => {
    expect(ADDRESS_LANGUAGES).toEqual(['de', 'fr', 'it', 'es', 'pt', 'pl']);
    expect(SUPPORTED_LOCALES.map(languagePath)).toEqual(['/', '/de', '/fr', '/it', '/es', '/pt', '/pl']);
  });

  it('reads the language of a language address, and of no other address', () => {
    for (const language of ADDRESS_LANGUAGES) expect(pathLanguage(languagePath(language))).toBe(language);
    for (const path of ['/', '/en', '/home', '/demo', '/DE', '/de/', '/de/more', '/deu', '/xx', '/p/de', 'de', '']) {
      expect(pathLanguage(path), path).toBeNull();
    }
  });
});
