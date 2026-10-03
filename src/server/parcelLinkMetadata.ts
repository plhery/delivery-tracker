import 'server-only';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { SAMPLE_LINK_ID, SAMPLE_PATH } from '../peek/sample';
import { parcelLinkPreview } from './parcelLinkPreview';
import { isParcelLinkId } from './publicParcels';
import { requestLocale } from './requestLocale';
import { requestOrigin } from './requestOrigin';

/** What a link that leads nowhere is called: Peek's own name and sentence, as at the front door. */
const TITLE = 'Peek — Universal Parcel Tracker';
const DESCRIPTION = 'Private parcel tracking, with alerts and history synced across your devices.';

/** Where a parcel link's preview image is served. An id that cannot be a link's is not echoed. */
export function parcelLinkImagePath(linkId: unknown): string {
  return `/api/public/parcels/${isParcelLinkId(linkId) ? linkId : 'unavailable'}/image`;
}

/** A preview's title, description and picture, as chats and feeds read them. */
function shared(url: URL, image: URL, title: string, description: string): Pick<Metadata, 'openGraph' | 'twitter'> {
  return {
    openGraph: {
      type: 'website', url: url.href, siteName: 'Peek', title, description,
      images: [{ url: image.href, width: 1200, height: 630, type: 'image/png', alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [{ url: image.href, alt: title }] },
  };
}

/**
 * The parcel page's metadata, in the request's language: the status and the
 * carrier as the title, the estimate as the description, and the preview
 * image. A parcel link is a capability, so it is never indexed and never
 * leaves as a referrer; a link that leads nowhere gets Peek's own preview.
 */
export async function parcelLinkMetadata(linkId: unknown): Promise<Metadata> {
  const locale = await requestLocale();
  // Only a link's own id is asked about: the sample has its own page.
  const preview = isParcelLinkId(linkId) ? await parcelLinkPreview(linkId, await headers(), locale) : null;
  const origin = await requestOrigin();
  const url = new URL(isParcelLinkId(linkId) ? `/p/${linkId}` : '/', origin);
  const image = new URL(parcelLinkImagePath(linkId), origin);
  // The image is written in the page's language, whoever fetches it.
  image.searchParams.set('lang', locale);
  const title = preview?.title ?? TITLE;
  const description = preview?.description ?? DESCRIPTION;
  return {
    metadataBase: origin,
    title,
    description,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    ...shared(url, image, title, description),
  };
}

/**
 * The sample page's metadata, in the request's language: a parcel's picture
 * with the note that nothing in it is real. The sample is nobody's parcel, so
 * the page is indexed like the landing. A client over its allowance gets
 * Peek's own preview.
 */
export async function sampleLinkMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  const preview = await parcelLinkPreview(SAMPLE_LINK_ID, await headers(), locale);
  if (!preview) return {};
  const origin = await requestOrigin();
  const url = new URL(SAMPLE_PATH, origin);
  const image = new URL(`/api/public/parcels/${SAMPLE_LINK_ID}/image`, origin);
  image.searchParams.set('lang', locale);
  const { title, description } = preview;
  return { metadataBase: origin, title, description, alternates: { canonical: url.href }, ...shared(url, image, title, description) };
}
