import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as exportAccount } from '../../app/api/account/export/route';
import { GET as openHeaderLink, POST as switchEmail } from '../../app/api/email/unsubscribe/route';
import { PATCH as changeParcelAlerts } from '../../app/api/packages/[id]/notifications/route';
import { GET as readPreferences, PATCH as savePreferences } from '../../app/api/push/preferences/route';
import contract from '../../contracts/openapi.json';
import { SupabaseAuthenticator, type SupabaseUser } from './auth';
import { unsubscribeToken } from './email/unsubscribe';
import * as observability from './observability';
import { SupabaseError, SupabaseServiceClient, SupabaseUserClient } from './supabase';

// Synthetic identifiers only.
const userId = '5a000000-0000-4000-a000-000000000001';
const packageId = '5a000000-0000-4000-a000-000000000002';
const stored = {
  enabled_stages: ['out_for_delivery', 'delivered'], quiet_hours_start: '22:00:00', quiet_hours_end: '07:00:00',
  timezone: 'Europe/Zurich', email_on_delivery: null as boolean | null,
};
const shown = { enabledStages: ['out_for_delivery', 'delivered'], quietHoursStart: '22:00', quietHoursEnd: '07:00', timezone: 'Europe/Zurich' };

let address = 0;
const nextIp = () => `198.51.100.${++address % 250 + 1}`;
const none = { params: Promise.resolve({}) };

