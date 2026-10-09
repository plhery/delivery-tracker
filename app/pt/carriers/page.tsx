import type { Metadata } from 'next';
import { carrierIndexMetadata, CarrierIndexRoute } from '../../../src/server/carrierPages';

export async function generateMetadata(): Promise<Metadata> {
  return carrierIndexMetadata('pt');
}

/** The carriers with a page in Portuguese, for anyone, whatever language the browser prefers. English is at `/carriers`. */
export default function PortugueseCarriersPage() {
  return <CarrierIndexRoute locale="pt" />;
}
