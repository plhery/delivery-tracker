import type { Metadata } from 'next';
import { carrierIndexMetadata, CarrierIndexRoute } from '../../../src/server/carrierPages';

export async function generateMetadata(): Promise<Metadata> {
  return carrierIndexMetadata('de');
}

/** The carriers with a page in German, for anyone, whatever language the browser prefers. English is at `/carriers`. */
export default function GermanCarriersPage() {
  return <CarrierIndexRoute locale="de" />;
}
