import { afterEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../contracts/fixtures/delivery-api.json';
import { ApiAuthenticationError } from '../lib/apiClient';
import {
  claimParcelLinks,
  cleanLinkText,
  collapseGiftRows,
  createAccountShare,
  createApiLinks,
  isParcelLinkId,
  isWrappedGift,
  maskedNumber,
  numberEnds,
  ParcelLinkError,
  parcelLinkErrorKey,
  parcelLinkView,
  type ParcelLinkErrorKind,
} from './links';
import type { ApiPublicParcelResponse } from '../generated/apiContract';
import { testParcel, testView } from '../test/parcelLinks';
import type { TrackingEvent } from '../types';

const ID = 'k7Qm2xHd9RtW';
const KEY = 'A'.repeat(43);
const viewer = fixtures.publicParcel as ApiPublicParcelResponse;
const owner = fixtures.publicLookup;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function api(...answers: (Response | Error)[]) {
  const request = vi.fn<typeof fetch>(async () => {
    const next = answers.shift();
    if (!next) throw new Error('No answer left');
    if (!(next instanceof Response)) throw next;
    return next;
  });
  return { links: createApiLinks(request), request };
}

async function failure(operation: Promise<unknown>): Promise<ParcelLinkError> {
  const error = await operation.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(ParcelLinkError);
  return error as ParcelLinkError;
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('parcel link model', () => {
  it('maps a public answer onto the app’s parcel, keeping a masked number’s ends beside it', () => {
    const view = parcelLinkView(viewer);
    // An answer from before links could be gifts, stopped or alerted reads as a plain shared link without alerts.
    expect(view.link).toEqual({ ...viewer.link, gift: false, shared: true, alerts: { available: false, vapidPublicKey: null } });
    expect(view.parcel).toMatchObject({
      trackingNumber: '', label: '', carrier: 'dpd', syncStatus: 'ok', expectedDelivery: '2026-10-03',
      senderName: 'Example Shop', weightKg: 1.2, destinationCountry: 'CH',
    });
    expect(view.parcel.events).toEqual([expect.objectContaining({ stage: 'in_transit', description: 'In transit' })]);
    expect(view.numberHint).toEqual({ head: '', tail: '3456' });
    expect(maskedNumber(view.numberHint!)).toBe('••• 3456');

    const shown = parcelLinkView(owner as ApiPublicParcelResponse);
    expect(shown.parcel.trackingNumber).toBe('TESTPARCEL123456');
    expect(shown.numberHint).toBeNull();
  });

  it('carries whether the link is a gift, whether it is still shared, and how a browser subscribes to its alerts', () => {
    const answer = (link: object) => parcelLinkView({ ...viewer, link: { ...viewer.link, ...link } } as ApiPublicParcelResponse).link;
    expect(answer({ gift: true, shared: false, alerts: { available: true, vapidPublicKey: 'BPublicKey' } }))
      .toMatchObject({ gift: true, shared: false, alerts: { available: true, vapidPublicKey: 'BPublicKey' } });
    // Without the server's key no browser can subscribe, whatever the answer claims.
    expect(answer({ alerts: { available: true, vapidPublicKey: null } }).alerts).toEqual({ available: false, vapidPublicKey: null });
    expect(answer({ gift: 'yes', shared: null, alerts: 'on' })).toMatchObject({ gift: false, shared: true, alerts: { available: false } });
    // That the server emails accounts is carried only when it says so, with or without push.
    expect(answer({ alerts: { available: true, vapidPublicKey: 'BPublicKey', email: true } }).alerts).toEqual({ available: true, vapidPublicKey: 'BPublicKey', email: true });
    expect(answer({ alerts: { available: false, vapidPublicKey: null, email: true } }).alerts).toEqual({ available: false, vapidPublicKey: null, email: true });
    expect(answer({ alerts: { available: true, vapidPublicKey: 'BPublicKey', email: false } }).alerts).toEqual({ available: true, vapidPublicKey: 'BPublicKey' });
    expect(answer({ alerts: { available: true, vapidPublicKey: 'BPublicKey', email: 'yes' } }).alerts).not.toHaveProperty('email');
  });

  it('tells a gift still on its way to someone else from one its owner sees, and from one that arrived', () => {
    const gift = (owner: boolean, stages: Parameters<typeof testParcel>[1]) => {
      const view = testView({ owner, stages });
      return { ...view, link: { ...view.link, gift: true } };
    };
    expect(isWrappedGift(gift(false, ['accepted', 'in_transit']))).toBe(true);
    expect(isWrappedGift(gift(true, ['accepted', 'in_transit']))).toBe(false);
    expect(isWrappedGift(gift(false, ['in_transit', 'delivered']))).toBe(false);
    expect(isWrappedGift(testView({ owner: false }))).toBe(false);
  });

  it('tells a gift’s hidden beginning once: scans blurred alike that follow one another collapse into the newest', () => {
    const scan = (id: string, hour: number, description: string, location?: string): TrackingEvent =>
      ({ id, parcelId: 'p', stage: 'in_transit', description, location, occurredAt: `2026-10-01T${String(hour).padStart(2, '0')}:00:00.000Z` });
    const events = [
      scan('c', 12, 'Left the sender', 'DE'), scan('a', 9, 'Left the sender', 'DE'), scan('b', 10, 'Left the sender', 'DE'),
      scan('d', 14, 'Cleared customs', 'Basel, CH'), scan('e', 15, 'Left the sender', 'DE'), scan('f', 16, 'Left the sender'),
    ];
    // The run a–c keeps its newest; e and f differ in place, so both stay. The order the journal got is kept.
    expect(collapseGiftRows(events).map((event) => event.id)).toEqual(['c', 'd', 'e', 'f']);
    expect(collapseGiftRows([])).toEqual([]);
  });

  it('shows the same end of a masked number as the server, and cleans the words a link carries', () => {
    expect(maskedNumber(numberEnds('1234567890899'))).toBe('••• 899');
    expect(maskedNumber(numberEnds('TESTPARCEL123456'))).toBe('••• 3456');
    expect(numberEnds('1234567899')).toEqual({ head: '', tail: '99' });
    expect(numberEnds('12345')).toEqual({ head: '', tail: '5' });
    // An answer kept on the device from before the start was hidden still reads as it did.
    expect(maskedNumber({ head: '123', tail: '99' })).toBe('123 ••• 99');
    expect(cleanLinkText('  Happy\n birthday \u200b ', 280)).toBe('Happy birthday');
    expect(cleanLinkText('abcdef', 3)).toBe('abc');
    expect(cleanLinkText(' \n ', 10)).toBeNull();
  });

  it('refuses an answer it cannot read', () => {
    for (const broken of [null, {}, { link: viewer.link }, { link: { ...viewer.link, id: 'short' }, package: viewer.package },
      { link: viewer.link, package: { ...viewer.package, tracking_events: null } }]) {
      expect(() => parcelLinkView(broken as never)).toThrow(ParcelLinkError);
    }
  });

  it('knows the server’s id format', () => {
    expect(isParcelLinkId(ID)).toBe(true);
    for (const invalid of ['', 'k7Qm2xHd9RtW1', 'k7Qm2xHd9Rt', 'k7Qm2xHd9Rt0', 'k7Qm2xHd9RtI', 'k7Qm2xHd9Rtl', 'k7Qm2xHd9RtO', null, 12]) {
      expect(isParcelLinkId(invalid)).toBe(false);
    }
  });

  it('names the message of every failure', () => {
    const expected: Record<ParcelLinkErrorKind, string> = {
      unavailable: 'link.gone.title', burst: 'error.rateLimited', daily: 'peek.dailyLimit',
      validation: 'error.trackingNumber', offline: 'error.connection', server: 'error.generic',
      stopped: 'share.stopped.title', full: 'alerts.error.full', unconfigured: 'notifications.state.unavailable',
    };
    for (const [kind, key] of Object.entries(expected)) {
      expect(parcelLinkErrorKey(new ParcelLinkError(kind as ParcelLinkErrorKind))).toBe(key);
    }
    expect(parcelLinkErrorKey(new ParcelLinkError('validation', { guidance: 'error.postcode' }))).toBe('error.postcode');
    expect(parcelLinkErrorKey(new ApiAuthenticationError())).toBe('error.signIn');
    expect(parcelLinkErrorKey(new Error('anything'))).toBe('error.generic');
  });
});

describe('the API backend', () => {
  it('looks a parcel up without a cookie, a referrer, a name or anything it was not asked to send', async () => {
    const { links, request } = api(json(owner, 201));
    const lookup = await links.lookupParcel({
      trackingNumber: ' testparcel-123456 ', carrier: 'dpd', dpdPostcode: ' 8000 ', label: 'For Mum', name: 'For Mum',
    } as never);
    expect(lookup).toMatchObject({ id: ID, key: KEY, view: { link: { role: 'owner' }, parcel: { trackingNumber: 'TESTPARCEL123456' } } });
    const [path, init] = request.mock.calls[0];
    expect(path).toBe('/api/public/parcels');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    expect(JSON.parse(String(init!.body))).toEqual({ trackingNumber: 'TESTPARCEL123456', carrier: 'dpd', dpdPostcode: '8000' });
    expect(String(init!.body)).not.toContain('Mum');
    expect(new Headers(init!.headers).has('X-Parcel-Key')).toBe(false);
  });

  it('sends the carrier a number’s shape says when none was chosen', async () => {
    const { links, request } = api(json(owner, 201));
    await links.lookupParcel({ trackingNumber: '993411111122222222' });
    expect(JSON.parse(String(request.mock.calls[0][1]!.body))).toEqual({ trackingNumber: '993411111122222222', carrier: 'swiss-post' });
  });

  it('refuses a lookup answer without a usable key', async () => {
    const { links } = api(json({ ...owner, key: 'short' }, 201));
    expect((await failure(links.lookupParcel({ trackingNumber: 'TESTPARCEL123456' }))).kind).toBe('server');
  });

  it('reads with the owner key only when the device holds one', async () => {
    const { links, request } = api(json(owner), json(viewer), json(viewer));
    const owned = await links.readParcelLink(ID, { key: KEY });
    expect(owned).toMatchObject({ link: { role: 'owner' } });
    expect(request.mock.calls[0][0]).toBe(`/api/public/parcels/${ID}`);
    expect(request.mock.calls[0][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(new Headers(request.mock.calls[0][1]!.headers).get('X-Parcel-Key')).toBe(KEY);

    expect(await links.readParcelLink(ID)).toMatchObject({ link: { role: 'viewer' }, numberHint: { head: '', tail: '3456' } });
    expect(new Headers(request.mock.calls[1][1]!.headers).has('X-Parcel-Key')).toBe(false);
    await links.readParcelLink(ID, { key: 'not a key' });
    expect(new Headers(request.mock.calls[2][1]!.headers).has('X-Parcel-Key')).toBe(false);
  });

  it('reads a link that leads nowhere as unavailable, and a malformed id without asking', async () => {
    const { links, request } = api(json({ error: 'Parcel unavailable' }, 404));
    expect(await links.readParcelLink(ID)).toBe('unavailable');
    expect(await links.readParcelLink('../../packages')).toBe('unavailable');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reads a link whose sharing was stopped as unavailable, and as stopped for a page that asks to be told', async () => {
    const { links, request } = api(json({ error: 'Parcel not shared' }, 410), json({ error: 'Parcel not shared' }, 410));
    expect(await links.readParcelLink(ID)).toBe('unavailable');
    const stopped = await failure(links.readParcelLink(ID, { tellStopped: true }));
    expect(stopped.kind).toBe('stopped');
    expect(parcelLinkErrorKey(stopped)).toBe('share.stopped.title');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('changes what the link shows with the owner key, sending the switches and nothing else', async () => {
    const changed = { ...owner, link: { ...owner.link, gift: true, shared: true } };
    const { links, request } = api(json(changed), json({ error: 'Parcel unavailable' }, 404), json({ error: 'Invalid request' }, 400));
    const view = await links.updateParcelLink(ID, KEY, { showNumber: true, gift: true, name: 'For Mum', note: 'Happy birthday' } as never);
    expect(view.link).toMatchObject({ role: 'owner', gift: true, shared: true });
    const [path, init] = request.mock.calls[0];
    expect(path).toBe(`/api/public/parcels/${ID}`);
    expect(init).toMatchObject({ method: 'PATCH', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    expect(new Headers(init!.headers).get('X-Parcel-Key')).toBe(KEY);
    expect(JSON.parse(String(init!.body))).toEqual({ showNumber: true, gift: true });
    // A wrong key, a link from an account and an unknown link are one refusal.
    expect((await failure(links.updateParcelLink(ID, KEY, { shared: false }))).kind).toBe('unavailable');
    expect(JSON.parse(String(request.mock.calls[1][1]!.body))).toEqual({ shared: false });
    expect((await failure(links.updateParcelLink(ID, KEY, {}))).kind).toBe('validation');
    // Without a usable key or id nothing is asked.
    expect((await failure(links.updateParcelLink(ID, 'no key', { gift: true }))).kind).toBe('unavailable');
    expect((await failure(links.updateParcelLink('nope', KEY, { gift: true }))).kind).toBe('unavailable');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('turns a browser’s alerts on and off for a link, and types every refusal', async () => {
    const subscription = { endpoint: 'https://push.example.test/send/abc', keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } };
    const { links, request } = api(
      new Response(null, { status: 204 }),
      json({ error: 'This parcel has all the alerts it can take' }, 409),
      json({ error: 'Push notifications are not configured' }, 503),
      json({ error: 'Parcel not shared' }, 410),
      json({ error: 'Parcel unavailable' }, 404),
      json({ error: 'Invalid push subscription' }, 400),
      json({ error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': '9' }),
      new Response(null, { status: 204 }),
      json({ error: 'Invalid endpoint' }, 400),
    );
    await expect(links.setParcelAlert(ID, { subscription: { ...subscription, expirationTime: null } as never, preset: 'important', locale: 'de' }, KEY)).resolves.toBeUndefined();
    const [path, init] = request.mock.calls[0];
    expect(path).toBe(`/api/public/parcels/${ID}/alerts`);
    expect(init).toMatchObject({ method: 'PUT', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(new Headers(init!.headers).get('X-Parcel-Key')).toBe(KEY);
    expect(JSON.parse(String(init!.body))).toEqual({ subscription, preset: 'important', locale: 'de' });

    const alert = { subscription, preset: 'all' as const, locale: 'en' as const };
    const full = await failure(links.setParcelAlert(ID, alert));
    expect(full.kind).toBe('full');
    expect(parcelLinkErrorKey(full)).toBe('alerts.error.full');
    // A viewer sends no key.
    expect(new Headers(request.mock.calls[1][1]!.headers).has('X-Parcel-Key')).toBe(false);
    expect((await failure(links.setParcelAlert(ID, alert))).kind).toBe('unconfigured');
    expect((await failure(links.setParcelAlert(ID, alert))).kind).toBe('stopped');
    expect((await failure(links.setParcelAlert(ID, alert))).kind).toBe('unavailable');
    expect((await failure(links.setParcelAlert(ID, alert))).kind).toBe('validation');
    expect(await failure(links.setParcelAlert(ID, alert))).toMatchObject({ kind: 'burst', retryAfterSeconds: 9 });
    expect((await failure(links.setParcelAlert('nope', alert))).kind).toBe('unavailable');

    await expect(links.removeParcelAlert(ID, subscription.endpoint)).resolves.toBeUndefined();
    expect(request.mock.calls[7][0]).toBe(`/api/public/parcels/${ID}/alerts`);
    expect(request.mock.calls[7][1]).toMatchObject({ method: 'DELETE', credentials: 'omit' });
    expect(JSON.parse(String(request.mock.calls[7][1]!.body))).toEqual({ endpoint: subscription.endpoint });
    expect((await failure(links.removeParcelAlert(ID, 'nonsense'))).kind).toBe('validation');
    await expect(links.removeParcelAlert('nope', subscription.endpoint)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(9);
  });

  it('tells a burst limit, with its wait, from the daily limit', async () => {
    const { links } = api(
      json({ error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': '42' }),
      json({ error: 'No lookups are left for today. Sign in to keep going.', scope: 'daily' }, 429, { 'Retry-After': '3600' }),
      json({ error: 'Too many requests. Try again shortly.' }, 429),
    );
    const burst = await failure(links.lookupParcel({ trackingNumber: 'TESTPARCEL123456' }));
    expect(burst).toMatchObject({ kind: 'burst', retryAfterSeconds: 42 });
    const daily = await failure(links.lookupParcel({ trackingNumber: 'TESTPARCEL123456' }));
    expect(daily).toMatchObject({ kind: 'daily', retryAfterSeconds: 3600 });
    expect(parcelLinkErrorKey(daily)).toBe('peek.dailyLimit');
    expect(await failure(links.readParcelLink(ID))).toMatchObject({ kind: 'burst', retryAfterSeconds: 60 });
  });

  it.each([
    ['Enter a tracking number between 4 and 40 characters', 'error.trackingNumber'],
    ['Enter the delivery postcode for this DPD parcel', 'error.postcode'],
    ['Paste the complete tracking link from the carrier', 'error.trackingLink'],
    ['Amazon Logistics parcels can only be followed from an Amazon account', 'add.amazonAccount'],
    ['Choose a supported carrier', null],
  ] as const)('maps the refusal “%s” to the advice the app already has', async (message, guidance) => {
    const { links } = api(json({ error: message }, 400));
    const error = await failure(links.lookupParcel({ trackingNumber: 'TESTPARCEL123456' }));
    expect(error).toMatchObject({ kind: 'validation', guidance });
    expect(parcelLinkErrorKey(error)).toBe(guidance ?? 'error.trackingNumber');
  });

  it('reports no answer as offline and a broken service as server trouble, never the response', async () => {
    const { links } = api(
      new TypeError('Failed to fetch'),
      new DOMException('The operation timed out.', 'TimeoutError'),
      json({ error: 'Amazon Shipping could not be checked. Try again.' }, 503, { 'Retry-After': '5' }),
      json({ error: 'Delivery database failed' }, 502),
      new Response('<html>gateway</html>', { status: 200 }),
      new Response('not json', { status: 500 }),
    );
    expect((await failure(links.readParcelLink(ID))).kind).toBe('offline');
    expect((await failure(links.lookupParcel({ trackingNumber: 'TESTPARCEL123456' }))).kind).toBe('offline');
    expect(await failure(links.lookupParcel({ trackingNumber: 'TESTPARCEL123456' })))
      .toMatchObject({ kind: 'server', guidance: 'add.amazonCheckUnavailable', retryAfterSeconds: 5 });
    expect(await failure(links.lookupParcel({ trackingNumber: 'TESTPARCEL123456' }))).toMatchObject({ kind: 'server', guidance: null });
    expect((await failure(links.readParcelLink(ID))).kind).toBe('server');
    expect((await failure(links.readParcelLink(ID))).kind).toBe('server');
  });

  it('lets the caller’s own cancellation through', async () => {
    const controller = new AbortController();
    const request = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
      controller.abort();
      throw init!.signal!.reason;
    });
    const links = createApiLinks(request as typeof fetch);
    await expect(links.readParcelLink(ID, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('forgets with the key, and treats a refusal as an unavailable link', async () => {
    const { links, request } = api(new Response(null, { status: 204 }), json({ error: 'Parcel unavailable' }, 404));
    await expect(links.forgetParcelLink(ID, KEY)).resolves.toBeUndefined();
    expect(request.mock.calls[0][0]).toBe(`/api/public/parcels/${ID}`);
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'DELETE', credentials: 'omit' });
    expect(new Headers(request.mock.calls[0][1]!.headers).get('X-Parcel-Key')).toBe(KEY);
    expect((await failure(links.forgetParcelLink(ID, KEY))).kind).toBe('unavailable');
    expect((await failure(links.forgetParcelLink(ID, 'no key'))).kind).toBe('unavailable');
    expect((await failure(links.forgetParcelLink('nope', KEY))).kind).toBe('unavailable');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('asks which carrier a number belongs to, and distrusts an answer about another number', async () => {
    const { links, request } = api(
      json({ trackingNumber: '1234567899', carrier: 'dhl', asked: ['dhl'] }),
      json({ trackingNumber: 'OTHER', carrier: 'dhl' }),
      json({ trackingNumber: '1234567899', carrier: 'nobody' }),
      json({ trackingNumber: '1234567899', carrier: 'amazon-shipping', amazonShippingStatus: 'not-found' }),
      json({ error: 'Invalid tracking number' }, 400),
    );
    expect(await links.detectCarrierPublic('1234 5678 99')).toEqual({ trackingNumber: '1234567899', carrier: 'dhl', asked: ['dhl'] });
    expect(request.mock.calls[0][0]).toBe('/api/public/detect');
    expect(JSON.parse(String(request.mock.calls[0][1]!.body))).toEqual({ trackingNumber: '1234567899' });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await failure(links.detectCarrierPublic('1234567899'))).kind).toBe('server');
    }
    expect((await failure(links.detectCarrierPublic('1234567899'))).kind).toBe('validation');
  });
});

describe('keeping links in an account', () => {
  const auth = { userId: 'user-1', getAccessToken: async () => 'token' };

  it('claims with the signed-in bearer, sending the name only as the label', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ results: [{ id: ID, outcome: 'kept', packageId: 'p1' }, { id: 'k7Qm2xHd9RtX', outcome: 'unavailable' }] }));
    vi.stubGlobal('fetch', fetch);
    const results = await claimParcelLinks([{ id: ID, key: KEY, label: '  For Mum ' }, { id: 'k7Qm2xHd9RtX', key: null, label: null }], auth);
    expect(results).toEqual([{ id: ID, outcome: 'kept', packageId: 'p1' }, { id: 'k7Qm2xHd9RtX', outcome: 'unavailable' }]);
    const [path, init] = fetch.mock.calls[0];
    expect(path).toBe('/api/packages/claim');
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer token');
    expect(JSON.parse(String(init!.body))).toEqual({ links: [{ id: ID, key: KEY, label: 'For Mum' }, { id: 'k7Qm2xHd9RtX' }] });
  });

  it('sends and decodes protected gift words on the owner update', async () => {
    const giftWords = { name: 'Trail shoes', note: 'Enjoy!', from: 'Sam' };
    const { links, request } = api(json({ ...owner, link: { ...owner.link, giftWords } }));
    expect((await links.updateParcelLink(ID, KEY, { giftWords })).link.giftWords).toEqual(giftWords);
    expect(JSON.parse(String(request.mock.calls[0][1]!.body))).toEqual({ giftWords });
    expect(request.mock.calls[0][0]).not.toContain('Enjoy');
  });

  it('types every way a claim can fail', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ error: 'Parcel names can be at most 80 characters' }, 400))
      .mockResolvedValueOnce(json({ error: 'Too many requests. Try again shortly.' }, 429, { 'Retry-After': '7' }))
      .mockResolvedValueOnce(json({ results: 'nope' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(json({ error: 'Authentication is required' }, 401)));
    expect(await failure(claimParcelLinks([{ id: ID }], auth))).toMatchObject({ kind: 'validation', guidance: 'error.nameTooLong' });
    expect(await failure(claimParcelLinks([{ id: ID }], auth))).toMatchObject({ kind: 'burst', retryAfterSeconds: 7 });
    expect((await failure(claimParcelLinks([{ id: ID }], auth))).kind).toBe('server');
    expect((await failure(claimParcelLinks([{ id: ID }], auth))).kind).toBe('offline');
    await expect(claimParcelLinks([{ id: ID }], auth)).rejects.toBeInstanceOf(ApiAuthenticationError);
  });
});

describe('sharing a parcel of an account', () => {
  const auth = { userId: 'user-1', getAccessToken: async () => 'token' };
  const parcel = testParcel({ id: 'package/1', label: 'New sneakers' });
  const share = { id: ID, showNumber: true, gift: false, createdAt: '2026-10-02T08:00:00.000Z' };

  it('sends gift words in the authenticated body and keeps them when decoding the shared link', async () => {
    const giftWords = { name: 'Trail shoes', note: 'Enjoy!', from: 'Sam' };
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => json({ link: { ...share, gift: true, giftWords } }));
    vi.stubGlobal('fetch', fetch);
    const client = createAccountShare(auth);
    expect((await client.share(parcel, { gift: true, giftWords })).giftWords).toEqual(giftWords);
    expect(JSON.parse(String(fetch.mock.calls[0][1]!.body))).toEqual({ gift: true, giftWords });
    expect((await client.current(parcel.id))?.giftWords).toEqual(giftWords);
  });

  it('reads, makes or changes, and stops the link with the signed-in bearer, never sending the name', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ link: null }))
      .mockResolvedValueOnce(json({ link: share }))
      .mockResolvedValueOnce(json({ link: { ...share, gift: true, extra: 'ignored' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const client = createAccountShare(auth);
    expect(await client.current(parcel.id)).toBeNull();
    expect(await client.share(parcel)).toEqual(share);
    expect(await client.share(parcel, { showNumber: true, gift: true, shared: false, name: 'New sneakers' } as never)).toEqual({ ...share, gift: true });
    await expect(client.stop(parcel.id)).resolves.toBeUndefined();

    expect(fetch.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET']))
      .toEqual(Array.from(['GET', 'PUT', 'PUT', 'DELETE'], (method) => ['/api/packages/package%2F1/share', method]));
    expect(new Headers(fetch.mock.calls[1][1]!.headers).get('Authorization')).toBe('Bearer token');
    expect(JSON.parse(String(fetch.mock.calls[1][1]!.body))).toEqual({});
    expect(JSON.parse(String(fetch.mock.calls[2][1]!.body))).toEqual({ showNumber: true, gift: true });
    expect(fetch.mock.calls.every(([, init]) => !String(init?.body ?? '').includes('sneakers'))).toBe(true);
  });

  it('types every way sharing can fail', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json({ error: 'Package not found' }, 404))
      .mockResolvedValueOnce(json({ link: { id: 'short' } }))
      .mockResolvedValueOnce(json({ link: null }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ error: 'Delivery database failed' }, 502))
      .mockResolvedValue(json({ error: 'Authentication is required' }, 401)));
    const client = createAccountShare(auth);
    expect((await failure(client.current(parcel.id))).kind).toBe('unavailable');
    expect((await failure(client.current(parcel.id))).kind).toBe('server');
    expect((await failure(client.share(parcel))).kind).toBe('server');
    expect((await failure(client.share(parcel))).kind).toBe('offline');
    expect((await failure(client.stop(parcel.id))).kind).toBe('server');
    await expect(client.current(parcel.id)).rejects.toBeInstanceOf(ApiAuthenticationError);
  });
});

describe('choosing the backend', () => {
  it('uses the API in a build that has one and this browser’s demo in a build that has none', async () => {
    expect((await import('./links')).parcelLinksMode).toBe('api');
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_USE_API', 'false');
    const demo = await import('./links');
    expect(demo.parcelLinksMode).toBe('demo');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { id, key } = await demo.lookupParcel({ trackingNumber: '1234567899' });
    expect(await demo.readParcelLink(id, { key })).toMatchObject({ link: { id, role: 'owner' } });
    expect((await demo.detectCarrierPublic('1234567899')).trackingNumber).toBe('1234567899');
    expect((await demo.updateParcelLink(id, key, { gift: true })).link.gift).toBe(true);
    await demo.setParcelAlert(id, { subscription: { endpoint: 'demo:1', keys: { p256dh: 'demo', auth: 'demo' } }, preset: 'all', locale: 'en' }, key);
    await demo.removeParcelAlert(id, 'demo:1');
    await demo.forgetParcelLink(id, key);
    expect(await demo.readParcelLink(id, { key })).toBe('unavailable');
    // The demo's deliveries share through the same browser-only links; a build with an API has no such stand-in.
    expect(demo.demoAccountShare).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_USE_API', 'true');
    expect((await import('./links')).demoAccountShare).toBeNull();
  });
});
