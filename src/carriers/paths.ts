import { CARRIER_LINKS } from '../generated/carriers';
import { isLocale, type Locale } from '../lib/locale';

/** Where the carriers' pages of a language live, or one of them. English has no prefix. */
export function carrierPath(locale: Locale, slug?: string): string {
  return `${locale === 'en' ? '' : `/${locale}`}/carriers${slug ? `/${slug}` : ''}`;
}

/**
 * The language a carriers address is written in, or null at any other address: `/carriers` is English,
 * `/de/carriers` German. English has no prefix, so `/en/carriers` is no carriers address.
 */
export function carrierPathLanguage(pathname: string): Locale | null {
  const match = /^\/(?:([a-z]{2})\/)?carriers(?:\/|$)/.exec(pathname);
  if (!match) return null;
  if (!match[1]) return 'en';
  return isLocale(match[1]) && match[1] !== 'en' ? match[1] : null;
}

/**
 * Whether an address below a language's carriers names no carrier written in that language, letter for
 * letter: the proxy answers it with the site's 404 page, as it does an address that names no guide
 * (`namesNoGuide`). A carrier's page in a language it is not written in is no page either.
 */
export function namesNoCarrier(pathname: string): boolean {
  const language = carrierPathLanguage(pathname);
  if (!language) return false;
  const below = pathname.slice(carrierPath(language).length);
  return below !== '' && !CARRIER_LINKS[language].some(({ slug }) => below === `/${slug}`);
}
