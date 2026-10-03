import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as metrics from '../metrics';
import * as observability from '../observability';
import { SupabaseError, SupabaseServiceClient, type AuthAccount, type DeliveryEmailClaim } from '../supabase';
import type { JsonObject } from '../types';
import type { EmailSettings } from './config';
import { deliveryEmail, DeliveryEmailService, deliveryEmailService } from './deliveryEmails';
import { EmailSendError, type EmailTransport, type OutgoingEmail } from './transport';
import { DELIVERY_CARD_CID, type DeliveryEmailContent, type DeliveryEmailInput } from './types';
import { unsubscribeAccount, unsubscribeToken } from './unsubscribe';

// The email itself is written elsewhere: these tests decide who is written to, and what is recorded.
const written = vi.hoisted(() => ({ content: vi.fn() }));
vi.mock('./content', () => ({ deliveryEmailContent: written.content }));
// Placing scans on the map has its own tests, and loads a gazetteer these do not need.
const places = vi.hoisted(() => ({ withEventPlaces: vi.fn() }));
vi.mock('../eventPlaces', () => ({ withEventPlaces: places.withEventPlaces }));

// Synthetic identifiers only: no account, parcel or mail server stands behind them.
const now = new Date('2026-10-03T12:20:00Z');
const alex = '56000000-0000-4000-a000-000000000001';
const settings: EmailSettings = {
  host: 'smtp.example.com', port: 587, secure: false, user: 'mailer', password: 'test-smtp-pass',
  from: 'Peek <hello@example.com>', replyTo: null, origin: 'https://peek.example.com',
  appleRelay: false, perAccountPerDay: 20, perDay: 80,
};
const card = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
const content: DeliveryEmailContent = {
  subject: 'Your Sneakers were delivered', text: 'Delivered today at 14:12.', html: '<p>Delivered today at 14:12.</p>', card,
};
const account: AuthAccount = { email: 'alex@example.com', emailConfirmed: true, locale: 'de' };

function claim(number: number, changes: Partial<DeliveryEmailClaim> = {}): DeliveryEmailClaim {
  return {
    id: `57000000-0000-4000-a000-00000000000${number}`,
    packageId: `58000000-0000-4000-a000-00000000000${number}`,
    userId: alex,
    eventId: `59000000-0000-4000-a000-00000000000${number}`,
    timezone: 'Europe/Zurich',
    deliveredTime: 'timed',
    ...changes,
  };
}

function parcel(packageId: string): JsonObject {
  return {
    id: packageId, tracking_number: 'TESTPARCEL123456', label: 'Sneakers', carrier: 'dhl', carrier_data: {},
    tracking_events: [{
      id: 'event-1', package_id: packageId, stage: 'delivered', description: 'Delivered', location: 'Example Town',
      occurred_at: '2026-10-03T12:12:00+00:00', point: null,
    }],
  };
}

let client: SupabaseServiceClient;
let transport: { send: MockInstance<EmailTransport['send']>; close: MockInstance<EmailTransport['close']> };
let open: MockInstance<(settings: EmailSettings) => EmailTransport>;
let service: DeliveryEmailService;
let claimed: MockInstance<SupabaseServiceClient['claimDeliveryEmails']>;
let finished: MockInstance<SupabaseServiceClient['finishDeliveryEmail']>;
let accounts: MockInstance<SupabaseServiceClient['getAuthAccount']>;
let parcels: MockInstance<SupabaseServiceClient['getOwnedPackage']>;
let counted: MockInstance<typeof metrics.recordDeliveryEmail>;
let reported: MockInstance<typeof observability.captureOperationalError>;
let logs: MockInstance[];

const claims = (send: DeliveryEmailClaim[], caps: { accountCap?: number; serviceCap?: number } = {}) => claimed
  .mockResolvedValue({ send, accountCap: caps.accountCap ?? 0, serviceCap: caps.serviceCap ?? 0 });
