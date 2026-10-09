import type { Metadata } from 'next';
import { carrierIndexMetadata, CarrierIndexRoute } from '../../../src/server/carrierPages';

export async function generateMetadata(): Promise<Metadata> {
  return carrierIndexMetadata('es');
}

/** The carriers with a page in Spanish, for anyone, whatever language the browser prefers. English is at `/carriers`. */
export default function SpanishCarriersPage() {
  return <CarrierIndexRoute locale="es" />;
}
