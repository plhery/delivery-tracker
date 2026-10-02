import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as lookUp } from '../../app/api/public/parcels/route';
import { DELETE as forget, GET as read } from '../../app/api/public/parcels/[linkId]/route';
import { AMAZON_ACCOUNT_MESSAGE } from '../lib/amazon';
import { SupabaseAuthenticator } from './auth';
import * as background from './background';
import * as metrics from './metrics';
import * as observability from './observability';
import { SupabaseError, SupabaseServiceClient } from './supabase';
import type { JsonObject } from './types';

// Synthetic identifiers only: no carrier issued any of these.
const linkId = 'k7Qm2xHd9RtW';
const ownerKey = 'A'.repeat(43);
const keyHash = createHash('sha256').update(ownerKey).digest('hex');
const packageId = '51000000-0000-4000-a000-000000000001';
const trackingNumber = 'TESTPARCEL123456';
const postcode = '9999';

/** A package row as the database returns it to the server, with everything a link must not show. */
function storedPackage(overrides: JsonObject = {}): JsonObject {
  return {
    id: packageId,
    user_id: null,
    one_off: true,
    tracking_number: trackingNumber,
    label: 'A name that stays on the device',
    carrier: 'planzer',
    created_at: '2026-09-20T08:00:00+00:00',
    current_stage: 'in_transit',
    expected_delivery: '2026-10-03',
    expected_delivery_changed_at: null,
    last_status_text: 'In transit',
    last_synced_at: '2026-10-02T09:00:00+00:00',
    sync_status: 'ok',
    sync_error: null,
    tracking_url: 'https://trackandtrace.planzergroup.com/shared/sendungen/SECRET-CAPABILITY',
    dpd_postcode: postcode,
    archived_at: null,
    notifications_muted: true,
    tracking_generation: '51000000-0000-4000-a000-000000000009',
    carrier_data: {
      sender_name: 'Example Shop',
      weight_kg: 1.2,
      dimensions_text: '30 × 20 × 10 cm',
      pickup_point: 'Example Kiosk\nExample Street 1',
      destination_country: 'CH',
      expected_delivery_from: '2026-10-03T08:00:00+02:00',
      tracking_provider: 'ParcelsApp',
      carrier_answered: true,
      swiss_post_ready: true,
      active_tracking_carrier: 'swiss-post',
      active_tracking_number: 'TESTDELIVERYLEG01',
      original_carrier: 'planzer',
      original_tracking_number: 'TESTORIGINLEG0001',
      auto_changed_from: 'unknown',
      auto_changed_to: 'planzer',
      auto_changed_at: '2026-09-28T09:00:00.000Z',
      original_tracking_url: 'https://trackandtrace.planzergroup.com/shared/sendungen/SECRET-ORIGINAL',
      original_package_id: '51000000-0000-4000-a000-000000000007',
      receiver_name: 'Private Recipient',
      dpd_postcode_verified: false,
      pickup_code: 'PIN-4711',
      routing: {
        confirmed_postcode: postcode,
        confirmed_tracking_url: 'https://trackandtrace.planzergroup.com/shared/sendungen/SECRET-ROUTE',
        input_needed: { carrier: 'gls-ch', field: 'dpdPostcode' },
        candidate_probes: { 'gls-ch': { at: '2026-10-01T08:00:00Z' } },
      },
      delivery_probe: { carrier: 'swiss-post', number: 'TESTPROBE00000001' },
      upu_history: [{ description: 'Private archive' }],
    },
    tracking_events: [{
      id: '51000000-0000-4000-a000-000000000002',
      package_id: packageId,
      stage: 'in_transit',
      description: 'Sorted at the parcel center',
      location: 'Zürich',
      occurred_at: '2026-10-01T10:00:00+00:00',
      point: { latitude: 47.38, longitude: 8.5 },
      provider_event_id: 'planzer:private-identity',
    }],
    ...overrides,
  };
}

function storedLink(overrides: JsonObject = {}): JsonObject {
  return {
    id: linkId,
    owner: false,
    shared: false,
    show_number: false,
    created_at: '2026-09-28T08:00:00+00:00',
    forget_at: '2026-12-30T10:00:00+00:00',
    ...overrides,
  };
}

let address = 0;
const nextIp = () => `192.0.2.${++address}`;
const route = (id: string) => ({ params: Promise.resolve({ linkId: id }) });

