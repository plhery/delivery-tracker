import type { Metadata } from 'next';
import { landingMetadata } from '../../src/server/landingMetadata';
import { LandingPage } from '../../src/server/LandingPage';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata('es');
}

/** The landing in Spanish, for anyone, whatever language the browser prefers. English is at `/`. */
export default function SpanishLandingPage() {
  return <LandingPage language="es" landingRoute />;
}
