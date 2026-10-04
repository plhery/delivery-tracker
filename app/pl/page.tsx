import type { Metadata } from 'next';
import { landingMetadata } from '../../src/server/landingMetadata';
import { LandingPage } from '../../src/server/LandingPage';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata('pl');
}

/** The landing in Polish, for anyone, whatever language the browser prefers. English is at `/`. */
export default function PolishLandingPage() {
  return <LandingPage language="pl" landingRoute />;
}
