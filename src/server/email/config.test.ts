import { describe, expect, it } from 'vitest';
import { emailAvailable, emailConfigured, emailSettings, undeliverableAddress } from './config';

// Synthetic values only: no mail server answers at these names.
const complete = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'mailer',
  SMTP_PASSWORD: 'test-smtp-pass',
  EMAIL_FROM: 'Peek <hello@example.com>',
  CANONICAL_ORIGIN: 'https://peek.example.com',
};
const settings = (changes: Record<string, string | undefined> = {}) => emailSettings({ NODE_ENV: 'test', ...complete, ...changes });

describe('mail settings', () => {
  it('sends no email without a mail server, whatever else is set', () => {
    expect(emailSettings({ NODE_ENV: 'test' })).toBeNull();
    expect(settings({ SMTP_HOST: undefined })).toBeNull();
    expect(settings({ SMTP_HOST: '  ' })).toBeNull();
    expect(emailConfigured({ NODE_ENV: 'test' })).toBe(false);
    expect(emailConfigured({ NODE_ENV: 'test', ...complete })).toBe(true);
  });

  it('reads a complete set, with STARTTLS on port 587 unless told otherwise', () => {
    expect(settings()).toEqual({
      host: 'smtp.example.com', port: 587, secure: false, user: 'mailer', password: 'test-smtp-pass',
      from: 'Peek <hello@example.com>', replyTo: null, origin: 'https://peek.example.com',
      appleRelay: false, perAccountPerDay: 20, perDay: 80,
    });
    expect(settings({
      SMTP_PORT: '2525', EMAIL_FROM: ' hello@example.com ', EMAIL_REPLY_TO: 'help@example.com', EMAIL_APPLE_RELAY: 'TRUE',
      DELIVERY_EMAILS_PER_ACCOUNT_PER_DAY: '5', DELIVERY_EMAILS_PER_DAY: '0',
    })).toMatchObject({
      port: 2525, secure: false, from: 'hello@example.com', replyTo: 'help@example.com', appleRelay: true,
      perAccountPerDay: 5, perDay: 0,
    });
    // A relay that needs no login.
    expect(settings({ SMTP_USER: undefined, SMTP_PASSWORD: '' })).toMatchObject({ user: null, password: null });
  });

  it('uses TLS from the first byte on port 465, and wherever it is asked for', () => {
    expect(settings({ SMTP_PORT: '465' })).toMatchObject({ port: 465, secure: true });
    expect(settings({ SMTP_PORT: '465', SMTP_SECURE: 'false' })).toMatchObject({ port: 465, secure: false });
    expect(settings({ SMTP_SECURE: 'true' })).toMatchObject({ port: 587, secure: true });
  });

  it.each([
    [{ EMAIL_FROM: undefined }, 'SMTP_HOST needs EMAIL_FROM'],
    [{ CANONICAL_ORIGIN: undefined }, 'SMTP_HOST needs CANONICAL_ORIGIN'],
    [{ SMTP_PASSWORD: undefined }, 'SMTP_USER and SMTP_PASSWORD go together'],
    [{ SMTP_USER: undefined }, 'SMTP_USER and SMTP_PASSWORD go together'],
    [{ SMTP_HOST: 'smtp.example.com:587' }, 'SMTP_HOST must be a hostname'],
    [{ SMTP_HOST: 'smtps://smtp.example.com' }, 'SMTP_HOST must be a hostname'],
    [{ SMTP_PORT: 'submission' }, 'SMTP_PORT must be a whole number'],
    [{ SMTP_PORT: '0' }, 'SMTP_PORT must be a port number'],
    [{ SMTP_PORT: '70000' }, 'SMTP_PORT must be a port number'],
    [{ SMTP_SECURE: 'yes' }, 'SMTP_SECURE must be true or false'],
    [{ EMAIL_FROM: 'Peek' }, 'EMAIL_FROM must be an address, or "Name <address>"'],
    [{ EMAIL_FROM: 'Peek <hello@example.com>, Other <other@example.com>' }, 'EMAIL_FROM must be an address, or "Name <address>"'],
    [{ EMAIL_REPLY_TO: 'Help <help@example.com>' }, 'EMAIL_REPLY_TO must be an email address'],
    [{ EMAIL_APPLE_RELAY: '1' }, 'EMAIL_APPLE_RELAY must be true or false'],
    [{ DELIVERY_EMAILS_PER_DAY: 'unlimited' }, 'DELIVERY_EMAILS_PER_DAY must be a whole number'],
    [{ DELIVERY_EMAILS_PER_ACCOUNT_PER_DAY: '-1' }, 'DELIVERY_EMAILS_PER_ACCOUNT_PER_DAY must be a whole number'],
    [{ CANONICAL_ORIGIN: 'peek.example.com' }, 'CANONICAL_ORIGIN must be an HTTP(S) origin'],
  ])('stops on a partial or malformed set: %o', (changes, message) => {
    expect(() => settings(changes)).toThrow(message);
    // A request reads the same set as none: startup is where it is reported.
    expect(emailConfigured({ NODE_ENV: 'test', ...complete, ...changes })).toBe(false);
  });

  it('never names the password in what it reports', () => {
    for (const changes of [{ SMTP_USER: undefined }, { SMTP_PORT: 'x' }, { EMAIL_FROM: undefined }]) {
      try {
        settings(changes);
        expect.unreachable();
      } catch (error) {
        expect(String(error)).not.toContain(complete.SMTP_PASSWORD);
      }
    }
  });
});

