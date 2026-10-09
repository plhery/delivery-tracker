import type { Metadata } from 'next';
import { carrierMetadata, CarrierRoute } from '../../../../src/server/carrierPages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return carrierMetadata('fr', (await params).slug);
}

/**
 * A carrier's page in French, for anyone, whatever language the browser prefers. Any other slug, and a
 * carrier not written in French, is the site's 404.
 */
export default async function FrenchCarrierPage({ params }: { params: Promise<{ slug: string }> }) {
  return <CarrierRoute locale="fr" slug={(await params).slug} />;
}
