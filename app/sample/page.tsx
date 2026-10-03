import { connection } from 'next/server';
import { ClientApplication } from '../../src/ClientApplication';
import { SAMPLE_LINK_ID } from '../../src/peek/sample';
import { requestLanguage } from '../../src/server/requestLocale';

/** The sample parcel, for anyone: a made-up parcel on a parcel page, told by the browser alone. */
export default async function SamplePage() {
  await connection();
  return <ClientApplication parcelLinkId={SAMPLE_LINK_ID} {...await requestLanguage()} />;
}
