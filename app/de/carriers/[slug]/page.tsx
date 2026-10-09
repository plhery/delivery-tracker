import type { Metadata } from 'next';
import { carrierMetadata, CarrierRoute } from '../../../../src/server/carrierPages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return carrierMetadata('de', (await params).slug);
}

/**
 * A carrier's page in German, for anyone, whatever language the browser prefers. Any other slug, and a
 * carrier not written in German, is the site's 404.
 */
export default async function GermanCarrierPage({ params }: { params: Promise<{ slug: string }> }) {
  return <CarrierRoute locale="de" slug={(await params).slug} />;
}
