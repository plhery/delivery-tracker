import type { Metadata } from 'next';
import { requestOrigin } from '../src/server/requestOrigin';
import { connection } from 'next/server';
import { ClientApplication } from '../src/ClientApplication';

const title = 'Delivery Tracker';
const description =
  'Private parcel tracking, with alerts and history synced across your devices.';

export async function generateMetadata(): Promise<Metadata> {
  const origin = await requestOrigin();
  const image = new URL('/og.png?v=8bd21a86', origin).href;
  return {
    metadataBase: origin,
    title,
    description,
    alternates: { canonical: origin.href },
    openGraph: {
      type: 'website',
      url: origin.href,
      siteName: 'Delivery Tracker',
      title,
      description,
      images: [{
        url: image,
        width: 1_734,
        height: 907,
        alt: 'Delivery Tracker for parcel deliveries',
      }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export default async function HomePage() {
  await connection();
  return <ClientApplication />;
}
