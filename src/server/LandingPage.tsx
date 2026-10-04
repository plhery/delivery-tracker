import 'server-only';
import { connection } from 'next/server';
import { ClientApplication } from '../ClientApplication';
import type { AddressLanguage } from '../lib/locale';
import { emailConfigured } from './email/config';
import { landingAddress } from './landingMetadata';
import { jsonForScript, landingStructuredData } from './landingStructuredData';
import { languageFor, requestLanguage } from './requestLocale';
import { siteOrigin } from './requestOrigin';

/**
 * The landing as the server writes it, at each of its addresses: what the
 * page tells search engines about the site, then the app.
 */
export async function LandingPage({ language, landingRoute = false, movedTo }: {
  /** The language of the address, at a language address: the page is in it whatever the browser prefers. */
  language?: AddressLanguage;
  /** The address shows the landing to someone signed in too. */
  landingRoute?: boolean;
  /** The origin the site moved to, when the page is rendered on a host it has left. */
  movedTo?: string;
}) {
  await connection();
  const words = language ? languageFor(language) : await requestLanguage();
  const origin = await siteOrigin();
  const data = landingStructuredData({ origin, url: landingAddress(origin, language ?? 'en'), locale: words.initialLocale });
  return <>
    {/* Data, not a script: the browser runs nothing of it, so the page's script policy does not apply. */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(data) }} />
    <ClientApplication landingRoute={landingRoute} movedTo={movedTo} deliveryEmails={emailConfigured()} {...words} />
  </>;
}
