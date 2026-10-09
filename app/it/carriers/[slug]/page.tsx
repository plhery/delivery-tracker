import type { Metadata } from 'next';
import { carrierMetadata, CarrierRoute } from '../../../../src/server/carrierPages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return carrierMetadata('it', (await params).slug);
}

/**
 * A carrier's page in Italian, for anyone, whatever language the browser prefers. Any other slug, and a
 * carrier not written in Italian, is the site's 404.
 */
export default async function ItalianCarrierPage({ params }: { params: Promise<{ slug: string }> }) {
  return <CarrierRoute locale="it" slug={(await params).slug} />;
}