function lookup(body: unknown, ip = nextIp()) {
  return lookUp(new NextRequest('https://delivery.example/api/public/parcels', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify(body),
  }), { params: Promise.resolve({}) });
}
function open(id = linkId, key?: string, ip = nextIp()) {
  return read(new NextRequest(`https://delivery.example/api/public/parcels/${id}`, {
    headers: { 'x-real-ip': ip, ...(key === undefined ? {} : { 'x-parcel-key': key }) },
  }), route(id));
}
function remove(id = linkId, key?: string, ip = nextIp()) {
  return forget(new NextRequest(`https://delivery.example/api/public/parcels/${id}`, {
    method: 'DELETE', headers: { 'x-real-ip': ip, ...(key === undefined ? {} : { 'x-parcel-key': key }) },
  }), route(id));
}

/** Nothing private, in any spelling, anywhere in an answer. */
function expectNothingPrivate(text: string) {
  for (const secret of ['SECRET', postcode, 'Private', 'PIN-4711', 'TESTPROBE', 'routing', 'candidate_probes',
    'receiver_name', 'original_package_id', 'tracking_generation', 'provider_event_id', 'private-identity',
    'A name that stays', 'user_id', 'one_off', '"point"', keyHash, ownerKey]) {
    expect(text).not.toContain(secret);
  }
}

