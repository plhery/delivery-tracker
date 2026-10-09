import type { Metadata } from 'next';
import { carrierIndexMetadata, CarrierIndexRoute } from '../../../src/server/carrierPages';

export async function generateMetadata(): Promise<Metadata> {
  return carrierIndexMetadata('fr');
}

/** The carriers with a page in French, for anyone, whatever language the browser prefers. English is at `/carriers`. */
export default function FrenchCarriersPage() {
  return <CarrierIndexRoute locale="fr" />;
}
