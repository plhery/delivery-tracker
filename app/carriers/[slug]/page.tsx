import type { Metadata } from 'next';
import { carrierMetadata, CarrierRoute } from '../../../src/server/carrierPages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return carrierMetadata('en', (await params).slug);
}

/**
 * A carrier's page in English, for anyone, whatever language the browser prefers. Any other slug, and a
 * carrier not written in English, is the site's 404.
 */
export default async function EnglishCarrierPage({ params }: { params: Promise<{ slug: string }> }) {
  return <CarrierRoute locale="en" slug={(await params).slug} />;
}
