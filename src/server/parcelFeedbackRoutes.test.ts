import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as fromAccount } from '../../app/api/packages/[id]/feedback/route';
import { POST as fromLink } from '../../app/api/public/parcels/[linkId]/feedback/route';
import { SupabaseAuthenticator } from './auth';
import * as metrics from './metrics';
import * as observability from './observability';
import { shownParcel } from './parcelFeedback';
import { SupabaseServiceClient, SupabaseUserClient } from './supabase';
import type { JsonObject } from './types';

// Synthetic identifiers only: no carrier issued any of these.
const linkId = 'k7Qm2xHd9RtW';
const userId = '56000000-0000-4000-a000-000000000001';
const packageId = '56000000-0000-4000-a000-000000000002';
const feedbackId = '56000000-0000-4000-a000-000000000003';
const trackingNumber = 'TESTPARCEL123456';

function storedPackage(overrides: JsonObject = {}): JsonObject {
  return {
    id: packageId,
    user_id: userId,
    tracking_number: trackingNumber,
    label: 'A name that stays with its reader',
    carrier: 'dpd',
    created_at: '2026-09-20T08:00:00+00:00',
    expected_delivery: '2026-10-03',
    last_status_text: 'In transit',
    last_synced_at: '2026-10-02T09:00:00+00:00',
    sync_status: 'ok',
    sync_error: null,
    tracking_url: 'https://tracking.example/shared/SECRET-CAPABILITY',
    dpd_postcode: '9999',
    carrier_data: {
      tracking_provider: 'ParcelsApp',
      active_tracking_carrier: 'swiss-post',
      receiver_name: 'Private Recipient',
      pickup_code: 'PIN-4711',
    },
    tracking_events: [
      { id: 'e1', package_id: packageId, stage: 'accepted', description: 'Handed over', location: 'Basel', occurred_at: '2026-09-30T08:00:00+00:00' },
      { id: 'e2', package_id: packageId, stage: 'in_transit', description: 'Sorted', location: 'Zürich', occurred_at: '2026-10-01T10:00:00+00:00', provider_event_id: 'dpd:private-identity' },
    ],
    ...overrides,
  };
}

const answer = (overrides: JsonObject = {}): JsonObject => ({
  id: feedbackId, answer: 'wrong', reasons: ['status'], asked: 'page', app: 'web', locale: 'en', ...overrides,
});

