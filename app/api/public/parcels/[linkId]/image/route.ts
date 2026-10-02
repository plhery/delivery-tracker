import { isLocale } from '../../../../../../src/lib/locale';
import { genericSocialImage, parcelLinkSocialImage } from '../../../../../../src/server/ParcelLinkSocialImage';
import { parcelLinkPreview } from '../../../../../../src/server/parcelLinkPreview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The host a link is shown under, when the request names one that can be printed. */
function shownHost(request: Request): string | null {
  const host = request.headers.get('host')?.trim() ?? '';
  return /^[a-z0-9.-]{1,60}(?::\d{1,5})?$/i.test(host) ? host : null;
}

/**
 * The preview image of a parcel link, for chat apps and social cards. A link
 * that leads nowhere, and a client over its allowance, get Peek's own image.
 */
export async function GET(request: Request, route: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await route.params;
  const language = new URL(request.url).searchParams.get('lang');
  const preview = await parcelLinkPreview(linkId, request.headers, isLocale(language) ? language : 'en');
  return preview ? parcelLinkSocialImage(preview, shownHost(request)) : genericSocialImage();
}
