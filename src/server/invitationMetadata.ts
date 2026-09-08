import 'server-only';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { isInvitationPreviewId } from '../lib/invitationLinkFormat';
import { invitationDescription, invitationSocialNickname, invitationTitle } from './invitationSocial';
import { requestOrigin } from './requestOrigin';

export async function invitationMetadata(preview: string | string[] | undefined): Promise<Metadata> {
  const nickname = await invitationSocialNickname(preview, await headers());
  const origin = await requestOrigin();
  const short = isInvitationPreviewId(preview);
  const url = new URL(short ? `/i/${preview}` : '/invite', origin);
  const image = new URL('/api/friends/invite-image', origin);
  // Each invitation has its own social identity, without exposing its acceptance token.
  if (typeof preview === 'string' && (short || /^[a-f0-9]{64}$/.test(preview))) {
    if (!short) url.searchParams.set('preview', preview);
    image.searchParams.set('preview', preview);
  }
  const title = invitationTitle(nickname);
  return {
    metadataBase: origin,
    title,
    description: invitationDescription,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    alternates: { canonical: url.href },
    openGraph: {
      type: 'website', url: url.href, siteName: 'Delivery Tracker', title, description: invitationDescription,
      images: [{ url: image.href, width: 1200, height: 630, type: 'image/png', alt: title }],
    },
    twitter: { card: 'summary_large_image', title, description: invitationDescription, images: [{ url: image.href, alt: title }] },
  };
}