function signedIn(user: Partial<SupabaseUser> = {}) {
  return vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({
    id: userId, email: 'alex@example.com', emailConfirmed: true, authenticatedAt: null, sessionId: null, ...user,
  });
}
function mailConfigured() {
  vi.stubEnv('SMTP_HOST', 'smtp.example.com');
  vi.stubEnv('EMAIL_FROM', 'Peek <hello@example.com>');
  vi.stubEnv('CANONICAL_ORIGIN', 'https://delivery.example');
}
function authenticated(url: string, method = 'GET', body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { Authorization: 'Bearer delivery-email-test', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
  vi.stubEnv('SMTP_HOST', '');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('the account\'s choice about the delivery email', () => {
  const preferences = 'https://delivery.example/api/push/preferences';
  const read = () => readPreferences(authenticated(preferences), none);
  const save = (body: unknown) => savePreferences(authenticated(preferences, 'PATCH', body), none);

  it('reads the choice with whether this server can email the account at all', async () => {
    signedIn();
    mailConfigured();
    const load = vi.spyOn(SupabaseUserClient.prototype, 'getNotificationPreferences').mockResolvedValue(stored);
    const never = await read();
    expect(never.status).toBe(200);
    const answer = await never.json();
    expect(answer).toEqual({ ...shown, emailOnDelivery: null, emailAvailable: true });
    // Exactly what the contract lists.
    expect(Object.keys(answer).sort()).toEqual(Object.keys(contract.components.schemas.NotificationPreferences.properties).sort());
    load.mockResolvedValue({ ...stored, email_on_delivery: true });
    expect(await (await read()).json()).toMatchObject({ emailOnDelivery: true, emailAvailable: true });
    load.mockResolvedValue({ ...stored, email_on_delivery: false });
    expect(await (await read()).json()).toMatchObject({ emailOnDelivery: false, emailAvailable: true });
  });

  it.each([
    ['the server has no mail settings', () => vi.stubEnv('SMTP_HOST', ''), {}],
    ['its mail settings do not load', () => vi.stubEnv('EMAIL_FROM', ''), {}],
    ['the account\'s address is not confirmed', () => undefined, { emailConfirmed: false }],
    ['the account has no address', () => undefined, { email: null }],
    ['the address is an Apple relay the sender is not registered for', () => undefined, { email: 'synthetic1234@privaterelay.appleid.com' }],
  ])('cannot email the account when %s, and refuses to switch the email on', async (_case, configure, user) => {
    signedIn(user);
    mailConfigured();
    configure();
    vi.spyOn(SupabaseUserClient.prototype, 'getNotificationPreferences').mockResolvedValue({ ...stored, email_on_delivery: true });
    // What is stored is still shown: the clients hide the switch.
    expect(await (await read()).json()).toEqual({ ...shown, emailOnDelivery: true, emailAvailable: false });

    const store = vi.spyOn(SupabaseUserClient.prototype, 'setNotificationPreferences').mockResolvedValue({ ...stored, email_on_delivery: false });
    const refused = await save({ ...shown, emailOnDelivery: true });
    expect(refused.status).toBe(409);
    expect(contract.paths['/api/push/preferences'].patch.responses).toHaveProperty('409');
    expect(await refused.json()).toEqual({ error: 'This server cannot email this account' });
    expect(store).not.toHaveBeenCalled();
    // Switching it off and saving the rest still work.
    const off = await save({ ...shown, emailOnDelivery: false });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ ...shown, emailOnDelivery: false, emailAvailable: false });
    expect(store).toHaveBeenCalledExactlyOnceWith(shown.enabledStages, '22:00', '07:00', 'Europe/Zurich', false);
  });

  it('registers an Apple relay address once the sender is registered with Apple', async () => {
    signedIn({ email: 'synthetic1234@privaterelay.appleid.com' });
    mailConfigured();
    vi.stubEnv('EMAIL_APPLE_RELAY', 'true');
    vi.spyOn(SupabaseUserClient.prototype, 'getNotificationPreferences').mockResolvedValue(stored);
    expect(await (await read()).json()).toMatchObject({ emailAvailable: true });
  });

  it('switches the email on and off, and takes the state from what was stored', async () => {
    signedIn();
    mailConfigured();
    const store = vi.spyOn(SupabaseUserClient.prototype, 'setNotificationPreferences')
      .mockResolvedValueOnce({ ...stored, email_on_delivery: true })
      .mockResolvedValueOnce({ ...stored, email_on_delivery: false });
    const on = await save({ ...shown, emailOnDelivery: true });
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ ...shown, emailOnDelivery: true, emailAvailable: true });
    expect(await (await save({ ...shown, emailOnDelivery: false })).json()).toMatchObject({ emailOnDelivery: false });
    expect(store.mock.calls).toEqual([
      [shown.enabledStages, '22:00', '07:00', 'Europe/Zurich', true],
      [shown.enabledStages, '22:00', '07:00', 'Europe/Zurich', false],
    ]);
  });

  it('keeps the stored choice when a request leaves it out, as released apps do, or sends null', async () => {
    signedIn();
    mailConfigured();
    const store = vi.spyOn(SupabaseUserClient.prototype, 'setNotificationPreferences').mockResolvedValue({ ...stored, email_on_delivery: true });
    for (const body of [shown, { ...shown, emailOnDelivery: null }, { ...shown, emailAvailable: false }]) {
      const response = await save(body);
      expect(response.status).toBe(200);
      // The answer says what is stored, and what the server knows, whatever the request claimed.
      expect(await response.json()).toEqual({ ...shown, emailOnDelivery: true, emailAvailable: true });
    }
    expect(store.mock.calls).toEqual(Array(3).fill([shown.enabledStages, '22:00', '07:00', 'Europe/Zurich', null]));
  });

  it('rejects a choice that is not a switch, before storing anything', async () => {
    signedIn();
    mailConfigured();
    const store = vi.spyOn(SupabaseUserClient.prototype, 'setNotificationPreferences');
    for (const emailOnDelivery of ['true', 1, {}, []]) {
      const response = await save({ ...shown, emailOnDelivery });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Email on delivery must be true or false' });
    }
    expect(store).not.toHaveBeenCalled();
  });
});

