import 'server-only';

import { siteHosts } from '../siteHosts';

export interface EmailSettings {
  host: string;
  port: number;
  /** TLS from the first byte, as on port 465. Otherwise the connection must upgrade with STARTTLS. */
  secure: boolean;
  user: string | null;
  password: string | null;
  /** The `From` header, such as `Peek <hello@example.com>`. */
  from: string;
  /** Where replies go, when not to `from`. */
  replyTo: string | null;
  /** The site's origin, for the links an email carries. */
  origin: string;
  /** Whether the sender is registered with Apple's relay, so Hide My Email addresses are written to. */
  appleRelay: boolean;
  /** Delivery emails one account may get per day. */
  perAccountPerDay: number;
  /** Delivery emails all accounts may get per day together. */
  perDay: number;
}

const addressPattern = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/;
const senderPattern = /^(?:[^<>"\r\n]{1,80}\s)?<([^<>\s]+)>$/;

function address(value: string, name: string, named: boolean): string {
  const bare = named ? senderPattern.exec(value)?.[1] ?? value : value;
  if (!addressPattern.test(bare)) {
    throw new Error(named ? `${name} must be an address, or "Name <address>"` : `${name} must be an email address`);
  }
  return value;
}

function count(value: string | undefined, fallback: number, name: string): number {
  const text = value?.trim() ?? '';
  if (!text) return fallback;
  if (!/^\d{1,6}$/.test(text)) throw new Error(`${name} must be a whole number`);
  return Number(text);
}

function flag(value: string | undefined, name: string): boolean | null {
  const text = value?.trim().toLowerCase() ?? '';
  if (!text) return null;
  if (text !== 'true' && text !== 'false') throw new Error(`${name} must be true or false`);
  return text === 'true';
}

/**
 * Reads the mail settings. Without `SMTP_HOST` the server sends no email and
 * this returns null. A partial or malformed set throws, so a deployment fails
 * at startup instead of promising emails it cannot send.
 *
 * Any SMTP service works. The connection is always encrypted: implicit TLS
 * with `SMTP_SECURE=true` (the default on port 465), STARTTLS otherwise.
 */
export function emailSettings(env: NodeJS.ProcessEnv = process.env): EmailSettings | null {
  const host = env.SMTP_HOST?.trim() ?? '';
  if (!host) return null;
  if (!/^[a-z0-9.-]{1,253}$/i.test(host)) throw new Error('SMTP_HOST must be a hostname');
  const port = count(env.SMTP_PORT, 587, 'SMTP_PORT');
  if (port < 1 || port > 65_535) throw new Error('SMTP_PORT must be a port number');
  const user = env.SMTP_USER?.trim() || null;
  const password = env.SMTP_PASSWORD?.trim() || null;
  if ((user === null) !== (password === null)) throw new Error('SMTP_USER and SMTP_PASSWORD go together');
  const from = env.EMAIL_FROM?.trim() ?? '';
  if (!from) throw new Error('SMTP_HOST needs EMAIL_FROM');
  const replyTo = env.EMAIL_REPLY_TO?.trim() || null;
  // Emails carry absolute links, and no request tells a background job where the site lives.
  const origin = siteHosts(env)?.canonicalOrigin;
  if (!origin) throw new Error('SMTP_HOST needs CANONICAL_ORIGIN');
  return {
    host,
    port,
    secure: flag(env.SMTP_SECURE, 'SMTP_SECURE') ?? port === 465,
    user,
    password,
    from: address(from, 'EMAIL_FROM', true),
    replyTo: replyTo === null ? null : address(replyTo, 'EMAIL_REPLY_TO', false),
    origin,
    appleRelay: flag(env.EMAIL_APPLE_RELAY, 'EMAIL_APPLE_RELAY') ?? false,
    perAccountPerDay: count(env.DELIVERY_EMAILS_PER_ACCOUNT_PER_DAY, 20, 'DELIVERY_EMAILS_PER_ACCOUNT_PER_DAY'),
    perDay: count(env.DELIVERY_EMAILS_PER_DAY, 80, 'DELIVERY_EMAILS_PER_DAY'),
  };
}

/** The same reading for request handling: a malformed set sends nothing, and startup reports it. */
export function emailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return emailSettings(env) !== null;
  } catch {
    return false;
  }
}

/** Why an account is not written to, as the code a skipped email is recorded with. */
export type UndeliverableAddress = 'no_address' | 'relay_address';

/**
 * Why the server does not write to an account's address, or null when it does.
 * The address must be one the Auth server confirmed. Apple's Hide My Email
 * relay only takes mail from a sender registered with Apple, so its addresses
 * wait for `EMAIL_APPLE_RELAY`.
 */
export function undeliverableAddress(
  settings: Pick<EmailSettings, 'appleRelay'>,
  email: string | null,
  confirmed: boolean,
): UndeliverableAddress | null {
  if (!email || !confirmed || !addressPattern.test(email)) return 'no_address';
  if (!settings.appleRelay && /@privaterelay\.appleid\.com$/i.test(email)) return 'relay_address';
  return null;
}

/** Whether this server can email an account: mail is configured, and the account has a confirmed address it writes to. */
export function emailAvailable(
  account: { email: string | null; emailConfirmed?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  let settings: EmailSettings | null;
  try {
    settings = emailSettings(env);
  } catch {
    return false;
  }
  return settings !== null && undeliverableAddress(settings, account.email, account.emailConfirmed === true) === null;
}
