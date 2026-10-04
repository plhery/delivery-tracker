import type { Metadata } from 'next';
import { landingMetadata } from '../../src/server/landingMetadata';
import { LandingPage } from '../../src/server/LandingPage';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata('de');
}

/** The landing in German, for anyone, whatever language the browser prefers. English is at `/`. */
export default function GermanLandingPage() {
  return <LandingPage language="de" landingRoute />;
}
