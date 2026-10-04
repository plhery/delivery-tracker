export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'it', 'es', 'pt', 'pl'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Mirrors a chosen language, so the server renders the first frame in it. */
export const LOCALE_COOKIE = 'sdt.locale';

export function isLocale(value: unknown): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

export function detectLocale(languages: readonly string[] = []): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

/** A language whose landing has an address of its own: every one but English, whose landing is `/`. */
export type AddressLanguage = Exclude<Locale, 'en'>;
export const ADDRESS_LANGUAGES = SUPPORTED_LOCALES.filter((locale): locale is AddressLanguage => locale !== 'en');

/** The landing's address in a language: `/de` in German, `/` in English. */
export function languagePath(locale: Locale): string {
  return locale === 'en' ? '/' : `/${locale}`;
}

/** The language of a language address, or null at any other address: `/de` is German, `/` and `/en` are no language's own. */
export function pathLanguage(pathname: string): AddressLanguage | null {
  const language = pathname.startsWith('/') ? pathname.slice(1) : null;
  return isLocale(language) && language !== 'en' ? language : null;
}

/** The browser's languages in its preference order, as sent in Accept-Language. */
export function acceptedLanguages(header: string | null): string[] {
  return (header ?? '').split(',').map((part) => part.split(';')[0].trim()).filter(Boolean);
}
