import type { Metadata } from 'next';
import { emailConfigured } from '../src/server/email/config';
import { landingMetadata } from '../src/server/landingMetadata';
import { requestMovedOrigin } from '../src/server/requestOrigin';
import { requestLanguage } from '../src/server/requestLocale';
import { connection } from 'next/server';
import { ClientApplication } from '../src/ClientApplication';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata();
}

export default async function HomePage() {
  await connection();
  return <ClientApplication movedTo={await requestMovedOrigin()} deliveryEmails={emailConfigured()} {...await requestLanguage()} />;
}
