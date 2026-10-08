import { GUIDE_LINKS } from '../generated/guides';
import { isLocale, type Locale } from '../lib/locale';

/** Where the guides of a language live, or one of them. English has no prefix. */
export function guidePath(locale: Locale, slug?: string): string {
  return `${locale === 'en' ? '' : `/${locale}`}/guides${slug ? `/${slug}` : ''}`;
}

/**
 * The language a guides address is written in, or null at any other address: `/guides` is English,
 * `/de/guides` German. English has no prefix, so `/en/guides` is no guides address.
 */
export function guidePathLanguage(pathname: string): Locale | null {
  const match = /^\/(?:([a-z]{2})\/)?guides(?:\/|$)/.exec(pathname);
  if (!match) return null;
  if (!match[1]) return 'en';
  return isLocale(match[1]) && match[1] !== 'en' ? match[1] : null;
}

/**
 * Whether an address below a language's guides names none of them, letter for letter: the proxy answers it
 * with the site's 404 page. The guides' pages are rendered for each request, so `dynamicParams` has no list
 * to hold a slug against, and a `notFound()` thrown by the page leaves the 404 page for the browser to draw.
 */
export function namesNoGuide(pathname: string): boolean {
  const language = guidePathLanguage(pathname);
  if (!language) return false;
  const below = pathname.slice(guidePath(language).length);
  return below !== '' && !GUIDE_LINKS[language].some(({ slug }) => below === `/${slug}`);
}
