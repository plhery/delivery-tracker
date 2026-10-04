import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ParcelClientApplication } from '../../../src/ParcelClientApplication';
import { emailConfigured } from '../../../src/server/email/config';
import { parcelLinkMetadata } from '../../../src/server/parcelLinkMetadata';
import { isParcelLinkId } from '../../../src/server/publicParcels';
import { requestLanguage } from '../../../src/server/requestLocale';

/** The link's preview: its status and carrier, read as a viewer and without opening the link. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return parcelLinkMetadata((await params).id);
}

/**
 * A parcel's own page. The server renders the same page for every address;
 * only the preview above says what a link shows. The parcel itself is read
 * by the browser, from the API.
 */
export default async function ParcelLinkPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  // A malformed id is not echoed into the page; the browser reads its own address and shows the link as unavailable.
  return <ParcelClientApplication parcelLinkId={isParcelLinkId(id) ? id : 'unavailable'} deliveryEmails={emailConfigured()} {...await requestLanguage()} />;
}
