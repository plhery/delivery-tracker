// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as image } from '../../app/api/public/parcels/[linkId]/image/route';
import { generateMetadata } from '../../app/p/[id]/page';
import { genericSocialImage, parcelLinkSocialImage } from './ParcelLinkSocialImage';
import { parcelLinkPreview } from './parcelLinkPreview';
import * as observability from './observability';
import { SupabaseError, SupabaseServiceClient } from './supabase';
import type { JsonObject } from './types';

const request = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => request.headers),
  cookies: vi.fn(async () => ({ get: (name: string) => request.cookies.has(name) ? { value: request.cookies.get(name) } : undefined })),
}));

// Synthetic identifiers only: no carrier issued any of these.
const linkId = 'k7Qm2xHd9RtW';
const trackingNumber = 'TESTPARCEL123456';
const NOW = Date.parse('2026-10-02T10:00:00Z');

function stored(overrides: JsonObject = {}, events: JsonObject[] = [
  { id: 'e1', package_id: 'p', stage: 'accepted', description: 'Accepted', location: 'Exampletown, DE', occurred_at: '2026-09-30T09:00:00Z' },
  { id: 'e2', package_id: 'p', stage: 'out_for_delivery', description: 'With the courier', location: 'Sampleville, CH', occurred_at: '2026-10-02T06:00:00Z' },
]): { link: JsonObject; package: JsonObject } {
  return {
    link: { id: linkId, owner: false, shared: false, show_number: false, created_at: '2026-09-30T08:00:00Z', forget_at: '2026-12-30T08:00:00Z' },
    package: {
      id: 'p', user_id: null, one_off: true, tracking_number: trackingNumber, label: 'A private name', carrier: 'dhl',
      created_at: '2026-09-30T08:00:00Z', expected_delivery: '2026-10-02', last_status_text: null, last_synced_at: '2026-10-02T09:00:00Z',
      sync_status: 'ok', sync_error: null, tracking_url: null, dpd_postcode: '9999', archived_at: null, notifications_muted: false,
      carrier_data: { sender_name: 'Example Shop', pickup_point: 'Example Kiosk' }, tracking_events: events, ...overrides,
    },
  };
}