let address = 0;
function viaLink(body: unknown, id = linkId, key?: string) {
  return fromLink(new NextRequest(`https://delivery.example/api/public/parcels/${id}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': `192.0.2.${++address}`, ...(key === undefined ? {} : { 'x-parcel-key': key }) },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ linkId: id }) });
}
function viaAccount(body: unknown, id = packageId, authenticated = true) {
  return fromAccount(new NextRequest(`https://delivery.example/api/packages/${id}/feedback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authenticated ? { Authorization: 'Bearer feedback-test' } : {}) },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id }) });
}

let record: ReturnType<typeof vi.spyOn>;
let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-public');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service');
  vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(SupabaseAuthenticator.prototype, 'validate').mockResolvedValue({ id: userId, email: null, authenticatedAt: null, sessionId: null });
  record = vi.spyOn(SupabaseServiceClient.prototype, 'recordParcelFeedback').mockResolvedValue('stored');
  logged = vi.spyOn(observability, 'logOperationalEvent');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('what the service held when an answer arrived', () => {
  it('keeps the status, the last check and the newest scans first, and nothing private', () => {
    const shown = shownParcel(storedPackage());
    expect(shown).toEqual({
      status: 'In transit', sync_status: 'ok', sync_error: null, last_synced_at: '2026-10-02T09:00:00+00:00',
      expected_delivery: '2026-10-03', provider: 'ParcelsApp', active_carrier: 'swiss-post', delivery_carrier: null,
      event_count: 2,
      events: [
        { stage: 'in_transit', description: 'Sorted', location: 'Zürich', occurred_at: '2026-10-01T10:00:00+00:00' },
        { stage: 'accepted', description: 'Handed over', location: 'Basel', occurred_at: '2026-09-30T08:00:00+00:00' },
      ],
    });
    const text = JSON.stringify(shown);
    for (const secret of ['SECRET', '9999', 'Private', 'PIN-4711', 'private-identity', 'A name that stays', userId, packageId]) {
      expect(text).not.toContain(secret);
    }
  });

  it('keeps the six newest scans of a long journey, each cut to size', () => {
    const events = Array.from({ length: 9 }, (_, index) => ({
      stage: 'in_transit', description: '🙂'.repeat(300), location: 'x'.repeat(300), occurred_at: `2026-10-0${index + 1}T10:00:00+00:00`,
    }));
    const shown = shownParcel(storedPackage({ tracking_events: events, carrier_data: null }));
    expect(shown.event_count).toBe(9);
    const kept = shown.events as Array<{ description: string; location: string; occurred_at: string }>;
    expect(kept.map((event) => event.occurred_at.slice(8, 10))).toEqual(['09', '08', '07', '06', '05', '04']);
    expect([...kept[0].description]).toHaveLength(200);
    expect(kept[0].location).toHaveLength(100);
    expect(Buffer.byteLength(JSON.stringify(shown))).toBeLessThan(16_384);
  });
});

describe('an answer through a link', () => {
  const found = (link: JsonObject = {}, row: JsonObject = {}) => vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel')
    .mockResolvedValue({ link: { id: linkId, owner: false, gift: false, ...link }, package: storedPackage({ user_id: null, ...row }) });

  it('is kept with the parcel\'s number and what was shown, and with nothing about who gave it', async () => {
    const read = found();
    const counted = vi.spyOn(metrics, 'recordParcelFeedback');
    const response = await viaLink(answer({ reasons: ['status', 'steps'], note: '  Delivered on Monday  ', asked: 'back', app: 'ios', locale: 'fr' }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('cache-control')).toBe('no-store');
    // Answering is not an opening of the link.
    expect(read).toHaveBeenCalledExactlyOnceWith(linkId, null, false);
    expect(record).toHaveBeenCalledOnce();
    const stored = record.mock.calls[0][0] as JsonObject;
    expect(stored).toMatchObject({
      id: feedbackId, tracking_number: trackingNumber, carrier: 'dpd', answer: 'wrong', reasons: ['status', 'steps'],
      note: 'Delivered on Monday', carrier_name: null, tracking_page: null, asked: 'back', via: 'link', app: 'ios', locale: 'fr',
    });
    expect(stored.server_version).toMatch(/^universal-parcel-scraper@/);
    expect((stored.shown as JsonObject).event_count).toBe(2);
    const text = JSON.stringify(stored);
    for (const secret of [linkId, packageId, '192.0.2', 'SECRET', '9999', 'Private']) expect(text).not.toContain(secret);
    expect(counted).toHaveBeenCalledExactlyOnceWith('wrong', 'link', 'ios', 'stored');
    // The log names the answer and the carrier, never the number or the words.
    const event = logged.mock.calls.find((call: unknown[]) => call[0] === 'parcel_feedback');
    expect(event?.[1]).toEqual({ answer: 'wrong', reasons: 'status,steps', carrier: 'dpd', asked: 'back', via: 'link', app: 'ios', outcome: 'stored' });
  });

  it('names the carrier of a parcel no carrier was found for', async () => {
    found({ owner: true }, { carrier: 'unknown', tracking_events: [], last_status_text: null });
    const response = await viaLink(answer({ answer: 'found_elsewhere', reasons: undefined, carrierName: 'Example Post', trackingPage: 'example.test/track' }), linkId, 'A'.repeat(43));
    expect(response.status).toBe(204);
    expect(record.mock.calls[0][0]).toMatchObject({
      answer: 'found_elsewhere', reasons: [], note: null, carrier: 'unknown', carrier_name: 'Example Post', tracking_page: 'example.test/track',
    });
  });

  it('thanks the reader the same when the parcel had its day\'s answers', async () => {
    found();
    record.mockResolvedValue('full');
    const counted = vi.spyOn(metrics, 'recordParcelFeedback');
    expect((await viaLink(answer({ answer: 'right', reasons: [] }))).status).toBe(204);
    expect(counted).toHaveBeenCalledExactlyOnceWith('right', 'link', 'web', 'full');
  });

  it('takes no answer from the one a gift is for, and every answer from its giver', async () => {
    found({ gift: true });
    const refused = await viaLink(answer());
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: 'Parcel unavailable' });
    expect(record).not.toHaveBeenCalled();
    found({ gift: true, owner: true });
    expect((await viaLink(answer(), linkId, 'A'.repeat(43))).status).toBe(204);
    expect(record).toHaveBeenCalledOnce();
  });

  it('answers an unknown, malformed or stopped link like the other link routes', async () => {
    const read = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValueOnce(null).mockResolvedValueOnce('stopped');
    expect((await viaLink(answer())).status).toBe(404);
    const stopped = await viaLink(answer());
    expect(stopped.status).toBe(410);
    expect(await stopped.json()).toEqual({ error: 'Parcel not shared' });
    expect((await viaLink(answer(), 'not-a-link')).status).toBe(404);
    expect(read).toHaveBeenCalledTimes(2);
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    ['an id that is not a uuid', { id: 'nope' }],
    ['an unknown answer', { answer: 'maybe' }],
    ['an unknown reason', { reasons: ['weather'] }],
    ['a reason given twice', { reasons: ['status', 'status'] }],
    ['a wrong answer without a word', { reasons: [], note: '   ' }],
    ['a right answer with words', { answer: 'right', reasons: ['status'] }],
    ['a carrier named for a found parcel', { carrierName: 'Example Post' }],
    ['a parcel found elsewhere with nobody named', { answer: 'found_elsewhere', reasons: [] }],
    ['a note past its limit', { note: 'x'.repeat(1_001) }],
    ['a tracking page past its limit', { answer: 'found_elsewhere', reasons: [], trackingPage: 'x'.repeat(501) }],
    ['a note that is not text', { note: 4 }],
    ['no place the question was asked', { asked: 'email' }],
    ['an unknown app', { app: 'android' }],
    ['an unsupported locale', { locale: 'xx' }],
  ])('refuses %s before it reads the link', async (_, overrides) => {
    const read = found();
    const response = await viaLink(answer(overrides));
    expect(response.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('limits how fast one address may answer', async () => {
    found();
    const send = () => fromLink(new NextRequest(`https://delivery.example/api/public/parcels/${linkId}/feedback`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '198.51.100.9' }, body: JSON.stringify(answer()),
    }), { params: Promise.resolve({ linkId }) });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt++) statuses.push((await send()).status);
    expect(statuses.slice(0, 20).every((status) => status === 204)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe('an answer from an account', () => {
  it('is kept for the caller\'s own parcel, without the account', async () => {
    const read = vi.spyOn(SupabaseUserClient.prototype, 'getPackage').mockResolvedValue(storedPackage());
    const counted = vi.spyOn(metrics, 'recordParcelFeedback');
    const response = await viaAccount(answer({ answer: 'right', reasons: [] }));
    expect(response.status).toBe(204);
    expect(read).toHaveBeenCalledExactlyOnceWith(packageId);
    const stored = record.mock.calls[0][0] as JsonObject;
    expect(stored).toMatchObject({ id: feedbackId, tracking_number: trackingNumber, carrier: 'dpd', answer: 'right', reasons: [], via: 'account', app: 'web' });
    const text = JSON.stringify(stored);
    for (const secret of [userId, packageId, 'SECRET', '9999', 'A name that stays']) expect(text).not.toContain(secret);
    expect(counted).toHaveBeenCalledExactlyOnceWith('right', 'account', 'web', 'stored');
  });

  it('answers another account\'s parcel like one that does not exist', async () => {
    vi.spyOn(SupabaseUserClient.prototype, 'getPackage').mockResolvedValue(null);
    const response = await viaAccount(answer());
    expect(response.status).toBe(404);
    expect(record).not.toHaveBeenCalled();
  });

  it('needs a sign-in, a package id and a valid answer', async () => {
    const read = vi.spyOn(SupabaseUserClient.prototype, 'getPackage').mockResolvedValue(storedPackage());
    expect((await viaAccount(answer(), packageId, false)).status).toBe(401);
    expect((await viaAccount(answer(), 'not-a-package')).status).toBe(400);
    expect((await viaAccount(answer({ answer: 'maybe' }))).status).toBe(400);
    expect(read).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
