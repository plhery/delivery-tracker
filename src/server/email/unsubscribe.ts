import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The token a delivery email carries so its reader can switch the email off
 * without signing in. It names the account and proves that this server made
 * it: the account id, then its HMAC-SHA256 under a key only the server has.
 * It never expires, so an old email can still opt out. Changing
 * `SUPABASE_SERVICE_ROLE_KEY` invalidates every token made before.
 */

/** What the routes accept as a token before looking at it. */
export const UNSUBSCRIBE_TOKEN = /^[A-Za-z0-9._-]{20,200}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The signing key, derived from the service-role key and kept apart from its other uses by a label. */
function signingKey(): Buffer | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  return secret ? createHmac('sha256', secret).update('delivery-email-unsubscribe').digest() : null;
}

function signature(key: Buffer, account: Buffer): Buffer {
  return createHmac('sha256', key).update(account).digest();
}

/** The token of an account. Throws without the service-role key: a token nobody can check must not be sent. */
export function unsubscribeToken(userId: string): string {
  const key = signingKey();
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to sign an unsubscribe link');
  if (!UUID.test(userId)) throw new TypeError('An unsubscribe link needs an account id');
  const account = Buffer.from(userId.replaceAll('-', ''), 'hex');
  return `${account.toString('base64url')}.${signature(key, account).toString('base64url')}`;
}

/** The account a token names, or null when this server did not make the token. */
export function unsubscribeAccount(token: unknown): string | null {
  if (typeof token !== 'string' || !UNSUBSCRIBE_TOKEN.test(token)) return null;
  const key = signingKey();
  const [id, mac, ...rest] = token.split('.');
  if (!key || !id || !mac || rest.length > 0) return null;
  const account = Buffer.from(id, 'base64url');
  const given = Buffer.from(mac, 'base64url');
  // Decoding ignores what is not base64url: only the one spelling of each part is a token.
  if (account.length !== 16 || account.toString('base64url') !== id || given.toString('base64url') !== mac) return null;
  const expected = signature(key, account);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const hex = account.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Where a token is carried in the page's address: after `#`, which no server is sent. */
export function unsubscribePagePath(token: string | null): string {
  return token === null ? '/email/off' : `/email/off#t=${token}`;
}

/**
 * The two addresses an email carries. `page` is the footer's link: it asks
 * before switching anything. `oneClick` goes in the `List-Unsubscribe` header:
 * a mail app posts to it when its reader presses "Unsubscribe".
 */
export function unsubscribeUrls(origin: string, userId: string): { page: string; oneClick: string } {
  const token = unsubscribeToken(userId);
  return {
    page: `${origin}${unsubscribePagePath(token)}`,
    oneClick: `${origin}/api/email/unsubscribe?t=${token}`,
  };
}
