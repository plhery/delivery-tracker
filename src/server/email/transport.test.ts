import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailSettings } from './config';
import { deliveryEmail } from './deliveryEmails';
import { EmailSendError, mailOptions, openTransport, transportOptions, type OutgoingEmail } from './transport';
import { DELIVERY_CARD_CID } from './types';

// No test opens a socket: the mail library's transport is replaced, and the
// one test that reads a whole message has the library write it into memory.
const smtp = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn(), close: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.createTransport } }));

// Synthetic values only.
const settings: EmailSettings = {
  host: 'smtp.example.com', port: 587, secure: false, user: 'mailer', password: 'test-smtp-pass',
  from: 'Peek <hello@example.com>', replyTo: 'help@example.com', origin: 'https://peek.example.com',
  appleRelay: false, perAccountPerDay: 20, perDay: 80,
};
const card = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const email: OutgoingEmail = {
  to: 'alex@example.com',
  subject: 'Your sneakers were delivered',
  text: 'Delivered today at 14:12.',
  html: `<p>Delivered today at 14:12.</p><img src="cid:${DELIVERY_CARD_CID}" alt="">`,
  headers: { 'Auto-Submitted': 'auto-generated' },
  inline: [{ cid: DELIVERY_CARD_CID, filename: 'parcel.png', contentType: 'image/png', content: card }],
};

beforeEach(() => {
  smtp.sendMail.mockResolvedValue({ messageId: '<synthetic@example.com>' });
  smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail, close: smtp.close });
});
afterEach(() => { vi.clearAllMocks(); });

describe('the connection to the mail server', () => {
  it('must upgrade with STARTTLS, waits a bounded time and logs nothing', () => {
    openTransport(settings);
    expect(smtp.createTransport).toHaveBeenCalledExactlyOnceWith({
      host: 'smtp.example.com', port: 587, secure: false, requireTLS: true,
      auth: { user: 'mailer', pass: 'test-smtp-pass' },
      connectionTimeout: 10_000, greetingTimeout: 10_000, dnsTimeout: 10_000, socketTimeout: 20_000,
      logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
    });
  });

  it('uses TLS from the first byte when the settings say so, and no login when there is none', () => {
    expect(transportOptions({ ...settings, port: 465, secure: true })).toMatchObject({ port: 465, secure: true, requireTLS: false });
    const open = transportOptions({ ...settings, user: null, password: null });
    expect(open).not.toHaveProperty('auth');
    expect(open).toMatchObject({ secure: false, requireTLS: true });
    // Certificates are checked, and the upgrade is never optional.
    for (const options of [open, transportOptions(settings)]) {
      expect(options).not.toHaveProperty('tls');
      expect(options).not.toHaveProperty('ignoreTLS');
      expect(options).not.toHaveProperty('opportunisticTLS');
    }
  });

  it('opens one transport for a run and closes it afterwards', async () => {
    const transport = openTransport(settings);
    await transport.send(email);
    await transport.send({ ...email, to: 'second@example.com' });
    expect(smtp.createTransport).toHaveBeenCalledOnce();
    expect(smtp.sendMail).toHaveBeenCalledTimes(2);
    expect(smtp.close).not.toHaveBeenCalled();
    transport.close();
    expect(smtp.close).toHaveBeenCalledOnce();
  });
});

