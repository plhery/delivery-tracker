import { connection } from 'next/server';
import { ClientApplication } from '../../../src/ClientApplication';
import { isParcelLinkId } from '../../../src/server/publicParcels';
import { requestLanguage } from '../../../src/server/requestLocale';

/**
 * A parcel's own page. The server renders the same shell for every address:
 * whether a link exists is only ever answered by the API, to the browser.
 */
export default async function ParcelLinkPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  // A malformed id is not echoed into the page; the browser reads its own address and shows the link as unavailable.
  return <ClientApplication parcelLinkId={isParcelLinkId(id) ? id : 'unavailable'} {...await requestLanguage()} />;
}
