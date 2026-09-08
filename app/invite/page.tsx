import type { Metadata } from 'next';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { ClientApplication } from '../../src/ClientApplication';
import { invitationDescription, invitationSocialNickname, invitationTitle } from '../../src/server/invitationSocial';
import { requestOrigin } from '../../src/server/requestOrigin';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }): Promise<Metadata> {
  const { preview } = await searchParams;
  const nickname = await invitationSocialNickname(preview, await headers());
  const origin = await requestOrigin();
  const url = new URL('/invite', origin);
  const image = new URL('/api/friends/invite-image', origin);
  // Each invitation has its own social identity, without exposing its acceptance token.
  if (typeof preview === 'string' && /^[a-f0-9]{64}$/.test(preview)) {
    url.searchParams.set('preview', preview);
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

export default async function InvitationPage() {
  await connection();
  return <ClientApplication invitationRoute />;
}
