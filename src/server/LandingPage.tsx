import 'server-only';
import { connection } from 'next/server';
import { ClientApplication } from '../ClientApplication';
import { emailConfigured } from './email/config';
import { jsonForScript, landingStructuredData } from './landingStructuredData';
import { requestLanguage } from './requestLocale';
import { siteOrigin } from './requestOrigin';

/**
 * The landing as the server writes it, at each of its addresses: what the
 * page tells search engines about the site, then the app.
 */
export async function LandingPage({ landingRoute = false, movedTo }: {
  /** The address shows the landing to someone signed in too. */
  landingRoute?: boolean;
  /** The origin the site moved to, when the page is rendered on a host it has left. */
  movedTo?: string;
}) {
  await connection();
  const language = await requestLanguage();
  const origin = await siteOrigin();
  const data = landingStructuredData({ origin, url: origin.href, locale: language.initialLocale });
  return <>
    {/* Data, not a script: the browser runs nothing of it, so the page's script policy does not apply. */}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScript(data) }} />
    <ClientApplication landingRoute={landingRoute} movedTo={movedTo} deliveryEmails={emailConfigured()} {...language} />
  </>;
}