/** Everything written to the logs or reported as an error, as one text. */
const everythingRecorded = () => JSON.stringify([
  ...logs.flatMap((log) => log.mock.calls),
  ...reported.mock.calls.map(([error, context]) => [String(error), (error as Error).stack, Object.entries(error as object), context]),
]);
/** The log lines of one event, in the order they were written, whatever their level. */
const logged = (event: string): JsonObject[] => logs
  .flatMap((log) => log.mock.calls.map(([line], index) => ({ line: String(line), order: log.mock.invocationCallOrder[index]! })))
  .sort((first, second) => first.order - second.order)
  .map(({ line }) => JSON.parse(line) as JsonObject).filter((line) => line.event === event);

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  client = new SupabaseServiceClient('https://database.example', 'test-service-key');
  transport = { send: vi.fn<EmailTransport['send']>().mockResolvedValue(), close: vi.fn<EmailTransport['close']>() };
  open = vi.fn<(settings: EmailSettings) => EmailTransport>(() => transport as unknown as EmailTransport);
  service = new DeliveryEmailService(client, settings, open as unknown as (settings: EmailSettings) => EmailTransport, () => now);
  claimed = vi.spyOn(client, 'claimDeliveryEmails');
  claims([claim(1)]);
  finished = vi.spyOn(client, 'finishDeliveryEmail').mockResolvedValue(true);
  accounts = vi.spyOn(client, 'getAuthAccount').mockResolvedValue(account);
  parcels = vi.spyOn(client, 'getOwnedPackage').mockImplementation(async (packageId) => parcel(packageId));
  written.content.mockResolvedValue(content);
  places.withEventPlaces.mockImplementation((row: JsonObject) => ({ ...row, placed: true }));
  counted = vi.spyOn(metrics, 'recordDeliveryEmail');
  reported = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
  logs = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined),
  ];
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); written.content.mockReset(); places.withEventPlaces.mockReset(); });

