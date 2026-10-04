import 'server-only';
import type { Metadata } from 'next';
import { requestLocale } from './requestLocale';
import { requestOrigin, siteOrigin } from './requestOrigin';
import { landingTitle, PREVIEW_LOCALES, sitePicture, wordsIn } from './sitePreview';

/**
 * The landing's metadata, in the reader's language. The title is the question the page
 * answers, then what Peek is; the description says only what the page itself claims.
 * It names `/` as the page's address, at whichever address the landing shows.
 */
export async function landingMetadata(): Promise<Metadata> {
  const origin = await requestOrigin();
  // The page's address is named on the site's canonical origin, whichever host answered.
  const address = (await siteOrigin()).href;
  const locale = await requestLocale();
  const t = wordsIn(locale);
  const title = landingTitle(t);
  const description = t('preview.landing.description');
  const picture = sitePicture(origin, locale);
  return {
    metadataBase: origin,
    title,
    description,
    alternates: { canonical: address },
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
