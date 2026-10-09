import type { Metadata } from 'next';
import { carrierMetadata, CarrierRoute } from '../../../../src/server/carrierPages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return carrierMetadata('pl', (await params).slug);
}

/**
 * A carrier's page in Polish, for anyone, whatever language the browser prefers. Any other slug, and a
 * carrier not written in Polish, is the site's 404.
 */
export default async function PolishCarrierPage({ params }: { params: Promise<{ slug: string }> }) {
  return <CarrierRoute locale="pl" slug={(await params).slug} />;
}
