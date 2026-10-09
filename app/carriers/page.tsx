import type { Metadata } from 'next';
import { carrierIndexMetadata, CarrierIndexRoute } from '../../src/server/carrierPages';

export async function generateMetadata(): Promise<Metadata> {
  return carrierIndexMetadata('en');
}

/** The carriers with a page in English, for anyone, whatever language the browser prefers. The other languages are at `/<language>/carriers`. */
export default function EnglishCarriersPage() {
  return <CarrierIndexRoute locale="en" />;
}
