import 'server-only';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
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

/**
 * The parcel page's metadata, in the request's language: the status and the
 * carrier as the title, the estimate as the description, and the preview
 * image. A parcel link is a capability, so it is never indexed and never
 * leaves as a referrer; a link that leads nowhere gets Peek's own preview.
 */
export async function parcelLinkMetadata(linkId: unknown): Promise<Metadata> {
  const locale = await requestLocale();
  const preview = await parcelLinkPreview(linkId, await headers(), locale);
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
    openGraph: {
      type: 'website', url: url.href, siteName: 'Peek', title, description,
      images: [{ url: image.href, width: 1200, height: 630, type: 'image/png', alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [{ url: image.href, alt: title }] },
  };
}
