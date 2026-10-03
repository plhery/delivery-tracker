import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryEmailLinkError, deliveryEmailToken, switchDeliveryEmail } from './deliveryEmail';

const mocks = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('./analytics', async (original) => ({ ...await original<typeof import('./analytics')>(), trackAction: mocks.track }));

// A made-up token of the shape the server issues.
const TOKEN = 'synthetic.token-for_tests.0123456789'; // gitleaks:allow -- made-up token, never issued by a server
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => mocks.track.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe('the token of an opt-out link', () => {
  it('is read from the address’s #t=', () => {
    expect(deliveryEmailToken(`#t=${TOKEN}`)).toBe(TOKEN);
    // Whatever a mail client adds beside it does not hide it.
    expect(deliveryEmailToken(`#utm=mail&t=${TOKEN}`)).toBe(TOKEN);
  });

  it.each([
    ['nothing after the #', ''],
    ['an empty #', '#'],
    ['another parameter', `#token=${TOKEN}`],
    ['a token cut short', '#t=tooshort'],
    ['a token that goes on too long', `#t=${'a'.repeat(201)}`],
    ['characters a token never has', `#t=${TOKEN}<script>`],
    ['a space', `#t=${TOKEN.slice(0, 12)}%20${TOKEN.slice(12)}`],
  ])('is none for %s', (_what, hash) => {
    expect(deliveryEmailToken(hash)).toBeNull();
  });
});

describe('switching the delivery email from a link', () => {
  it('posts the token in the body, with no sign-in, cookie or referrer, and answers what the server kept', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ emailOnDelivery: false }));
    vi.stubGlobal('fetch', fetch);
    await expect(switchDeliveryEmail(TOKEN, false)).resolves.toBe(false);
    const [path, init] = fetch.mock.calls[0];
    // The address never carries the token.
    expect(path).toBe('/api/email/unsubscribe');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ token: TOKEN }), credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.has('Authorization')).toBe(false);
    // Counted like any other operation: a fixed name and an outcome, nothing of the request.
    expect(mocks.track.mock.calls).toEqual([['email-off-link', 'success']]);
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain(TOKEN);
  });

  it('turns it back on with the same token', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ emailOnDelivery: true }));
    vi.stubGlobal('fetch', fetch);
    await expect(switchDeliveryEmail(TOKEN, true)).resolves.toBe(true);
    expect(fetch.mock.calls[0][1]?.body).toBe(JSON.stringify({ token: TOKEN, enabled: true }));
  });

  it('tells a token the server does not take from every other failure', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ error: 'This link does not work' }, 400))
      .mockResolvedValueOnce(json({ error: 'Email is not configured' }, 503))
      .mockResolvedValueOnce(json({ error: 'Too many requests' }, 429))
      .mockResolvedValueOnce(json({ ok: true }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch')));
    await expect(switchDeliveryEmail(TOKEN, false)).rejects.toBeInstanceOf(DeliveryEmailLinkError);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const failure = await switchDeliveryEmail(TOKEN, false).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(DeliveryEmailLinkError);
    }
    // An answer without the state is no success to show, though the request itself went through.
    expect(mocks.track.mock.calls.map(([, outcome]) => outcome)).toEqual(['error', 'error', 'error', 'success', 'error']);
  });
});
