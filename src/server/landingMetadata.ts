import 'server-only';
import type { Metadata } from 'next';
import type { Locale } from '../lib/locale';
import { requestLocale } from './requestLocale';
import { requestOrigin } from './requestOrigin';
import { landingTitle, PREVIEW_LOCALES, sitePicture, wordsIn } from './sitePreview';

/**
 * The landing's metadata, in the reader's language. The title is the question the page
 * answers, then what Peek is; the description says only what the page itself claims.
 * It names `/` as the page's address, at whichever address the landing shows.
 */
export async function landingMetadata(): Promise<Metadata> {
  const origin = await requestOrigin();
  const locale = await requestLocale();
  const t = wordsIn(locale);
  const title = landingTitle(t);
  const description = t('preview.landing.description');
  const picture = sitePicture(origin, locale);
  return {
    metadataBase: origin,
    title,
    description,
    alternates: { canonical: origin.href },
    openGraph: {
      type: 'website',
      url: origin.href,
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

/** What Peek is, for a search engine: a web application at this address, described as the page describes it. */
export function landingStructuredData(origin: URL, locale: Locale): string {
  const t = wordsIn(locale);
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: t('app.title'),
    alternateName: `${t('app.title')} — ${t('app.tagline')}`,
    url: origin.href,
    description: t('preview.landing.description'),
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Web, iOS',
    inLanguage: locale,
    isAccessibleForFree: true,
  }).replaceAll('<', '\\u003c');
}
