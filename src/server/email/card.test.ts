// @vitest-environment node
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { carrierInfo, type CarrierInfo } from '../../lib/carriers';
import { SUPPORTED_LOCALES, type Locale } from '../../lib/locale';
import { languageTags, translateMessage, type Translate } from '../../lib/messages';
import { refuseTheWeb } from '../../test/pictureRequests';
import type { EventPlace, ParcelWithEvents, Stage } from '../../types';
import { messagesFor } from '../requestLocale';
import { CARD_PIXELS, deliveryCard, type DeliveryCardInput } from './card';

const town = (name: string, country: string, latitude: number, longitude: number): EventPlace => ({ name, country, latitude, longitude, precision: 'city' });
const HAMBURG = town('Hamburg', 'DE', 53.551, 9.993);
const ZURICH = town('Zürich', 'CH', 47.367, 8.55);

function parcel(scans: [stage: Stage, at: string, place?: EventPlace][]): ParcelWithEvents {
  return {
    id: 'p', trackingNumber: 'TESTPARCEL123456', label: 'A private name', carrier: 'dhl', createdAt: '2026-10-01T08:00:00Z', syncStatus: 'ok',
    events: scans.map(([stage, occurredAt, place], index) => ({ id: `e${index}`, parcelId: 'p', stage, description: 'Delivered', occurredAt, place })),
  };
}

const JOURNEY = parcel([['accepted', '2026-10-01T16:48:00Z', HAMBURG], ['delivered', '2026-10-03T12:12:00Z', ZURICH]]);

function input(locale: Locale, overrides: Partial<DeliveryCardInput> = {}): DeliveryCardInput {
  const messages = messagesFor(locale);
  const t: Translate = (key, variables) => translateMessage(locale, key, variables, messages);
  return { parcel: JOURNEY, carrier: carrierInfo('dhl', locale), when: 'Today, 14:12', timed: true, t, languageTag: languageTags[locale], ...overrides };
}

/** The picture's size as its PNG header states it. */
function size(png: Uint8Array): { width: number; height: number } {
  const bytes = Buffer.from(png);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The colour of one pixel, with its opacity. */
async function pixel(png: Uint8Array, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 4)];
}

