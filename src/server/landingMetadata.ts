import 'server-only';
import type { Metadata } from 'next';
import { languagePath, SUPPORTED_LOCALES, type AddressLanguage, type Locale } from '../lib/locale';
import { requestLocale } from './requestLocale';
import { requestOrigin, siteOrigin } from './requestOrigin';
import { landingTitle, PREVIEW_LOCALES, sitePicture, wordsIn } from './sitePreview';

/** The landing's address in a language, on the origin the site's addresses are written on: `/de` in German, `/` in English. */
export function landingAddress(origin: URL, locale: Locale): string {
  return new URL(languagePath(locale), origin).href;
}

/**
 * The landing in every language, as search engines are told: each language's
 * address, and `/` for a reader of none of them, where the browser's own
 * language is answered.
 */
export function landingAlternates(origin: URL): Record<Locale | 'x-default', string> {
  return {
    ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, landingAddress(origin, locale)])) as Record<Locale, string>,
    'x-default': landingAddress(origin, 'en'),
  };
}

/**
 * The landing's metadata. The title is the question the page answers, then what Peek is;
 * the description says only what the page itself claims. At a language address it is in
 * that language and names that address. Anywhere else (`/`, and the landing's own address
 * for someone signed in) it is in the reader's language and names `/`.
 */
export async function landingMetadata(language?: AddressLanguage): Promise<Metadata> {
  const locale = language ?? await requestLocale();
  const t = wordsIn(locale);
  const title = landingTitle(t);
  const description = t('preview.landing.description');
  const origin = await requestOrigin();
  // The page's address is named on the site's canonical origin, whichever host answered.
  const site = await siteOrigin();
  const address = landingAddress(site, language ?? 'en');
  const picture = sitePicture(origin, locale);
  return {
    metadataBase: origin,
    title,
    description,
    alternates: { canonical: address, languages: landingAlternates(site) },
    openGraph: {
      type: 'website',
      url: address,
      siteName: 'Peek',
      locale: PREVIEW_LOCALES[locale],
      title,
      description,
      images: [picture],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [picture.url],
    },
  };
}
