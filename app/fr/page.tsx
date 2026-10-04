import type { Metadata } from 'next';
import { landingMetadata } from '../../src/server/landingMetadata';
import { LandingPage } from '../../src/server/LandingPage';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata('fr');
}

/** The landing in French, for anyone, whatever language the browser prefers. English is at `/`. */
export default function FrenchLandingPage() {
  return <LandingPage language="fr" landingRoute />;
}
