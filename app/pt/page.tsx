import type { Metadata } from 'next';
import { landingMetadata } from '../../src/server/landingMetadata';
import { LandingPage } from '../../src/server/LandingPage';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata('pt');
}

/** The landing in Portuguese, for anyone, whatever language the browser prefers. English is at `/`. */
export default function PortugueseLandingPage() {
  return <LandingPage language="pt" landingRoute />;
}
