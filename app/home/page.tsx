import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ClientApplication } from '../../src/ClientApplication';
import { emailConfigured } from '../../src/server/email/config';
import { landingMetadata } from '../../src/server/landingMetadata';
import { requestLanguage } from '../../src/server/requestLocale';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata();
}

/** The landing, for anyone: at `/` someone signed in gets their deliveries, here they get the landing too. */
export default async function LandingPage() {
  await connection();
  return <ClientApplication landingRoute deliveryEmails={emailConfigured()} {...await requestLanguage()} />;
}
