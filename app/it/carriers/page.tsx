import type { Metadata } from 'next';
import { carrierIndexMetadata, CarrierIndexRoute } from '../../../src/server/carrierPages';

export async function generateMetadata(): Promise<Metadata> {
  return carrierIndexMetadata('it');
}

/** The carriers with a page in Italian, for anyone, whatever language the browser prefers. English is at `/carriers`. */
export default function ItalianCarriersPage() {
  return <CarrierIndexRoute locale="it" />;
}
