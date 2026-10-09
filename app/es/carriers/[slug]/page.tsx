import type { Metadata } from 'next';
import { carrierMetadata, CarrierRoute } from '../../../../src/server/carrierPages';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return carrierMetadata('es', (await params).slug);
}

/**
 * A carrier's page in Spanish, for anyone, whatever language the browser prefers. Any other slug, and a
 * carrier not written in Spanish, is the site's 404.
 */
export default async function SpanishCarrierPage({ params }: { params: Promise<{ slug: string }> }) {
  return <CarrierRoute locale="es" slug={(await params).slug} />;
}
