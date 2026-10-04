import type { Metadata } from 'next';
import { landingMetadata } from '../src/server/landingMetadata';
import { LandingPage } from '../src/server/LandingPage';
import { requestMovedOrigin } from '../src/server/requestOrigin';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata();
}

export default async function HomePage() {
  return <LandingPage movedTo={await requestMovedOrigin()} />;
}