describe('one parcel\'s notifications and delivery email', () => {
  const parcel = { id: packageId, label: 'Sneakers', notifications_muted: false, email_muted: true, tracking_events: [] };
  const change = (body: unknown, id = packageId) => changeParcelAlerts(
    authenticated(`https://delivery.example/api/packages/${id}/notifications`, 'PATCH', body),
    { params: Promise.resolve({ id }) },
  );

  it('changes what the request names, and nothing else', async () => {
    signedIn();
    const update = vi.spyOn(SupabaseUserClient.prototype, 'updatePackage').mockResolvedValue();
    vi.spyOn(SupabaseUserClient.prototype, 'getPackage').mockResolvedValue(parcel);
    const response = await change({ emailMuted: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(parcel);
    expect(update.mock.calls).toEqual([[packageId, { email_muted: true }]]);

    update.mockClear();
    expect((await change({ muted: true })).status).toBe(200);
    expect(update.mock.calls).toEqual([[packageId, { notifications_muted: true }]]);

    update.mockClear();
    expect((await change({ muted: false, emailMuted: false })).status).toBe(200);
    expect(update.mock.calls).toEqual([[packageId, { notifications_muted: false }], [packageId, { email_muted: false }]]);
  });

  it.each([
    [{}, 'Muted or emailMuted must be true or false'],
    [{ label: 'Sneakers' }, 'Muted or emailMuted must be true or false'],
    [{ muted: 'yes' }, 'Muted must be true or false'],
    [{ muted: null }, 'Muted must be true or false'],
    [{ emailMuted: 1 }, 'Email muted must be true or false'],
    [{ muted: true, emailMuted: 'no' }, 'Email muted must be true or false'],
  ])('rejects %j before changing anything', async (body, error) => {
    signedIn();
    const update = vi.spyOn(SupabaseUserClient.prototype, 'updatePackage');
    const response = await change(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(update).not.toHaveBeenCalled();
  });

  it('answers another account\'s parcel like one that does not exist', async () => {
    signedIn();
    vi.spyOn(SupabaseUserClient.prototype, 'updatePackage').mockRejectedValue(new SupabaseError('Package not found', 404));
    const read = vi.spyOn(SupabaseUserClient.prototype, 'getPackage');
    const response = await change({ emailMuted: true });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Package not found' });
    expect(read).not.toHaveBeenCalled();
    expect((await change({ emailMuted: true }, 'not-a-uuid')).status).toBe(400);
  });
});

describe('switching the delivery email from an email', () => {
  const endpoint = 'https://delivery.example/api/email/unsubscribe';
  const token = () => unsubscribeToken(userId);
  const store = (answer: boolean | null = false) => vi.spyOn(SupabaseServiceClient.prototype, 'setDeliveryEmail').mockResolvedValue(answer);
  /** What the page an email links to sends. */
  const fromPage = (body: unknown, ip = nextIp()) => switchEmail(new NextRequest(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify(body),
  }), none);
  /** What a mail app sends when its reader presses "Unsubscribe": a form, no session, no origin, no custom header. */
  const oneClick = (given: string, options: { type?: string; body?: string; ip?: string } = {}) => {
    const request = new NextRequest(`${endpoint}?t=${given}`, {
      method: 'POST',
      headers: { 'content-type': options.type ?? 'application/x-www-form-urlencoded', 'x-real-ip': options.ip ?? nextIp() },
      body: options.body ?? 'List-Unsubscribe=One-Click',
    });
    return { request, answer: switchEmail(request, none) };
  };

  beforeEach(() => { mailConfigured(); });

  it('turns the email off for the account the token names, and back on with the same token', async () => {
    const switched = store(false);
    const off = await fromPage({ token: token() });
    expect(off.status).toBe(200);
    expect(off.headers.get('cache-control')).toBe('no-store');
    expect(await off.json()).toEqual({ emailOnDelivery: false });
    switched.mockResolvedValue(true);
    expect(await (await fromPage({ token: token(), enabled: true })).json()).toEqual({ emailOnDelivery: true });
    switched.mockResolvedValue(false);
    expect(await (await fromPage({ token: token(), enabled: false })).json()).toEqual({ emailOnDelivery: false });
    expect(switched.mock.calls).toEqual([[userId, false], [userId, true], [userId, false]]);
  });

  it.each([
    ['a form', 'application/x-www-form-urlencoded', 'List-Unsubscribe=One-Click'],
    ['a multipart form', 'multipart/form-data; boundary=synthetic', '--synthetic\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click\r\n--synthetic--\r\n'],
    ['JSON that asks to switch it on', 'application/json', JSON.stringify({ token: 'ignored', enabled: true })],
    ['something that is no body at all', 'text/plain', '\u0000\u0001 not a form'],
  ])('takes a mail app\'s one-click post with %s: off, a plain 200, and the body unread', async (_case, type, body) => {
    const switched = store(false);
    const { request, answer } = oneClick(token(), { type, body });
    const response = await answer;
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(await response.json()).toEqual({ emailOnDelivery: false });
    expect(switched).toHaveBeenCalledExactlyOnceWith(userId, false);
    expect(request.bodyUsed).toBe(false);
  });

  it('answers a token it did not make, and an account that is gone, alike', async () => {
    const switched = store(null);
    const [id, mac] = token().split('.') as [string, string];
    const answers = [
      await fromPage({ token: `${id}.${'A'.repeat(43)}` }),
      await fromPage({ token: `${id}${mac}` }),
      await fromPage({ token: 'short' }),
      await fromPage({ token: 42 }),
      await fromPage({}),
      await fromPage({ enabled: true }),
      await oneClick(`${id}.${'A'.repeat(43)}`).answer,
      await oneClick('').answer,
    ];
    expect(switched).not.toHaveBeenCalled();
    // The token is this server's, the account is not there any more.
    answers.push(await fromPage({ token: token() }), await oneClick(token()).answer);
    expect(switched).toHaveBeenCalledTimes(2);
    for (const response of answers) {
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'This link is not valid' });
    }
  });

  it('needs a JSON object when the token is not in the address', async () => {
    const switched = store();
    const form = await switchEmail(new NextRequest(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': nextIp() },
      body: `t=${token()}`,
    }), none);
    expect(form.status).toBe(400);
    const wrong = await fromPage({ token: token(), enabled: 'yes' });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'Enabled must be true or false' });
    expect((await switchEmail(new NextRequest(endpoint, { method: 'POST', headers: { 'x-real-ip': nextIp() } }), none)).status).toBe(400);
    expect(switched).not.toHaveBeenCalled();
  });

  it('says so when this server sends no email', async () => {
    vi.stubEnv('SMTP_HOST', '');
    const switched = store();
    for (const response of [await fromPage({ token: token() }), await oneClick(token()).answer]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'This server sends no email' });
    }
    expect(switched).not.toHaveBeenCalled();
  });

  it('only redirects someone who opens the header\'s address: nothing is switched', async () => {
    const switched = store();
    const request = vi.spyOn(SupabaseServiceClient.prototype, 'request');
    const open = (query: string) => openHeaderLink(new NextRequest(`${endpoint}${query}`, { headers: { 'x-real-ip': nextIp() } }), none);
    const followed = await open(`?t=${token()}`);
    expect(followed.status).toBe(303);
    expect(contract.paths['/api/email/unsubscribe'].get.responses).toHaveProperty('303');
    // The token moves behind #, where neither this server nor another is sent it.
    expect(followed.headers.get('location')).toBe(`/email/off#t=${token()}`);
    expect(followed.headers.get('cache-control')).toBe('no-store');
    expect(followed.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await followed.text()).toBe('');
    for (const query of ['', '?t=', '?t=short', `?t=${encodeURIComponent(`${token()}\r\nSet-Cookie: x=1`)}`, '?t=%3Cscript%3E']) {
      const response = await open(query);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/email/off');
    }
    // It works without mail settings too: the page explains.
    vi.stubEnv('SMTP_HOST', '');
    expect((await open(`?t=${token()}`)).status).toBe(303);
    expect(switched).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('allows thirty requests a minute per client, opening and posting together', async () => {
    store(false);
    const ip = '203.0.113.77';
    for (let index = 0; index < 29; index += 1) {
      expect((await oneClick(token(), { ip }).answer).status).toBe(200);
    }
    expect((await openHeaderLink(new NextRequest(`${endpoint}?t=${token()}`, { headers: { 'x-real-ip': ip } }), none)).status).toBe(303);
    const refused = await oneClick(token(), { ip }).answer;
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await refused.json()).toEqual({ error: 'Too many requests. Try again shortly.' });
    expect((await fromPage({ token: token() }, ip)).status).toBe(429);
    // Another client is not held back.
    expect((await oneClick(token(), { ip: '203.0.113.78' }).answer).status).toBe(200);
  });

  it('keeps the token and the account out of the logs and the error reports', async () => {
    const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    store(false);
    const answers = [await oneClick(token()).answer, await fromPage({ token: token() }), await fromPage({ token: 'not-a-token-at-all-0000' })];
    vi.spyOn(SupabaseServiceClient.prototype, 'setDeliveryEmail').mockRejectedValue(new SupabaseError('database down', 503));
    answers.push(await oneClick(token()).answer, await fromPage({ token: token() }));
    expect(answers.map((response) => response.status)).toEqual([200, 200, 400, 502, 502]);

    const lines = [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls].map(([line]) => String(line));
    expect(lines.filter((line) => line.includes('"route":"/api/email/unsubscribe"'))).toHaveLength(5);
    const [id, mac] = token().split('.') as [string, string];
    for (const text of [...lines, ...await Promise.all(answers.map((response) => response.text()))]) {
      for (const secret of [token(), id, mac, userId, 'not-a-token-at-all']) expect(text).not.toContain(secret);
    }
    // A failure is reported without the request, whose address carries the token.
    expect(report).toHaveBeenCalledTimes(2);
    for (const [, context] of report.mock.calls) {
      expect(context).toMatchObject({ route: '/api/email/unsubscribe', withoutRequest: true });
    }
  });

  it('asks for no sign-in, and reads no session', async () => {
    const validate = vi.spyOn(SupabaseAuthenticator.prototype, 'validate');
    store(false);
    const response = await switchEmail(new NextRequest(`${endpoint}?t=${token()}`, {
      method: 'POST', headers: { Authorization: 'Bearer someone-else', 'x-real-ip': nextIp() }, body: 'List-Unsubscribe=One-Click',
    }), none);
    expect(response.status).toBe(200);
    expect(validate).not.toHaveBeenCalled();
  });
});