// Drawing takes a moment, and longer on a busy machine.
vi.setConfig({ testTimeout: 30_000 });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('deliveryCard', () => {
  it('is a PNG of the email’s width at twice its size and more, small enough to attach', async () => {
    const card = await deliveryCard(input('en'));
    const { width, height } = size(card.png);
    expect(width).toBe(CARD_PIXELS);
    expect(width).toBe(1040);
    expect(height).toBeGreaterThan(700);
    expect(height).toBeLessThan(820);
    expect(card.png.length).toBeGreaterThan(40_000);
    expect(card.png.length).toBeLessThan(200_000);
    expect(card).toMatchObject({ ends: { from: 'Hamburg', to: 'Zürich' }, mapped: true });
    // Rounded corners are cut out of the picture itself, and the card is painted in its carrier's surface.
    expect(await pixel(card.png, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(await pixel(card.png, width - 1, height - 1)).toEqual([0, 0, 0, 0]);
    expect(await pixel(card.png, 520, height - 20)).toEqual([0xf7, 0xe8, 0xaa, 255]);
    // The map is drawn: land under the route is darker than the bare surface.
    const land = await pixel(card.png, 620, 300);
    expect(land[3]).toBe(255);
    expect(land[0]).toBeLessThan(0xf7);
  });

  it('stands the carrier it was handed to under the first, its map a line taller for it', async () => {
    const plain = size((await deliveryCard(input('en'))).png);
    const handed = await deliveryCard(input('en', { delivery: carrierInfo('swiss-post', 'en') }));
    expect(handed).toMatchObject({ ends: { from: 'Hamburg', to: 'Zürich' }, mapped: true });
    expect(Math.abs(size(handed.png).height - plain.height - 24 * CARD_PIXELS / 456)).toBeLessThan(1);
    // Swiss Post's yellow truck, under DHL's.
    const [red, green, blue] = await pixel(handed.png, Math.round(30 * CARD_PIXELS / 456), Math.round(52 * CARD_PIXELS / 456));
    expect(red).toBeGreaterThan(200);
    expect(green).toBeGreaterThan(150);
    expect(blue).toBeLessThan(90);
  });

  it('gives a parcel without a single placed scan the card without the map', async () => {
    const unplaced = parcel([['accepted', '2026-10-01T16:48:00Z'], ['delivered', '2026-10-03T12:12:00Z']]);
    const card = await deliveryCard(input('en', { parcel: unplaced }));
    const { width, height } = size(card.png);
    expect(width).toBe(1040);
    expect(height).toBeGreaterThan(350);
    expect(height).toBeLessThan(500);
    expect(card).toMatchObject({ ends: null, mapped: false });
    expect(card.png.length).toBeLessThan(100_000);
    expect(await pixel(card.png, 520, 100)).toEqual([0xf7, 0xe8, 0xaa, 255]);
  });

  it('names one end only when the journey began and ended in the same place', async () => {
    const local = parcel([['accepted', '2026-10-03T06:00:00Z', ZURICH], ['delivered', '2026-10-03T12:12:00Z', ZURICH]]);
    expect(await deliveryCard(input('en', { parcel: local }))).toMatchObject({ ends: null, mapped: true });
  });

  it('stays neutral and names no carrier when none is known, and has no time to show without one', async () => {
    const card = await deliveryCard(input('en', { carrier: null, when: null, timed: false }));
    expect(size(card.png).width).toBe(1040);
    // The app's own neutral surface.
    expect(await pixel(card.png, 520, size(card.png).height - 20)).toEqual([0xec, 0xee, 0xe7, 255]);
  });

  it('draws a parcel ready to collect still closed, with its last step to come, and fits a long headline', async () => {
    const waiting = parcel([['accepted', '2026-10-01T16:48:00Z', HAMBURG], ['ready_for_pickup', '2026-10-03T12:12:00Z', ZURICH]]);
    const bars = async (png: Uint8Array) => Promise.all([120, 920].map((x) => pixel(png, x, 723)));
    const [first, last] = await bars((await deliveryCard(input('en', { parcel: waiting, stage: 'ready_for_pickup' }))).png);
    expect(last).not.toEqual(first);
    const [deliveredFirst, deliveredLast] = await bars((await deliveryCard(input('en'))).png);
    expect(deliveredLast).toEqual(deliveredFirst);
    // A headline longer than the card is made smaller, not cut: the right margin stays bare.
    const plain = input('en');
    const long: Translate = (key, variables) => key === 'stage.ready_for_pickup' ? 'Ready to collect at the pickup point down the road' : plain.t(key, variables);
    const card = await deliveryCard({ ...plain, parcel: waiting, stage: 'ready_for_pickup', t: long });
    expect(size(card.png)).toEqual({ width: 1040, height: 773 });
    const margin = await Promise.all([550, 570, 590].map((y) => pixel(card.png, 1040 - 20, y)));
    expect(new Set(margin.map(String)).size).toBe(1);
    expect(margin[0]).toEqual(await pixel(card.png, 1040 - 20, 640));
  });

  it.each(SUPPORTED_LOCALES)('is drawn ready to collect in %s', async (locale) => {
    const waiting = parcel([['accepted', '2026-10-01T16:48:00Z', HAMBURG], ['ready_for_pickup', '2026-10-03T12:12:00Z', ZURICH]]);
    expect(size((await deliveryCard(input(locale, { parcel: waiting, stage: 'ready_for_pickup' }))).png)).toEqual({ width: 1040, height: 773 });
  });

  it.each(SUPPORTED_LOCALES)('is drawn in %s', async (locale) => {
    const card = await deliveryCard(input(locale));
    expect(size(card.png)).toEqual({ width: 1040, height: 773 });
  });

  it('never asks the web for a font or an emoji, whatever the parcel’s places and its carrier are called', async () => {
    const asked = refuseTheWeb();
    const far = parcel([
      ['accepted', '2026-09-20T09:00:00Z', town('深圳市 🏭', 'CN', 22.54, 114.06)],
      ['in_transit', '2026-09-28T09:00:00Z', town('Αθήνα', 'GR', 37.98, 23.73)],
      ['delivered', '2026-10-03T12:12:00Z', town('Zürich\u2028\u200d👟', 'CH', 47.367, 8.55)],
    ]);
    const carrier: CarrierInfo = { ...carrierInfo('dhl', 'en'), id: 'yamato', name: 'ヤマト運輸 🐈' };
    const card = await deliveryCard(input('en', { parcel: far, carrier, when: '今日 14:12 ⏰' }));
    expect(size(card.png).width).toBe(1040);
    expect(card.ends).toBeNull();
    expect(asked).not.toHaveBeenCalled();
  });
});