const PRIVATE = new RegExp(`${trackingNumber}|TEST|private name|Exampletown|Sampleville|Example Shop|Example Kiosk|9999`);

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.stubEnv('SUPABASE_URL', 'https://database.example');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
  request.headers = new Headers({ host: 'peek.example.test', 'x-forwarded-proto': 'https', 'accept-language': 'en' });
  request.cookies = new Map();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('parcelLinkPreview', () => {
  it('reads the parcel as a viewer, without opening the link, and says its status, carrier and estimate', async () => {
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(stored());
    const preview = await parcelLinkPreview(linkId, new Headers(), 'en');
    expect(preview).toMatchObject({
      title: 'Out for delivery · DHL', description: 'Today. Follow it on Peek.', headline: 'Out for delivery', detail: 'Today', steps: 5,
      carrier: { id: 'dhl' },
    });
    // No owner key, and the read does not count as a visit.
    expect(found).toHaveBeenCalledExactlyOnceWith(linkId, null, false);
    expect(JSON.stringify(preview)).not.toMatch(PRIVATE);
  });

  it('writes the preview in the page’s language', async () => {
    vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(stored({ expected_delivery: '2026-10-05' }));
    expect(await parcelLinkPreview(linkId, new Headers(), 'de')).toMatchObject({
      title: 'In Zustellung · DHL', description: 'Erwartet: Mo 5 okt. Verfolge es auf Peek.',
    });
  });

  it('gives a delivered parcel its day without a clock time, and a parcel without an estimate only the invitation', async () => {
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(stored({ expected_delivery: null }, [
      { id: 'e1', package_id: 'p', stage: 'delivered', description: 'Delivered', location: null, occurred_at: '2026-10-02T08:00:00Z' },
    ]));
    expect(await parcelLinkPreview(linkId, new Headers(), 'en')).toMatchObject({ title: 'Delivered · DHL', description: 'Today. Follow it on Peek.', steps: 6 });
    found.mockResolvedValue(stored({ expected_delivery: null }, [
      { id: 'e1', package_id: 'p', stage: 'ready_for_pickup', description: 'Ready', location: null, occurred_at: '2026-10-02T08:00:00Z' },
    ]));
    expect(await parcelLinkPreview(linkId, new Headers(), 'en')).toMatchObject({ title: 'Ready for pickup · DHL', description: 'Follow it on Peek.' });
  });

  it('names no carrier while none is known for the number', async () => {
    vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(stored({ carrier: 'unknown', sync_status: 'waiting', expected_delivery: null }, [
      { id: 'e1', package_id: 'p', stage: 'pending', description: 'Tracking added', location: null, occurred_at: '2026-10-01T08:00:00Z' },
    ]));
    expect(await parcelLinkPreview(linkId, new Headers(), 'en')).toMatchObject({ title: 'Waiting for the carrier · Peek', carrier: null, steps: 0 });
  });

  it('answers nothing for a malformed id without asking the database, and for a link that leads nowhere', async () => {
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(null);
    for (const id of ['not-a-link', '', undefined, `${linkId}x`]) expect(await parcelLinkPreview(id, new Headers(), 'en')).toBeNull();
    expect(found).not.toHaveBeenCalled();
    expect(await parcelLinkPreview(linkId, new Headers(), 'en')).toBeNull();
    expect(found).toHaveBeenCalledTimes(1);
  });

  it('falls back to nothing, and reports it, when the database fails or answers something unreadable', async () => {
    const reported = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockRejectedValue(new SupabaseError('database down', 503));
    expect(await parcelLinkPreview(linkId, new Headers(), 'en')).toBeNull();
    found.mockResolvedValue({ link: { id: linkId }, package: { id: 'p' } });
    expect(await parcelLinkPreview(linkId, new Headers(), 'en')).toBeNull();
    expect(reported).toHaveBeenCalledTimes(2);
    expect(reported).toHaveBeenLastCalledWith(expect.anything(), { component: 'parcel-links', operation: 'link-preview' });
  });

  it('gives one client sixty previews a minute across pages and images', async () => {
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(stored());
    const headers = new Headers({ 'x-real-ip': '198.51.100.24' });
    for (let count = 0; count < 60; count += 1) expect(await parcelLinkPreview(linkId, headers, 'en')).not.toBeNull();
    expect(await parcelLinkPreview(linkId, headers, 'en')).toBeNull();
    expect(found).toHaveBeenCalledTimes(60);
    // Another client still gets its own.
    expect(await parcelLinkPreview(linkId, new Headers({ 'x-real-ip': '198.51.100.25' }), 'en')).not.toBeNull();
  });
});