describe('telling an account that its parcel was delivered', () => {
  it('claims, writes, sends and records one email', async () => {
    expect(await service.dispatch()).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(claimed).toHaveBeenCalledExactlyOnceWith(20, 20, 80);
    expect(accounts).toHaveBeenCalledExactlyOnceWith(alex);
    expect(parcels).toHaveBeenCalledExactlyOnceWith(claim(1).packageId, alex);

    const token = unsubscribeToken(alex);
    const input = written.content.mock.calls[0]![0] as DeliveryEmailInput;
    expect(input).toEqual({
      parcel: expect.objectContaining({ id: claim(1).packageId, label: 'Sneakers' }),
      locale: 'de',
      timezone: 'Europe/Zurich',
      journeyUrl: `https://peek.example.com/?parcel=${claim(1).packageId}`,
      offUrl: `https://peek.example.com/email/off#t=${token}`,
      deliveredTime: 'timed',
      now,
    });
    // The parcel as its owner's app gets it: the stored row, with every scan placed.
    expect(places.withEventPlaces).toHaveBeenCalledExactlyOnceWith(parcel(claim(1).packageId));
    expect(input.parcel).toEqual({ ...parcel(claim(1).packageId), placed: true });

    expect(open).toHaveBeenCalledExactlyOnceWith(settings);
    expect(transport.send).toHaveBeenCalledExactlyOnceWith({
      to: 'alex@example.com',
      subject: 'Your Sneakers were delivered',
      text: content.text,
      html: content.html,
      headers: {
        'List-Unsubscribe': `<https://peek.example.com/api/email/unsubscribe?t=${token}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
      },
      inline: [{ cid: DELIVERY_CARD_CID, filename: 'parcel.png', contentType: 'image/png', content: card }],
    });
    // The link an email carries is the account's own, and nobody else's.
    expect(unsubscribeAccount(token)).toBe(alex);
    expect(finished).toHaveBeenCalledExactlyOnceWith(claim(1).id, 'sent', null);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(counted).toHaveBeenCalledExactlyOnceWith('sent', 'none');
    expect(logged('delivery_email')).toEqual([expect.objectContaining({
      level: 'info', package_id: claim(1).packageId, outcome: 'sent', reason: 'none',
    })]);
    expect(reported).not.toHaveBeenCalled();
  });

  it.each(['timed', 'date', 'none'] as const)('tells the email what the delivered scan knows of its time: %s', async (deliveredTime) => {
    claims([claim(1, { deliveredTime, timezone: 'America/New_York' })]);
    await service.dispatch();
    expect(written.content).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ deliveredTime, timezone: 'America/New_York' }));
  });

  it.each([
    ['fr', 'fr'], ['pt-BR', 'pt'], ['DE_ch', 'de'], ['pl', 'pl'], ['nl', 'en'], ['', 'en'], [null, 'en'],
  ])('writes in the language the account last used: %s gives %s', async (stored, locale) => {
    accounts.mockResolvedValue({ ...account, locale: stored });
    await service.dispatch();
    expect(written.content).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ locale }));
  });

  it('opens no connection when there is nothing to send', async () => {
    claims([]);
    expect(await service.dispatch()).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(open).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
    expect(counted).not.toHaveBeenCalled();
  });

  it('sends several emails over one transport, and closes it once', async () => {
    claims([claim(1), claim(2), claim(3)]);
    expect(await service.dispatch()).toEqual({ sent: 3, failed: 0, skipped: 0 });
    expect(open).toHaveBeenCalledOnce();
    expect(transport.send).toHaveBeenCalledTimes(3);
    expect(transport.close).toHaveBeenCalledOnce();
    expect(finished.mock.calls).toEqual([1, 2, 3].map((number) => [claim(number).id, 'sent', null]));
  });
});

describe('an email that is not sent', () => {
  it.each([
    ['an account that is gone', null],
    ['an account without an address', { ...account, email: null }],
    ['an address that was never confirmed', { ...account, emailConfirmed: false }],
    ['an address that is not one address', { ...account, email: 'alex@example.com, other@example.com' }],
  ])('is skipped for %s', async (_case, stored) => {
    accounts.mockResolvedValue(stored);
    expect(await service.dispatch()).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(finished).toHaveBeenCalledExactlyOnceWith(claim(1).id, 'skipped', 'no_address');
    expect(parcels).not.toHaveBeenCalled();
    expect(written.content).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
    expect(counted).toHaveBeenCalledExactlyOnceWith('skipped', 'no_address');
    expect(reported).not.toHaveBeenCalled();
  });

  it('is skipped for an Apple relay address until the sender is registered with Apple', async () => {
    accounts.mockResolvedValue({ ...account, email: 'synthetic1234@privaterelay.appleid.com' });
    expect(await service.dispatch()).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(finished).toHaveBeenCalledExactlyOnceWith(claim(1).id, 'skipped', 'relay_address');
    expect(transport.send).not.toHaveBeenCalled();

    const registered = new DeliveryEmailService(client, { ...settings, appleRelay: true }, open as never, () => now);
    expect(await registered.dispatch()).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(transport.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: 'synthetic1234@privaterelay.appleid.com' }));
  });

  it('is skipped when the parcel left the account since it was claimed', async () => {
    parcels.mockResolvedValue(null);
    expect(await service.dispatch()).toEqual({ sent: 0, failed: 0, skipped: 1 });
    expect(finished).toHaveBeenCalledExactlyOnceWith(claim(1).id, 'skipped', 'parcel_gone');
    expect(written.content).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('counts what the claim itself skipped for an allowance', async () => {
    claims([claim(1)], { accountCap: 2, serviceCap: 1 });
    expect(await service.dispatch()).toEqual({ sent: 1, failed: 0, skipped: 3 });
    expect(counted.mock.calls).toEqual([['skipped', 'account_cap', 2], ['skipped', 'service_cap', 1], ['sent', 'none']]);
    expect(logged('delivery_emails_capped')).toEqual([
      expect.objectContaining({ level: 'warning', reason: 'account_cap', emails: 2 }),
      expect.objectContaining({ level: 'warning', reason: 'service_cap', emails: 1 }),
    ]);
    // With nothing left to send, the skipped ones are still counted.
    claims([], { serviceCap: 4 });
    expect(await service.dispatch()).toEqual({ sent: 0, failed: 0, skipped: 4 });
    expect(open).toHaveBeenCalledOnce();
  });
});

describe('an email that fails', () => {
  it('is handed back when the mail server does not take it, and the next one is still sent', async () => {
    claims([claim(1), claim(2), claim(3)]);
    const refused = new EmailSendError('EENVELOPE', 550);
    transport.send.mockRejectedValueOnce(refused).mockRejectedValueOnce(new EmailSendError('ETIMEDOUT', null)).mockResolvedValue();
    expect(await service.dispatch()).toEqual({ sent: 1, failed: 2, skipped: 0 });
    expect(finished.mock.calls).toEqual([
      [claim(1).id, 'failed', 'smtp'], [claim(2).id, 'failed', 'smtp'], [claim(3).id, 'sent', null],
    ]);
    expect(counted.mock.calls).toEqual([['failed', 'smtp'], ['failed', 'smtp'], ['sent', 'none']]);
    expect(logged('delivery_email').slice(0, 2)).toEqual([
      expect.objectContaining({ level: 'error', package_id: claim(1).packageId, outcome: 'failed', reason: 'smtp',
        error_type: 'EmailSendError', error_code: 'EENVELOPE', smtp_status: 550 }),
      expect.objectContaining({ level: 'error', package_id: claim(2).packageId, error_code: 'ETIMEDOUT', smtp_status: null }),
    ]);
    // An outage fails every email the same way: it is reported once.
    expect(reported).toHaveBeenCalledExactlyOnceWith(refused, { component: 'delivery-email', operation: 'smtp' });
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('is handed back when it cannot be written', async () => {
    claims([claim(1), claim(2)]);
    const broken = new Error('The card could not be drawn');
    written.content.mockRejectedValueOnce(broken).mockResolvedValue(content);
    expect(await service.dispatch()).toEqual({ sent: 1, failed: 1, skipped: 0 });
    expect(finished.mock.calls).toEqual([[claim(1).id, 'failed', 'content'], [claim(2).id, 'sent', null]]);
    expect(transport.send).toHaveBeenCalledOnce();
    expect(reported).toHaveBeenCalledExactlyOnceWith(broken, { component: 'delivery-email', operation: 'content' });
  });

  it('is handed back when the account or the parcel cannot be read', async () => {
    claims([claim(1), claim(2), claim(3)]);
    const authDown = new SupabaseError('Supabase GET request failed (503)', 503);
    const databaseDown = new SupabaseError('The delivery database is unreachable');
    accounts.mockRejectedValueOnce(authDown).mockResolvedValue(account);
    parcels.mockRejectedValueOnce(databaseDown).mockImplementation(async (packageId) => parcel(packageId));
    expect(await service.dispatch()).toEqual({ sent: 1, failed: 2, skipped: 0 });
    expect(finished.mock.calls).toEqual([
      [claim(1).id, 'failed', 'account'], [claim(2).id, 'failed', 'parcel'], [claim(3).id, 'sent', null],
    ]);
    expect(reported.mock.calls).toEqual([
      [authDown, { component: 'delivery-email', operation: 'account' }],
      [databaseDown, { component: 'delivery-email', operation: 'parcel' }],
    ]);
  });

  it('stays claimed, and is never sent again, when its ending cannot be recorded', async () => {
    claims([claim(1), claim(2)]);
    const lost = new SupabaseError('The delivery database is unreachable');
    finished.mockRejectedValueOnce(lost).mockResolvedValue(true);
    expect(await service.dispatch()).toEqual({ sent: 2, failed: 0, skipped: 0 });
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(finished).toHaveBeenCalledTimes(2);
    expect(logged('delivery_email_finish_failed')).toEqual([
      expect.objectContaining({ level: 'error', package_id: claim(1).packageId, outcome: 'sent', error_type: 'SupabaseError' }),
    ]);
    expect(reported).toHaveBeenCalledExactlyOnceWith(lost, { component: 'delivery-email', operation: 'finish' });
  });

  it('fails the run when nothing can be claimed, without opening a connection', async () => {
    claimed.mockRejectedValue(new SupabaseError('Supabase POST request failed (404)', 404, 'PGRST202'));
    await expect(service.dispatch()).rejects.toThrow('Supabase POST request failed (404)');
    expect(open).not.toHaveBeenCalled();
  });
});

describe('a run that is stopped', () => {
  it('claims nothing once it is stopped', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(service.dispatch(controller.signal)).rejects.toThrow();
    expect(claimed).not.toHaveBeenCalled();
  });

  it('hands back what it has not sent, and closes the connection', async () => {
    claims([claim(1), claim(2), claim(3)]);
    const controller = new AbortController();
    transport.send.mockImplementationOnce(async () => { controller.abort(); });
    await expect(service.dispatch(controller.signal)).rejects.toThrow();
    expect(transport.send).toHaveBeenCalledOnce();
    expect(finished.mock.calls).toEqual([
      [claim(1).id, 'sent', null], [claim(2).id, 'failed', 'interrupted'], [claim(3).id, 'failed', 'interrupted'],
    ]);
    expect(counted.mock.calls).toEqual([['sent', 'none'], ['failed', 'interrupted'], ['failed', 'interrupted']]);
    expect(transport.close).toHaveBeenCalledOnce();
    // Stopping is not a fault to report.
    expect(reported).not.toHaveBeenCalled();
  });
});

describe('what is recorded about an email', () => {
  it('names the parcel by its id and nothing of the person: no address, name, subject, number or link', async () => {
    claims([claim(1), claim(2), claim(3), claim(4), claim(5)], { accountCap: 1 });
    accounts.mockResolvedValueOnce(account).mockResolvedValueOnce({ ...account, emailConfirmed: false }).mockResolvedValue(account);
    transport.send.mockResolvedValueOnce().mockRejectedValueOnce(new EmailSendError('EAUTH', 535)).mockResolvedValue();
    written.content.mockResolvedValueOnce(content).mockResolvedValueOnce(content)
      .mockRejectedValueOnce(new Error('The card could not be drawn')).mockResolvedValue(content);
    finished.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new SupabaseError('The delivery database is unreachable'));
    expect(await service.dispatch()).toEqual({ sent: 2, failed: 2, skipped: 2 });

    const recorded = everythingRecorded();
    expect(logged('delivery_email')).toHaveLength(5);
    for (const personal of [
      'alex@example.com', 'example.com', 'Sneakers', 'Your Sneakers', 'Delivered today', 'TESTPARCEL123456', 'Example Town',
      unsubscribeToken(alex), alex, settings.password!, 'hello@',
    ]) {
      expect(recorded).not.toContain(personal);
    }
    // Every line is made of the parcel's id, how the email ended and why.
    for (const line of logged('delivery_email')) {
      expect(Object.keys(line).sort().filter((key) => !['error_type', 'error_code', 'smtp_status'].includes(key)))
        .toEqual(['event', 'level', 'outcome', 'package_id', 'reason', 'timestamp']);
    }
  });
});

describe('the email as it is sent', () => {
  it('gives mail apps one HTTPS address to unsubscribe at, and only over HTTPS', () => {
    const secure = deliveryEmail('alex@example.com', content, 'https://peek.example.com/api/email/unsubscribe?t=token');
    expect(secure.headers).toEqual({
      'List-Unsubscribe': '<https://peek.example.com/api/email/unsubscribe?t=token>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
    });
    expect(secure.headers!['List-Unsubscribe']).not.toMatch(/mailto:|,/);
    // A development origin over HTTP has no such address to give: the footer's link is the way out.
    const local = deliveryEmail('alex@example.com', content, 'http://localhost:3000/api/email/unsubscribe?t=token');
    expect(local.headers).toEqual({ 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' });
  });

  it('carries the card inside, or no picture at all, and a subject on one line', () => {
    const email: OutgoingEmail = deliveryEmail('alex@example.com', {
      ...content, subject: ' Your parcel\r\nBcc: other@example.com\twas  delivered ', card: null,
    }, 'https://peek.example.com/api/email/unsubscribe?t=token');
    expect(email.inline).toEqual([]);
    expect(email.subject).toBe('Your parcel Bcc: other@example.com was delivered');
    expect(deliveryEmail('alex@example.com', content, 'https://peek.example.com/x').inline).toEqual([
      { cid: DELIVERY_CARD_CID, filename: 'parcel.png', contentType: 'image/png', content: card },
    ]);
  });
});

describe('whether this deployment emails', () => {
  it('has no service without mail settings, and stops on a malformed set', () => {
    vi.stubEnv('SMTP_HOST', '');
    expect(deliveryEmailService(client)).toBeNull();
    vi.stubEnv('SMTP_HOST', 'smtp.example.com');
    vi.stubEnv('EMAIL_FROM', 'Peek <hello@example.com>');
    vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.com');
    const configured = deliveryEmailService(client);
    expect(configured).toBeInstanceOf(DeliveryEmailService);
    expect(configured!.settings).toMatchObject({ host: 'smtp.example.com', origin: 'https://peek.example.com', perDay: 80 });
    vi.stubEnv('EMAIL_FROM', '');
    expect(() => deliveryEmailService(client)).toThrow('SMTP_HOST needs EMAIL_FROM');
  });
});
