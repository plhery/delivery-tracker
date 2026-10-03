import { isLocale } from '../../../src/lib/locale';
import { exampleDeliveryEmail } from '../../../src/server/email/content';
import { DELIVERY_CARD_CID } from '../../../src/server/email/types';
import { requestOrigin } from '../../../src/server/requestOrigin';
import { siteHosts } from '../../../src/server/siteHosts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  // The same for everyone who reads it in one language.
  'Cache-Control': 'public, max-age=3600',
  'X-Robots-Tag': 'noindex, nofollow',
  // An email runs nothing and loads nothing: its styles are inline, and its one picture is part of the document.
  'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

/** Where the site lives, when the deployment says so; a malformed setting is reported at startup. */
function canonicalOrigin(): string | null {
  try {
    return siteHosts()?.canonicalOrigin ?? null;
  } catch {
    return null;
  }
}

/**
 * The delivery email as a page, for "See an example" in Settings: a made-up
 * parcel in the language asked for, drawn by the code that writes the real
 * email. It needs no mail settings and no account.
 */
export async function GET(request: Request): Promise<Response> {
  const language = new URL(request.url).searchParams.get('lang');
  const email = await exampleDeliveryEmail(isLocale(language) ? language : 'en', canonicalOrigin() ?? (await requestOrigin()).origin);
  // A page has no attachments: the card goes into the document itself.
  const card = email.card ? `data:image/png;base64,${Buffer.from(email.card).toString('base64')}` : '';
  return new Response(email.html.replace(`cid:${DELIVERY_CARD_CID}`, card), { headers: HEADERS });
}