describe('which accounts the server writes to', () => {
  it('writes to a confirmed address only', () => {
    const plain = { appleRelay: false };
    expect(undeliverableAddress(plain, 'alex@example.com', true)).toBeNull();
    expect(undeliverableAddress(plain, 'alex@example.com', false)).toBe('no_address');
    expect(undeliverableAddress(plain, null, true)).toBe('no_address');
    expect(undeliverableAddress(plain, '', true)).toBe('no_address');
    // One address, and nothing a mail header could be bent with.
    for (const odd of ['alex', 'alex@example', 'alex@example.com, other@example.com', 'alex@example.com\r\nBcc: other@example.com',
      'Alex <alex@example.com>']) {
      expect(undeliverableAddress(plain, odd, true)).toBe('no_address');
    }
  });

  it('leaves Apple relay addresses until the sender is registered with Apple', () => {
    const relay = 'synthetic1234@privaterelay.appleid.com';
    expect(undeliverableAddress({ appleRelay: false }, relay, true)).toBe('relay_address');
    expect(undeliverableAddress({ appleRelay: false }, relay.toUpperCase(), true)).toBe('relay_address');
    expect(undeliverableAddress({ appleRelay: true }, relay, true)).toBeNull();
    expect(undeliverableAddress({ appleRelay: true }, relay, false)).toBe('no_address');
    // Only that host: an address that merely mentions it is an ordinary one.
    expect(undeliverableAddress({ appleRelay: false }, 'privaterelay.appleid.com@example.com', true)).toBeNull();
  });

  it('can email an account when mail is configured and its address can be written to', () => {
    const env = { NODE_ENV: 'test', ...complete } as const;
    const account = { email: 'alex@example.com', emailConfirmed: true };
    expect(emailAvailable(account, env)).toBe(true);
    expect(emailAvailable(account, { NODE_ENV: 'test' })).toBe(false);
    expect(emailAvailable(account, { ...env, EMAIL_FROM: undefined })).toBe(false);
    expect(emailAvailable({ ...account, emailConfirmed: false }, env)).toBe(false);
    expect(emailAvailable({ email: 'alex@example.com' }, env)).toBe(false);
    expect(emailAvailable({ email: null, emailConfirmed: true }, env)).toBe(false);
    const relayed = { email: 'synthetic1234@privaterelay.appleid.com', emailConfirmed: true };
    expect(emailAvailable(relayed, env)).toBe(false);
    expect(emailAvailable(relayed, { ...env, EMAIL_APPLE_RELAY: 'true' })).toBe(true);
  });
});
