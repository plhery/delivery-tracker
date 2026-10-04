import type { Metadata } from 'next';
import { connection } from 'next/server';
import { ClientApplication } from '../../src/ClientApplication';
import { emailConfigured } from '../../src/server/email/config';
import { landingMetadata, landingStructuredData } from '../../src/server/landingMetadata';
import { requestLanguage, requestLocale } from '../../src/server/requestLocale';
import { requestOrigin } from '../../src/server/requestOrigin';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata();
}

/** The landing, for anyone: at `/` someone signed in gets their deliveries, here they get the landing too. */
export default async function LandingPage() {
  await connection();
  return <>
    {/* What the page is, for search engines: data, never run. */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: landingStructuredData(await requestOrigin(), await requestLocale()) }} />
    <ClientApplication landingRoute deliveryEmails={emailConfigured()} {...await requestLanguage()} />
  </>;
}