describe('the account export', () => {
  it('holds the choice about the delivery email and the emails that were sent', async () => {
    signedIn();
    vi.spyOn(SupabaseUserClient.prototype, 'request').mockResolvedValue({ profile: null, ownCard: null, friends: [] });
    vi.spyOn(SupabaseUserClient.prototype, 'listPackages').mockResolvedValue([]);
    vi.spyOn(SupabaseUserClient.prototype, 'getNotificationPreferences').mockResolvedValue({ ...stored, email_on_delivery: true });
    const sent = [
      { packageId, sentAt: '2026-10-03T12:13:00+00:00' },
      { packageId: null, sentAt: '2026-09-30T09:00:00+00:00' },
    ];
    const emails = vi.spyOn(SupabaseUserClient.prototype, 'listDeliveryEmails').mockResolvedValue(sent);
    const opened = vi.spyOn(SupabaseServiceClient.prototype, 'accountLastOpened').mockResolvedValue('2026-10-03T21:05:00+00:00');
    const response = await exportAccount(authenticated('https://delivery.example/api/account/export'), none);
    expect(response.status).toBe(200);
    const exported = await response.json();
    expect(exported.deliveryEmails).toEqual({ enabled: true, sent });
    // When the account's apps last read its parcels is read for this account, and no other.
    expect(exported.account).toEqual({ id: userId, email: 'alex@example.com', lastOpenedAt: '2026-10-03T21:05:00+00:00' });
    expect(opened).toHaveBeenCalledExactlyOnceWith(userId);
    expect(Object.keys(contract.components.schemas.AccountExportResponse.properties.account.properties).sort())
      .toEqual(Object.keys(exported.account).sort());
    expect(emails).toHaveBeenCalledOnce();
    // Every part of the export is one the contract lists.
    const listed = Object.keys(contract.components.schemas.AccountExportResponse.properties);
    for (const key of Object.keys(exported)) expect(listed).toContain(key);
    expect(Object.keys(exported.deliveryEmails).sort()).toEqual([...contract.components.schemas.DeliveryEmailsExport.required].sort());
  });

  it('says that the account never chose, and was sent nothing', async () => {
    signedIn();
    vi.spyOn(SupabaseUserClient.prototype, 'request').mockResolvedValue({ profile: null, ownCard: null, friends: [] });
    vi.spyOn(SupabaseUserClient.prototype, 'listPackages').mockResolvedValue([]);
    vi.spyOn(SupabaseServiceClient.prototype, 'accountLastOpened').mockResolvedValue(null);
    const exported = await (await exportAccount(authenticated('https://delivery.example/api/account/export'), none)).json();
    expect(exported.deliveryEmails).toEqual({ enabled: null, sent: [] });
    expect(exported.account.lastOpenedAt).toBeNull();
  });
});
