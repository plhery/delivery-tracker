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

/** The browser's languages in its preference order, as sent in Accept-Language. */
export function acceptedLanguages(header: string | null): string[] {
  return (header ?? '').split(',').map((part) => part.split(';')[0].trim()).filter(Boolean);
}
