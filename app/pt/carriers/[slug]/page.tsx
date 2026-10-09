import type { Metadata } from 'next';
import { carrierMetadata, CarrierRoute } from '../../../../src/server/carrierPages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return carrierMetadata('pt', (await params).slug);
}

/**
 * A carrier's page in Portuguese, for anyone, whatever language the browser prefers. Any other slug, and a
 * carrier not written in Portuguese, is the site's 404.
 */
export default async function PortugueseCarrierPage({ params }: { params: Promise<{ slug: string }> }) {
  return <CarrierRoute locale="pt" slug={(await params).slug} />;
}
