import type { Metadata } from 'next';
import { carrierIndexMetadata, CarrierIndexRoute } from '../../../src/server/carrierPages';

export async function generateMetadata(): Promise<Metadata> {
  return carrierIndexMetadata('pl');
}

/** The carriers with a page in Polish, for anyone, whatever language the browser prefers. English is at `/carriers`. */
export default function PolishCarriersPage() {
  return <CarrierIndexRoute locale="pl" />;
}
