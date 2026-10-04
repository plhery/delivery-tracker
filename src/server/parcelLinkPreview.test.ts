// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as image } from '../../app/api/public/parcels/[linkId]/image/route';
import { generateMetadata } from '../../app/p/[id]/page';
import { generateMetadata as sampleMetadata } from '../../app/sample/page';
import { STAGES, SYNC_STATUSES } from '../generated/apiContract';
import { carrierInfo, type CarrierInfo } from '../lib/carriers';
import { SUPPORTED_LOCALES } from '../lib/locale';
import { languageTags, translateMessage, type Translate } from '../lib/messages';
import { giftPreviewText, parcelPreviewText } from '../peek/parcel/summary';
import { refuseTheWeb } from '../test/pictureRequests';
import type { ParcelWithEvents } from '../types';
import { genericSocialImage, parcelLinkSocialImage } from './ParcelLinkSocialImage';
import { parcelLinkPreview } from './parcelLinkPreview';
import * as observability from './observability';
import { GEIST, writable } from './pictureFont';
import { messagesFor } from './requestLocale';
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
  vi.unstubAllGlobals();
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

  it('says of a gift on its way only that something is coming and when: no carrier, sender, place or number', async () => {
    const gift = (overrides: JsonObject = {}) => {
      const found = stored({ expected_delivery: '2026-10-02', ...overrides });
      return { ...found, link: { ...found.link, gift: true, show_number: true } };
    };
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue(gift());
    const preview = await parcelLinkPreview(linkId, new Headers(), 'en', NOW);
    expect(preview).toEqual({
      title: 'Something’s on its way to you', description: 'Arrives today. Follow it on Peek.',
      headline: 'Something’s on its way to you', detail: 'Arrives today', carrier: null, steps: 5, gift: true,
    });
    expect(JSON.stringify(preview)).not.toMatch(PRIVATE);
    expect(JSON.stringify(preview)).not.toMatch(/DHL|dhl/);
    expect(await parcelLinkPreview(linkId, new Headers(), 'de', NOW)).toMatchObject({ title: 'Etwas ist auf dem Weg zu dir', description: 'Kommt heute. Verfolge es auf Peek.' });
    // Without an estimate the preview only invites.
    found.mockResolvedValue(gift({ expected_delivery: null }));
    expect(await parcelLinkPreview(linkId, new Headers(), 'en', NOW)).toMatchObject({ detail: null, description: 'Follow it on Peek.', gift: true });
    // Delivered, it is a link like any other.
    found.mockResolvedValue(gift({ current_stage: 'delivered', tracking_events: [
      { id: 'e9', package_id: 'p', stage: 'delivered', description: 'Delivered', location: null, occurred_at: '2026-10-02T08:00:00Z' },
    ] }));
    const delivered = await parcelLinkPreview(linkId, new Headers(), 'en', NOW);
    expect(delivered).toMatchObject({ title: 'Delivered · DHL', carrier: { id: 'dhl' } });
    expect(delivered!.gift).toBeUndefined();
  });

  it('gives a link whose sharing was stopped Peek’s own preview', async () => {
    vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue('stopped');
    expect(await parcelLinkPreview(linkId, new Headers(), 'en')).toBeNull();
    request.headers.set('x-real-ip', '198.51.100.33');
    expect((await generateMetadata({ params: Promise.resolve({ id: linkId }) })).title).toBe('Peek — Universal Parcel Tracker');
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

  it('tells the sample parcel without the database, with the note that it is a sample', async () => {
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel');
    const preview = await parcelLinkPreview('sample', new Headers({ 'x-real-ip': '198.51.100.26' }), 'en', NOW);
    expect(preview).toEqual({
      title: 'Peek — Sample parcel',
      description: 'Waiting for a real one? Paste a tracking number or a carrier link, no account needed.',
      headline: 'In transit',
      detail: 'Expected: Sun 4 oct',
      carrier: expect.objectContaining({ id: 'gls-de' }),
      steps: 4,
      note: 'Sample parcel',
    });
    expect(found).not.toHaveBeenCalled();
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

  it('previews a gift on its way without saying who carries it', async () => {
    request.headers.set('x-real-ip', '198.51.100.34');
    const found = stored();
    vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue({ ...found, link: { ...found.link, gift: true } });
    const metadata = await generateMetadata({ params: Promise.resolve({ id: linkId }) });
    expect(metadata).toMatchObject({
      title: 'Something’s on its way to you', description: 'Arrives today. Follow it on Peek.',
      robots: { index: false, follow: false }, referrer: 'no-referrer',
      openGraph: { title: 'Something’s on its way to you', images: [{ alt: 'Something’s on its way to you' }] },
    });
    expect(JSON.stringify(metadata)).not.toMatch(PRIVATE);
    expect(JSON.stringify(metadata)).not.toMatch(/DHL/);
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

  it('keeps the sample’s preview to the sample’s own page', async () => {
    request.headers.set('x-real-ip', '198.51.100.33');
    const metadata = await generateMetadata({ params: Promise.resolve({ id: 'sample' }) });
    expect(metadata.title).toBe('Peek — Universal Parcel Tracker');
    expect(metadata.openGraph).toMatchObject({ url: 'https://peek.example.test/', images: [{ url: 'https://peek.example.test/api/public/parcels/unavailable/image?lang=en' }] });
  });
});

describe('the sample page’s metadata', () => {
  it('previews a parcel noted as made up, in the request’s language and open to search engines', async () => {
    request.headers.set('accept-language', 'fr-CH,fr;q=0.9');
    request.headers.set('x-real-ip', '198.51.100.34');
    const metadata = await sampleMetadata();
    const title = 'Peek — Colis d’exemple';
    const picture = 'https://peek.example.test/api/public/parcels/sample/image?lang=fr';
    expect(metadata).toMatchObject({
      title,
      description: 'Tu en attends un vrai ? Colle un numéro de suivi ou un lien de transporteur, pas besoin de compte.',
      alternates: { canonical: 'https://peek.example.test/sample' },
      openGraph: {
        title, url: 'https://peek.example.test/sample', siteName: 'Peek',
        images: [{ url: picture, width: 1200, height: 630, type: 'image/png', alt: title }],
      },
      twitter: { card: 'summary_large_image', images: [{ url: picture }] },
    });
    expect(metadata.robots).toBeUndefined();
    expect(metadata.referrer).toBeUndefined();
  });

  it('leaves a client over its allowance Peek’s own preview', async () => {
    request.headers.set('x-real-ip', '198.51.100.35');
    for (let count = 0; count < 60; count += 1) expect(await sampleMetadata()).toHaveProperty('openGraph');
    expect(await sampleMetadata()).toEqual({});
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

  it('draws a gift on its way wrapped, whoever carries it', async () => {
    const response = parcelLinkSocialImage(preview({ title: 'Something’s on its way to you', headline: 'Something’s on its way to you', detail: 'Arrives today', gift: true }), 'peek.example.test');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await size(response)).toEqual([1200, 630]);
    // The route serves it for a gift link, in German as well.
    const found = stored();
    vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel').mockResolvedValue({ ...found, link: { ...found.link, gift: true } });
    const served = await image(new Request(`https://peek.example.test/api/public/parcels/${linkId}/image?lang=de`, {
      headers: { host: 'peek.example.test', 'x-real-ip': '198.51.100.60' },
    }), { params: Promise.resolve({ linkId }) });
    expect(served.status).toBe(200);
    expect(await size(served)).toEqual([1200, 630]);
  });

  it('writes the sample’s note on its picture, in every language, without the database or the web', async () => {
    const asked = refuseTheWeb();
    const found = vi.spyOn(SupabaseServiceClient.prototype, 'publicParcel');
    const bytes = async (response: Response) => Buffer.from(await response.arrayBuffer());
    expect((await bytes(parcelLinkSocialImage(preview({ note: 'Sample parcel' }), null))).equals(await bytes(parcelLinkSocialImage(preview(), null)))).toBe(false);
    for (const [index, locale] of SUPPORTED_LOCALES.entries()) {
      const note = translateMessage(locale, 'sample.note', undefined, messagesFor(locale));
      expect(writable(note, GEIST), locale).toBe(note);
      const response = await image(new Request(`https://peek.example.test/api/public/parcels/sample/image?lang=${locale}`, {
        headers: { host: 'peek.example.test', 'x-real-ip': `198.51.100.${70 + index}` },
      }), { params: Promise.resolve({ linkId: 'sample' }) });
      expect(response.status).toBe(200);
      expect(await size(response)).toEqual([1200, 630]);
    }
    expect(asked).not.toHaveBeenCalled();
    expect(found).not.toHaveBeenCalled();
  });

  it('never asks the web for a font or an emoji, whatever the carrier, the estimate and the host are called', async () => {
    // The renderer fetches a font for any character its own lacks, and a drawing for any emoji.
    const asked = refuseTheWeb();
    const same = async (one: Response, other: Response) => Buffer.from(await one.arrayBuffer()).equals(Buffer.from(await other.arrayBuffer()));
    const yamato: CarrierInfo = { ...carrierInfo('yamato', 'en'), name: 'ヤマト運輸 🐈' };
    const drawn = parcelLinkSocialImage(preview({ carrier: yamato, detail: 'Αύριο ⏰' }), 'παράδειγμα.example 🌐');
    expect(await size(drawn.clone())).toEqual([1200, 630]);
    // What the face cannot write is left out; the truck in the carrier's livery stays.
    expect(await same(drawn, parcelLinkSocialImage(preview({ carrier: { ...yamato, name: '' }, detail: null }), null))).toBe(true);
    expect(await same(parcelLinkSocialImage(preview({ carrier: yamato }), null), parcelLinkSocialImage(preview(), null))).toBe(false);
    // A status it cannot write gets Peek's own picture.
    for (const headline of ['配達完了', 'Παραδόθηκε', 'Delivered ✅', ' ']) {
      const response = parcelLinkSocialImage(preview({ headline }), 'peek.example.test');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await same(response, genericSocialImage()), headline).toBe(true);
    }
    expect(asked).not.toHaveBeenCalled();
  });

  it('can write every status and every estimate in each language', () => {
    const day = 86_400_000;
    const parcel = (overrides: Partial<ParcelWithEvents>): ParcelWithEvents => ({
      id: 'p', trackingNumber, label: 'A private name', carrier: 'dhl', createdAt: '2026-09-30T08:00:00Z', syncStatus: 'ok', events: [], ...overrides,
    });
    for (const locale of SUPPORTED_LOCALES) {
      const messages = messagesFor(locale);
      const t: Translate = (key, variables) => translateMessage(locale, key, variables, messages);
      const wording = { t, languageTag: languageTags[locale], now: NOW };
      const said = new Set<string>();
      const say = (overrides: Partial<ParcelWithEvents>) => {
        for (const { headline, detail } of [parcelPreviewText(parcel(overrides), 'DHL', wording), giftPreviewText(parcel(overrides), wording)]) {
          said.add(headline);
          if (detail) said.add(detail);
        }
      };
      for (const syncStatus of SYNC_STATUSES) say({ syncStatus });
      // Every stage, with scans through the weekdays and months behind and estimates through those ahead.
      for (const stage of STAGES) {
        for (let days = 0; days < 371; days += 5) {
          const events = [{ id: 'e', parcelId: 'p', stage, description: 'A scan', occurredAt: new Date(NOW - days * day).toISOString() }];
          const on = new Date(NOW + days * day).toISOString().slice(0, 10);
          say({ events, expectedDelivery: on });
          say({ events, expectedDelivery: `${on}T17:00`, expectedDeliveryFrom: `${on}T13:00` });
        }
      }
      expect(said.size).toBeGreaterThan(200);
      for (const text of said) expect(writable(text, GEIST), `${locale}: ${text}`).not.toBeNull();
    }
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
