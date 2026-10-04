import type { Metadata } from 'next';
import { landingMetadata } from '../../src/server/landingMetadata';
import { LandingPage } from '../../src/server/LandingPage';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata();
}

/** The landing, for anyone: at `/` someone signed in gets their deliveries, here they get the landing too. */
export default function LandingAddressPage() {
  return <LandingPage landingRoute />;
}
