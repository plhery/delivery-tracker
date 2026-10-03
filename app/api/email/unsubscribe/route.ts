import {
  apiRoute,
  HttpError,
  json,
  readJsonObject,
  requireService,
} from '../../../../src/server/api';
import { emailConfigured } from '../../../../src/server/email/config';
import {
  UNSUBSCRIBE_TOKEN,
  unsubscribeAccount,
  unsubscribePagePath,
} from '../../../../src/server/email/unsubscribe';
import { deliveryEmailSwitch } from '../../../../src/server/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** One answer for a token this server did not make and for an account that is gone. */
const INVALID_LINK = 'This link is not valid';
const RATE_LIMIT = { limit: 30, window: 60 };

/**
 * Switches an account's delivery email with the token its emails carry. Nobody
 * is signed in: the token is the right to do it.
 *
 * A mail app posts here when its reader presses "Unsubscribe" (RFC 8058): the
 * token is in the address, the body is a form of the app's own and is not
 * read, and the answer is a plain 200. The page an email links to posts JSON,
 * and can switch the email back on with the same token.
 */
export const POST = apiRoute(async (context) => {
  if (!emailConfigured()) throw new HttpError(503, 'This server sends no email');
  const inAddress = context.request.nextUrl.searchParams.get('t');
  const { token, enabled } = inAddress !== null
    ? { token: inAddress, enabled: false }
    : deliveryEmailSwitch(await readJsonObject(context.request));
  const userId = unsubscribeAccount(token);
  const stored = userId === null ? null : await requireService(context).setDeliveryEmail(userId, enabled);
  if (stored === null) throw new HttpError(400, INVALID_LINK);
  return json({ emailOnDelivery: stored });
}, { authenticated: false, serviceRequired: true, capability: true, anyBody: true, publicRateLimit: RATE_LIMIT });

/**
 * Someone opened the header's address in a browser. Nothing is switched: mail
 * scanners open links too. The reader continues on the page that asks first,
 * with the token after `#`, where no server is sent it.
 */
export const GET = apiRoute((context) => {
  const token = context.request.nextUrl.searchParams.get('t');
  return new Response(null, {
    status: 303,
    headers: {
      Location: unsubscribePagePath(token !== null && UNSUBSCRIBE_TOKEN.test(token) ? token : null),
      'Referrer-Policy': 'no-referrer',
    },
  });
}, { authenticated: false, loadService: false, capability: true, publicRateLimit: RATE_LIMIT });