describe('the parcel page’s metadata', () => {
  it('previews the parcel in the request’s language, unindexed and without a referrer', async () => {
    request.headers.set('accept-language', 'de-CH,de;q=0.9');
    request.headers.set('x-real-ip', '198.51.100.30');
    vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(stored());
    const metadata = await generateMetadata({ params: Promise.resolve({ id: linkId }) });
    const picture = `https://peek.example.test/api/public/parcels/${linkId}/image?lang=de`;
    expect(metadata).toMatchObject({
      title: 'In Zustellung · DHL',
      description: 'Heute. Verfolge es auf Peek.',
      robots: { index: false, follow: false },
      referrer: 'no-referrer',
      openGraph: {
        title: 'In Zustellung · DHL', url: `https://peek.example.test/p/${linkId}`, siteName: 'Peek',
        images: [{ url: picture, width: 1200, height: 630, type: 'image/png', alt: 'In Zustellung · DHL' }],
      },
      twitter: { card: 'summary_large_image', images: [{ url: picture }] },
    });
    expect(metadata.alternates).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toMatch(PRIVATE);
  });

  it('follows the language the visitor chose over the browser’s', async () => {
    request.cookies.set('sdt.locale', 'fr');
    request.headers.set('x-real-ip', '198.51.100.31');
    vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(stored());
    expect((await generateMetadata({ params: Promise.resolve({ id: linkId }) })).title).toBe('En livraison · DHL');
  });

  it('gives a link that leads nowhere, and a malformed one, Peek’s own preview', async () => {
    request.headers.set('x-real-ip', '198.51.100.32');
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(null);
    const gone = await generateMetadata({ params: Promise.resolve({ id: linkId }) });
    expect(gone).toMatchObject({
      title: 'Peek — Universal Parcel Tracker', robots: { index: false, follow: false }, referrer: 'no-referrer',
      openGraph: { url: `https://peek.example.test/p/${linkId}`, images: [{ url: `https://peek.example.test/api/public/parcels/${linkId}/image?lang=en` }] },
    });
    const malformed = await generateMetadata({ params: Promise.resolve({ id: '<script>' }) });
    expect(malformed.title).toBe(gone.title);
    expect(malformed.openGraph).toMatchObject({ url: 'https://peek.example.test/', images: [{ url: 'https://peek.example.test/api/public/parcels/unavailable/image?lang=en' }] });
    expect(JSON.stringify(malformed)).not.toMatch(/<script|%3Cscript/i);
    expect(found).toHaveBeenCalledTimes(1);
  });
});

describe('the link preview image', () => {
  const size = async (response: Response) => {
    const png = Buffer.from(await response.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    return [png.readUInt32BE(16), png.readUInt32BE(20)];
  };
  const preview = (overrides: Partial<NonNullable<Awaited<ReturnType<typeof parcelLinkPreview>>>> = {}) => ({
    title: 'Out for delivery · DHL', description: 'Today. Follow it on Peek.', headline: 'Out for delivery', detail: 'Today, 13:00–17:00',
    carrier: null, steps: 5, ...overrides,
  });

  it.each([
    ['a short status', {}],
    ['a long German one', { headline: 'Zustellversuch fehlgeschlagen', detail: 'Erwartet: Mo 5 okt' }],
    ['no estimate and no step yet', { headline: 'Waiting for the carrier', detail: null, steps: 0 }],
  ])('draws a complete 1200 × 630 PNG for %s', async (_name, overrides) => {
    const response = parcelLinkSocialImage(preview(overrides), 'peek.example.test');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await size(response)).toEqual([1200, 630]);
  });

  it('serves the parcel’s picture in the asked language, with every carrier’s own livery', async () => {
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel');
    for (const [index, carrier] of ['dhl', 'ups', 'gls-de', 'swiss-post', 'postnl'].entries()) {
      found.mockResolvedValue(stored({ carrier }));
      const response = await image(new Request(`https://peek.example.test/api/public/parcels/${linkId}/image?lang=de`, {
        headers: { host: 'peek.example.test', 'x-real-ip': `198.51.100.${40 + index}` },
      }), { params: Promise.resolve({ linkId }) });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await size(response)).toEqual([1200, 630]);
    }
    expect(found).toHaveBeenLastCalledWith(linkId, null, false);
  });

  it('serves Peek’s own picture for a link that leads nowhere, with the same headers', async () => {
    vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(null);
    for (const id of [linkId, 'unavailable']) {
      const response = await image(new Request(`https://peek.example.test/api/public/parcels/${id}/image?lang=xx`, { headers: { 'x-real-ip': '198.51.100.50' } }),
        { params: Promise.resolve({ linkId: id }) });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(await size(response)).toEqual([1200, 630]);
    }
    expect(await size(genericSocialImage())).toEqual([1200, 630]);
  });
});