let wake: ReturnType<typeof vi.spyOn>;
let enqueue: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  wake = vi.spyOn(background, 'wakeSyncWorker').mockImplementation(() => undefined);
  enqueue = vi.spyOn(SupabaseServiceClient.prototype, 'enqueueSyncJob').mockResolvedValue({ row: { id: 'job' }, queued: true });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('looking up a parcel without an account', () => {
  const allow = () => vi.spyOn(SupabaseServiceClient.prototype, 'claimPublicLookup').mockResolvedValue({ allowed: true, scope: null });
  const store = (created = true) => vi.spyOn(SupabaseServiceClient.prototype, 'createOneOffParcel').mockResolvedValue({
    link: storedLink({ owner: true }), package: storedPackage({ last_synced_at: null, sync_status: 'pending' }), created,
  });

  it('stores the number, returns the owner key once and queues the first check without an owner', async () => {
    const authenticate = vi.spyOn(SupabaseAuthenticator.prototype, 'validate');
    const claim = allow();
    const create = store();
    const counted = vi.spyOn(metrics, 'recordPublicLookup');
    const response = await lookup({ trackingNumber: 'test parcel-123456', carrier: 'dpd', dpdPostcode: postcode, label: 'Surprise for Ada' }, '198.51.100.7');
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    const answer = JSON.parse(text);
    expect(answer.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(answer.link).toEqual({
      id: linkId, role: 'owner', kind: 'lookup', createdAt: '2026-09-28T08:00:00.000Z',
      forgetAt: '2026-12-30T10:00:00.000Z', numberShown: true, canKeep: true,
    });
    expect(answer.package).toMatchObject({ id: packageId, tracking_number: trackingNumber, number_hint: null, label: '' });

    // The database gets the key's hash, never the key, and never the name.
    const hash = createHash('sha256').update(answer.key).digest('hex');
    expect(create).toHaveBeenCalledExactlyOnceWith(
      { trackingNumber, label: '', carrier: 'dpd', trackingUrl: null, dpdPostcode: postcode }, hash,
    );
    expect(text).not.toContain(hash);
    expect(text).not.toContain('Surprise');
    // The daily counter is keyed by a hash of the address, with the default allowances.
    expect(claim).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^[0-9a-f]{64}$/), 15, 3_000);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith({ packageId });
    expect(wake).toHaveBeenCalledOnce();
    expect(counted).toHaveBeenCalledExactlyOnceWith('created');
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('answers a stored parcel the same way and counts it as reused', async () => {
    allow();
    store(false);
    const counted = vi.spyOn(metrics, 'recordPublicLookup');
    expect((await lookup({ trackingNumber })).status).toBe(201);
    expect(counted).toHaveBeenCalledExactlyOnceWith('reused');
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('still answers when the first check cannot be queued', async () => {
    allow();
    store();
    enqueue.mockRejectedValue(new SupabaseError('queue unavailable', 503));
    expect((await lookup({ trackingNumber })).status).toBe(201);
    expect(wake).not.toHaveBeenCalled();
  });

  it.each([
    [{ trackingNumber: '!!' }, 'Enter a tracking number between 4 and 40 characters'],
    [{ trackingNumber: 'ABCDEFGH' }, 'Tracking numbers must use letters and numbers and include a digit'],
    [{ trackingNumber, carrier: 'not-a-carrier' }, 'Choose a supported carrier'],
    [{ trackingNumber, carrier: 'gls-ch' }, expect.stringContaining('postcode')],
    [{ trackingNumber: 'TBA000000000001', carrier: 'amazon-logistics' }, AMAZON_ACCOUNT_MESSAGE],
  ])('rejects %j like the signed-in route, before counting a lookup', async (body, error) => {
    const claim = allow();
    const create = store();
    const response = await lookup(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(claim).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([['bucket', 'limited_daily'], ['global', 'limited_global']] as const)(
    'refuses once the daily %s allowance is used up, until the next UTC midnight', async (scope, outcome) => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-02T21:30:00Z') });
      vi.spyOn(SupabaseServiceClient.prototype, 'claimPublicLookup').mockResolvedValue({ allowed: false, scope });
      const create = store();
      const counted = vi.spyOn(metrics, 'recordPublicLookup');
      const response = await lookup({ trackingNumber });
      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe(String(2.5 * 3_600));
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: expect.any(String), scope: 'daily' });
      expect(create).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
      expect(counted).toHaveBeenCalledExactlyOnceWith(outcome);
    },
  );

  it('takes the daily allowances from the environment', async () => {
    vi.stubEnv('PUBLIC_LOOKUPS_PER_DAY', '3');
    vi.stubEnv('PUBLIC_LOOKUPS_GLOBAL_PER_DAY', '0');
    const claim = allow();
    store();
    await lookup({ trackingNumber });
    expect(claim).toHaveBeenCalledExactlyOnceWith(expect.any(String), 3, 0);
  });

  it('allows a burst of six lookups a minute per client, and counts an IPv6 line as one client', async () => {
    const claim = allow();
    store();
    const counted = vi.spyOn(metrics, 'recordPublicLookup');
    for (let index = 0; index < 6; index += 1) {
      expect((await lookup({ trackingNumber }, `2001:db8:0:1::${index + 1}`)).status).toBe(201);
    }
    const refused = await lookup({ trackingNumber }, '2001:db8:0:1:ffff::9');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    // A burst refusal has no scope: the client shows a countdown.
    expect(await refused.json()).toEqual({ error: 'Too many requests. Try again shortly.' });
    expect(claim).toHaveBeenCalledTimes(6);
    expect(counted).toHaveBeenLastCalledWith('limited_burst');
    // Every address of the line fed the same daily counter; another line has its own.
    expect(new Set(claim.mock.calls.map(([bucket]) => bucket)).size).toBe(1);
    expect((await lookup({ trackingNumber }, '2001:db8:0:2::1')).status).toBe(201);
    expect(claim.mock.calls.at(-1)![0]).not.toBe(claim.mock.calls[0]![0]);
  });

  it('counts every client together when the proxy headers are not trusted', async () => {
    vi.stubEnv('TRUST_PROXY_HEADERS', 'false');
    const claim = allow();
    store();
    await lookup({ trackingNumber }, '203.0.113.1');
    await lookup({ trackingNumber }, '203.0.113.2');
    expect(claim.mock.calls[0]![0]).toBe(claim.mock.calls[1]![0]);
  });
});

describe('reading a parcel link', () => {
  const find = (link: JsonObject = {}, parcel: JsonObject = {}) => vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel')
    .mockResolvedValue({ link: storedLink(link), package: storedPackage(parcel) });

  it('shows the owner the whole number and only the carrier details a link may show', async () => {
    const found = find({ owner: true });
    const response = await open(linkId, ownerKey);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(found).toHaveBeenCalledExactlyOnceWith(linkId, keyHash, true);
    const text = await response.text();
    expectNothingPrivate(text);
    const answer = JSON.parse(text);
    expect(answer).not.toHaveProperty('key');
    expect(answer.link).toMatchObject({ role: 'owner', kind: 'lookup', numberShown: true, canKeep: true });
    expect(answer.package).toEqual({
      id: packageId,
      tracking_number: trackingNumber,
      number_hint: null,
      label: '',
      carrier: 'planzer',
      // The link is younger than the stored parcel: its own start is shown.
      created_at: '2026-09-28T08:00:00+00:00',
      expected_delivery: '2026-10-03',
      last_status_text: 'In transit',
      last_synced_at: '2026-10-02T09:00:00+00:00',
      sync_status: 'ok',
      sync_error: null,
      tracking_url: null,
      dpd_postcode: null,
      carrier_data: {
        sender_name: 'Example Shop',
        weight_kg: 1.2,
        dimensions_text: '30 × 20 × 10 cm',
        pickup_point: 'Example Kiosk\nExample Street 1',
        destination_country: 'CH',
        expected_delivery_from: '2026-10-03T08:00:00+02:00',
        tracking_provider: 'ParcelsApp',
        carrier_answered: true,
        swiss_post_ready: true,
        active_tracking_carrier: 'swiss-post',
        active_tracking_number: 'TESTDELIVERYLEG01',
        original_carrier: 'planzer',
        original_tracking_number: 'TESTORIGINLEG0001',
        auto_changed_from: 'unknown',
        auto_changed_to: 'planzer',
        auto_changed_at: '2026-09-28T09:00:00.000Z',
      },
      archived_at: null,
      notifications_muted: false,
      tracking_events: [{
        id: '51000000-0000-4000-a000-000000000002',
        package_id: packageId,
        stage: 'in_transit',
        description: 'Sorted at the parcel center',
        location: 'Zürich',
        occurred_at: '2026-10-01T10:00:00+00:00',
        place: expect.objectContaining({ country: 'CH', name: 'Zürich' }),
      }],
    });
  });

  it.each([[undefined], ['not-a-key'], ['B'.repeat(43)]])('masks the number for a viewer (key %s)', async (key) => {
    const found = find();
    const response = await open(linkId, key);
    expect(found).toHaveBeenCalledExactlyOnceWith(linkId, key === 'B'.repeat(43) ? expect.stringMatching(/^[0-9a-f]{64}$/) : null, true);
    const text = await response.text();
    expectNothingPrivate(text);
    // Neither the parcel's number nor the numbers of its other leg.
    for (const number of [trackingNumber, 'TESTDELIVERYLEG01', 'TESTORIGINLEG0001']) expect(text).not.toContain(number);
    const answer = JSON.parse(text);
    expect(answer.link).toMatchObject({ role: 'viewer', numberShown: false, canKeep: false });
    expect(answer.package).toMatchObject({ tracking_number: null, number_hint: { head: 'TEST', tail: '456' }, tracking_url: null });
    expect(answer.package.carrier_data).not.toHaveProperty('active_tracking_number');
    expect(answer.package.carrier_data).not.toHaveProperty('original_tracking_number');
    expect(answer.package.carrier_data).toMatchObject({ sender_name: 'Example Shop', active_tracking_carrier: 'swiss-post' });
  });

  it('shows a viewer the number of a link that shares it, and a link from an account has no forget date', async () => {
    find({ show_number: true, shared: true, forget_at: null }, { one_off: false, user_id: '51000000-0000-4000-a000-000000000005' });
    const answer = await (await open()).json();
    expect(answer.link).toEqual({
      id: linkId, role: 'viewer', kind: 'shared', createdAt: '2026-09-28T08:00:00.000Z',
      forgetAt: null, numberShown: true, canKeep: true,
    });
    expect(answer.package).toMatchObject({ tracking_number: trackingNumber, number_hint: null, dpd_postcode: null });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('never passes diagnostic text on as a failure code', async () => {
    find({}, { sync_status: 'error', sync_error: `GET https://carrier.example/track/${trackingNumber} failed` });
    expect((await (await open()).json()).package.sync_error).toBeNull();
    vi.restoreAllMocks();
    find({}, { sync_status: 'error', sync_error: 'carrier:not_found' });
    expect((await (await open()).json()).package.sync_error).toBe('carrier:not_found');
  });

  it('answers an unknown, forgotten, expired and malformed link alike', async () => {
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(null);
    const counted = vi.spyOn(metrics, 'recordPublicParcelRead');
    const unknown = await open('unknownLink2', ownerKey);
    const malformed = await open('not-a-link-id!', ownerKey);
    const lookalike = await open('k7Qm2xHd9Rt0');
    for (const response of [unknown, malformed, lookalike]) {
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ error: 'Parcel unavailable' });
    }
    // A malformed id never reaches the database.
    expect(found).toHaveBeenCalledExactlyOnceWith('unknownLink2', keyHash, true);
    expect(counted.mock.calls).toEqual([['not_found'], ['not_found'], ['not_found']]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('queues a check of a one-off parcel that is due one, and only then', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-02T10:35:00Z') });
    find({}, { last_synced_at: '2026-10-02T09:50:00+00:00' });
    expect((await open()).status).toBe(200);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith({ packageId });
    expect(wake).toHaveBeenCalledOnce();

    // Checked a minute ago, delivered, or owned by an account: reading queues nothing.
    for (const parcel of [
      { last_synced_at: '2026-10-02T10:34:00+00:00' },
      { last_synced_at: '2026-10-02T09:50:00+00:00', current_stage: 'delivered' },
      { last_synced_at: '2026-10-02T09:50:00+00:00', one_off: false, user_id: '51000000-0000-4000-a000-000000000005' },
    ]) {
      vi.restoreAllMocks();
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const queued = vi.spyOn(SupabaseServiceClient.prototype, 'enqueueSyncJob');
      find({}, parcel);
      expect((await open()).status).toBe(200);
      expect(queued).not.toHaveBeenCalled();
    }
  });

  it('still shows the parcel when the check cannot be queued', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-02T10:35:00Z') });
    find({}, { last_synced_at: null });
    enqueue.mockRejectedValue(new SupabaseError('queue unavailable', 503));
    expect((await open()).status).toBe(200);
  });

  it('keeps the link out of request logs and error reports', async () => {
    const logged = vi.mocked(console.log);
    vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockRejectedValue(new SupabaseError('database down', 503));
    const report = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const failed = await open(linkId, ownerKey);
    expect(failed.status).toBe(502);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(SupabaseError), expect.objectContaining({
      route: '/api/public/parcels/:link', withoutRequest: true,
    }));
    const lines = [...logged.mock.calls, ...vi.mocked(console.error).mock.calls].map(([line]) => String(line));
    expect(lines.some((line) => line.includes('"route":"/api/public/parcels/:link"'))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(linkId);
      expect(line).not.toContain(ownerKey);
      expect(line).not.toContain(keyHash);
    }
  });

  it('limits reads per client across every link', async () => {
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(null);
    for (let index = 0; index < 120; index += 1) {
      expect((await open(index % 2 ? linkId : 'unknownLink2', undefined, '198.51.100.20')).status).toBe(404);
    }
    const refused = await open('anotherLink3', undefined, '198.51.100.20');
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBeTruthy();
    expect(found).toHaveBeenCalledTimes(120);
    expect((await open(linkId, undefined, '198.51.100.21')).status).toBe(404);
  });
});

describe('forgetting a lookup', () => {
  it('forgets the link, and its parcel with it, for the right key', async () => {
    const forgotten = vi.spyOn(SupabaseServiceClient.prototype, 'forgetParcelLink').mockResolvedValue({ links: 1, packages: 1 });
    const counted = vi.spyOn(metrics, 'recordParcelsForgotten');
    const response = await remove(linkId, ownerKey);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(forgotten).toHaveBeenCalledExactlyOnceWith(linkId, keyHash);
    expect(counted).toHaveBeenCalledExactlyOnceWith('asked', { links: 1, packages: 1 });
  });

  it('answers an unknown link, a wrong key and a missing key alike', async () => {
    const forgotten = vi.spyOn(SupabaseServiceClient.prototype, 'forgetParcelLink').mockResolvedValue({ links: 0, packages: 0 });
    const counted = vi.spyOn(metrics, 'recordParcelsForgotten');
    const answers = [
      await remove('unknownLink2', ownerKey),
      await remove(linkId, 'B'.repeat(43)),
      await remove(linkId),
      await remove(linkId, 'not-a-key'),
      await remove('not-a-link-id!', ownerKey),
    ];
    for (const response of answers) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Parcel unavailable' });
    }
    // Only a well-formed link and key are checked against the database.
    expect(forgotten).toHaveBeenCalledTimes(2);
    expect(counted).not.toHaveBeenCalled();
  });
});
