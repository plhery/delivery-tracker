import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ClientApplication } from '../../src/ClientApplication';
import { SAMPLE_LINK_ID } from '../../src/peek/sample';
import { emailConfigured } from '../../src/server/email/config';
import { sampleLinkMetadata } from '../../src/server/parcelLinkMetadata';
import { requestLanguage } from '../../src/server/requestLocale';

/** The sample's preview: a parcel's picture, noted as made up. */
export async function generateMetadata(): Promise<Metadata> {
  return sampleLinkMetadata();
}

/** The sample parcel, for anyone: a made-up parcel on a parcel page, told by the browser alone. */
export default async function SamplePage() {
  await connection();
  return <ClientApplication parcelLinkId={SAMPLE_LINK_ID} deliveryEmails={emailConfigured()} {...await requestLanguage()} />;
}
