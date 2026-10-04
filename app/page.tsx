import type { Metadata } from 'next';
import { emailConfigured } from '../src/server/email/config';
import { landingMetadata, landingStructuredData } from '../src/server/landingMetadata';
import { requestMovedOrigin, requestOrigin } from '../src/server/requestOrigin';
import { requestLanguage, requestLocale } from '../src/server/requestLocale';
import { connection } from 'next/server';
import { ClientApplication } from '../src/ClientApplication';

export async function generateMetadata(): Promise<Metadata> {
  return landingMetadata();
}

export default async function HomePage() {
  await connection();
  return <>
    {/* What the page is, for search engines: data, never run. */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: landingStructuredData(await requestOrigin(), await requestLocale()) }} />
    <ClientApplication movedTo={await requestMovedOrigin()} deliveryEmails={emailConfigured()} {...await requestLanguage()} />
  </>;
}