describe('an email as it is handed to the mail library', () => {
  it('goes from the configured sender to one address, with its picture inside', async () => {
    await openTransport(settings).send(email);
    expect(smtp.sendMail).toHaveBeenCalledExactlyOnceWith({
      from: 'Peek <hello@example.com>',
      replyTo: 'help@example.com',
      to: { name: '', address: 'alex@example.com' },
      subject: 'Your sneakers were delivered',
      text: 'Delivered today at 14:12.',
      html: email.html,
      headers: { 'Auto-Submitted': 'auto-generated' },
      attachments: [{
        cid: DELIVERY_CARD_CID, filename: 'parcel.png', contentType: 'image/png', contentDisposition: 'inline',
        content: Buffer.from(card),
      }],
      xMailer: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  });

  it('leaves out what an email does not have', () => {
    const plain = mailOptions({ from: 'hello@example.com', replyTo: null }, { ...email, headers: undefined, inline: undefined });
    expect(plain).not.toHaveProperty('replyTo');
    expect(plain).toMatchObject({ from: 'hello@example.com', headers: {}, attachments: [] });
  });

  it('is written by the library as one message: headers, both versions and the card', async () => {
    const actual = await vi.importActual<typeof import('nodemailer')>('nodemailer');
    const oneClick = `https://peek.example.com/api/email/unsubscribe?t=${'t'.repeat(22)}.${'s'.repeat(43)}`;
    const message = deliveryEmail('alex@example.com', {
      subject: 'Your sneakers were delivered', text: email.text, html: email.html, card,
    }, oneClick);
    const written = await actual.default.createTransport({ streamTransport: true, buffer: true, newline: 'windows' })
      .sendMail(mailOptions(settings, message));
    const raw = (written.message as Buffer).toString('utf8');
    const [head = ''] = raw.split('\r\n\r\n');
    // A long header is folded over several lines: read each as one.
    const headers = head.replace(/\r\n[ \t]+/g, ' ').split('\r\n');
    const header = (name: string) => headers.filter((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`))
      .map((line) => line.slice(name.length + 1).trim());

    expect(header('From')).toEqual(['Peek <hello@example.com>']);
    expect(header('To')).toEqual(['alex@example.com']);
    expect(header('Reply-To')).toEqual(['help@example.com']);
    expect(header('Subject')).toEqual(['Your sneakers were delivered']);
    // Exactly one address, over HTTPS, and the exact value mail apps look for.
    expect(header('List-Unsubscribe')).toEqual([`<${oneClick}>`]);
    expect(header('List-Unsubscribe-Post')).toEqual(['List-Unsubscribe=One-Click']);
    expect(header('Auto-Submitted')).toEqual(['auto-generated']);
    expect(header('X-Auto-Response-Suppress')).toEqual(['All']);
    for (const absent of ['X-Mailer', 'Cc', 'Bcc', 'Disposition-Notification-To', 'Return-Receipt-To']) {
      expect(header(absent)).toEqual([]);
    }
    expect(written.envelope).toEqual({ from: 'hello@example.com', to: ['alex@example.com'] });

    // Plain text and HTML as alternatives, the card beside the HTML, shown inline by its content id.
    expect(header('Content-Type')[0]).toMatch(/^multipart\/alternative;/);
    expect(raw).toMatch(/Content-Type: text\/plain; charset=utf-8/i);
    expect(raw).toMatch(/Content-Type: multipart\/related;/i);
    expect(raw).toMatch(/Content-Type: text\/html; charset=utf-8/i);
    expect(raw).toMatch(/Content-Type: image\/png; name=parcel\.png/i);
    expect(raw).toContain(`Content-ID: <${DELIVERY_CARD_CID}>`);
    expect(raw).toMatch(/Content-Disposition: inline; filename=parcel\.png/i);
    expect(raw).toContain(Buffer.from(card).toString('base64'));
    expect(raw).toContain(`cid:${DELIVERY_CARD_CID}`);
    // The only address in the message is the one to unsubscribe at: nothing is fetched to show it.
    expect(raw.replace(/=\r\n/g, '').match(/https?:\/\/[^\s<>"]+/g)).toEqual([oneClick]);
  });
});

describe('a send the mail server did not take', () => {
  it('is reported by its kind and status, without what the server said about the recipient', async () => {
    smtp.sendMail.mockRejectedValue(Object.assign(
      new Error('Can\'t send mail - all recipients were rejected: 550 5.1.1 <alex@example.com>: Recipient address rejected'),
      {
        code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO', recipient: 'alex@example.com',
        rejected: ['alex@example.com'], response: '550 5.1.1 <alex@example.com>: Recipient address rejected',
      },
    ));
    const failure = await openTransport(settings).send(email).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmailSendError);
    expect(failure).toMatchObject({ name: 'EmailSendError', code: 'EENVELOPE', smtpStatus: 550 });
    expect((failure as Error).message).toBe('The mail server did not take the email (EENVELOPE 550)');
    expect((failure as Error).cause).toBeUndefined();
    const everything = JSON.stringify([failure, Object.entries(failure as object), (failure as Error).message, (failure as Error).stack]);
    for (const personal of ['alex@example.com', 'Recipient address', 'Your sneakers', settings.password!, 'RCPT']) {
      expect(everything).not.toContain(personal);
    }
  });

  it.each([
    [Object.assign(new Error('Invalid login: 535 Authentication failed'), { code: 'EAUTH', responseCode: 535 }), 'EAUTH', 535, '(EAUTH 535)'],
    [Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }), 'ETIMEDOUT', null, '(ETIMEDOUT)'],
    [Object.assign(new Error('odd'), { code: 'alex@example.com', responseCode: 99_999 }), null, null, ''],
    [Object.assign(new Error('odd'), { code: 42, responseCode: '550' }), null, null, ''],
    ['a string, not an error', null, null, ''],
    [null, null, null, ''],
  ])('keeps only a known shape of failure: %o', async (thrown, code, smtpStatus, suffix) => {
    smtp.sendMail.mockRejectedValue(thrown);
    const failure = await openTransport(settings).send(email).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmailSendError);
    expect(failure).toMatchObject({ code, smtpStatus });
    expect((failure as Error).message).toBe(`The mail server did not take the email${suffix ? ` ${suffix}` : ''}`);
  });
});
