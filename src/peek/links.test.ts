import { afterEach, describe, expect, it, vi } from 'vitest';
import fixtures from '../../contracts/fixtures/delivery-api.json';
import { ApiAuthenticationError } from '../lib/apiClient';
import {
  claimParcelLinks,
  createApiLinks,
  isParcelLinkId,
  maskedNumber,
  ParcelLinkError,
  parcelLinkErrorKey,
  parcelLinkView,
  type ParcelLinkErrorKind,
} from './links';
import type { ApiPublicParcelResponse } from '../generated/apiContract';

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
    expect(view.link).toEqual(viewer.link);
    expect(view.parcel).toMatchObject({
      trackingNumber: '', label: '', carrier: 'dpd', syncStatus: 'ok', expectedDelivery: '2026-10-03',
      senderName: 'Example Shop', weightKg: 1.2, destinationCountry: 'CH',
    });
    expect(view.parcel.events).toEqual([expect.objectContaining({ stage: 'in_transit', description: 'In transit' })]);
    expect(view.numberHint).toEqual({ head: 'TEST', tail: '456' });
    expect(maskedNumber(view.numberHint!)).toBe('TEST ••• 456');

    const shown = parcelLinkView(owner as ApiPublicParcelResponse);
    expect(shown.parcel.trackingNumber).toBe('TESTPARCEL123456');
    expect(shown.numberHint).toBeNull();
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

    expect(await links.readParcelLink(ID)).toMatchObject({ link: { role: 'viewer' }, numberHint: { head: 'TEST', tail: '456' } });
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
    await demo.forgetParcelLink(id, key);
    expect(await demo.readParcelLink(id, { key })).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
});
