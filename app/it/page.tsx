import type { Metadata } from 'next';
import { landingMetadata } from '../../src/server/landingMetadata';
import { LandingPage } from '../../src/server/LandingPage';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata('it');
}

/** The landing in Italian, for anyone, whatever language the browser prefers. English is at `/`. */
export default function ItalianLandingPage() {
  return <LandingPage language="it" landingRoute />;
}
