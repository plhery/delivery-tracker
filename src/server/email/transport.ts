import 'server-only';

import nodemailer from 'nodemailer';
import type { SendMailOptions, SMTPTransportOptions } from 'nodemailer';
import type { EmailSettings } from './config';

const CONNECT_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 20_000;

/** A picture the HTML shows as `cid:<cid>`. It travels inside the email: nothing is fetched to show it. */
export interface InlineImage {
  cid: string;
  filename: string;
  contentType: string;
  content: Uint8Array;
}

/** One email to one address. The sender comes from the mail settings. */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  inline?: InlineImage[];
}

export interface EmailTransport {
  send(email: OutgoingEmail): Promise<void>;
  close(): void;
}

/**
 * Why the mail server did not take an email. The mail library's own error
 * quotes the recipient and the server's reply, which may quote it too: only
 * its class of failure and the SMTP status are kept, so this can be logged
 * and reported.
 */
export class EmailSendError extends Error {
  constructor(readonly code: string | null, readonly smtpStatus: number | null) {
    const details = [code, smtpStatus].filter((detail) => detail !== null).join(' ');
    super(`The mail server did not take the email${details ? ` (${details})` : ''}`);
    this.name = 'EmailSendError';
  }
}

function sendError(error: unknown): EmailSendError {
  const details = typeof error === 'object' && error !== null ? error as { code?: unknown; responseCode?: unknown } : {};
  return new EmailSendError(
    typeof details.code === 'string' && /^E[A-Z0-9_]{1,30}$/.test(details.code) ? details.code : null,
    typeof details.responseCode === 'number' && Number.isInteger(details.responseCode)
      && details.responseCode >= 100 && details.responseCode <= 599 ? details.responseCode : null,
  );
}

/**
 * The connection to the mail server. It is always encrypted: TLS from the
 * first byte when `secure`, otherwise a STARTTLS upgrade the server must
 * offer. The library logs nothing: its log lines name the recipient, and with
 * debugging the message and the login.
 */
export function transportOptions(settings: EmailSettings): SMTPTransportOptions {
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    ...(settings.user !== null && settings.password !== null
      ? { auth: { user: settings.user, pass: settings.password } }
      : {}),
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: CONNECT_TIMEOUT_MS,
    dnsTimeout: CONNECT_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    logger: false,
    debug: false,
    // No message can make the server read a file or fetch an address.
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/** An email as the mail library takes it, from the configured sender. */
export function mailOptions(settings: Pick<EmailSettings, 'from' | 'replyTo'>, email: OutgoingEmail): SendMailOptions {
  return {
    from: settings.from,
    ...(settings.replyTo !== null ? { replyTo: settings.replyTo } : {}),
    // As an object the address is taken as it is, never parsed into several.
    to: { name: '', address: email.to },
    subject: email.subject,
    text: email.text,
    html: email.html,
    headers: { ...email.headers },
    attachments: (email.inline ?? []).map((image) => ({
      cid: image.cid,
      filename: image.filename,
      contentType: image.contentType,
      contentDisposition: 'inline',
      content: Buffer.from(image.content),
    })),
    // The email does not say what software sent it.
    xMailer: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/**
 * Opens the transport one dispatch run sends through. Each email travels over
 * its own connection, so one that fails says nothing about the next. Close it
 * when the run is over.
 */
export function openTransport(settings: EmailSettings): EmailTransport {
  const transporter = nodemailer.createTransport(transportOptions(settings));
  return {
    async send(email) {
      try {
        await transporter.sendMail(mailOptions(settings, email));
      } catch (error) {
        throw sendError(error);
      }
    },
    close() {
      transporter.close();
    },
  };
}
