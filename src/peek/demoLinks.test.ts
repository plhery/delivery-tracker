import { describe, expect, it } from 'vitest';
import { currentStage } from '../lib/stages';
import { createDemoLinks, DEMO_LINKS_STORAGE_KEY } from './demoLinks';
import { isParcelLinkId, ParcelLinkError, type ParcelLinkView } from './linkModel';

const START = Date.parse('2026-10-02T08:00:00Z');
const DAY = 86_400_000;

function demo(storage: Storage | null = window.localStorage) {
  const clock = { now: START };
  return { clock, links: createDemoLinks(storage, () => clock.now) };
}

async function read(links: ReturnType<typeof createDemoLinks>, id: string, options?: Parameters<ReturnType<typeof createDemoLinks>['readParcelLink']>[1]): Promise<ParcelLinkView> {
  const view = await links.readParcelLink(id, options);
  if (view === 'unavailable') throw new Error('The link should be readable');
  return view;
}

describe('the device demo backend', () => {
  it('answers a lookup like the server: an id and a key in its formats, and a parcel still to be checked', async () => {
    const { links } = demo();
    const { id, key, view } = await links.lookupParcel({ trackingNumber: ' 1zdemo 2026 0000 0001 ' });
    expect(isParcelLinkId(id)).toBe(true);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(view.link).toMatchObject({ id, role: 'owner', kind: 'lookup', numberShown: true, canKeep: true, createdAt: '2026-10-02T08:00:00.000Z' });
    expect(view.parcel).toMatchObject({ trackingNumber: '1ZDEMO202600000001', carrier: 'ups', label: '', syncStatus: 'pending' });
    expect(view.parcel.events.map((event) => event.stage)).toEqual(['pending']);
    expect(view.numberHint).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(DEMO_LINKS_STORAGE_KEY)!))).toEqual([id]);
  });

  it('tells the carrier’s own story once the first check lands, and a default one for an unknown number', async () => {
    const { links, clock } = demo();
    const ups = await links.lookupParcel({ trackingNumber: '1ZDEMO202600000001' });
    const unknown = await links.lookupParcel({ trackingNumber: 'DEMO0000000001' });
    const chosen = await links.lookupParcel({ trackingNumber: 'DEMO0000000002', carrier: 'dhl' });
    expect((await read(links, ups.id, { key: ups.key })).parcel.syncStatus).toBe('pending');
    clock.now += 1_500;
    const landed = await read(links, ups.id, { key: ups.key });
    expect(landed.parcel).toMatchObject({ carrier: 'ups', syncStatus: 'ok', trackingNumber: '1ZDEMO202600000001' });
    expect(currentStage(landed.parcel.events)).toBe('in_transit');
    expect(new Set(landed.parcel.events.map((event) => event.parcelId))).toEqual(new Set([landed.parcel.id]));
    expect((await read(links, unknown.id, { key: unknown.key })).parcel).toMatchObject({ carrier: 'gls-de', trackingNumber: 'DEMO0000000001' });
    expect((await read(links, chosen.id, { key: chosen.key })).parcel.carrier).toBe('dhl');
    // A number the demo itself uses brings that sample's whole story, without its name.
    const sample = await links.lookupParcel({ trackingNumber: '1234567899' });
    clock.now += 1_500;
    const sneakers = await read(links, sample.id, { key: sample.key });
    expect(sneakers.parcel).toMatchObject({ carrier: 'dhl', label: '', trackingNumber: '1234567899' });
    expect(currentStage(sneakers.parcel.events)).toBe('ready_for_pickup');
  });

  it('moves the story on only when asked to, down to delivery', async () => {
    const { links, clock } = demo();
    const { id, key } = await links.lookupParcel({ trackingNumber: '1ZDEMO202600000001' });
    // A manual check lands the first check at once, without skipping a scan.
    expect(currentStage((await read(links, id, { key, advance: true })).parcel.events)).toBe('in_transit');
    clock.now += 60_000;
    expect(currentStage((await read(links, id, { key })).parcel.events)).toBe('in_transit');
    expect(currentStage((await read(links, id, { key, advance: true })).parcel.events)).toBe('out_for_delivery');
    const delivered = await read(links, id, { key, advance: true });
    expect(currentStage(delivered.parcel.events)).toBe('delivered');
    expect((await read(links, id, { key, advance: true })).parcel.events).toHaveLength(delivered.parcel.events.length);
    // A fresh client reads the same parcel from the same storage: a reload shows what was there.
    expect(currentStage((await read(createDemoLinks(window.localStorage, () => clock.now), id, { key })).parcel.events)).toBe('delivered');
  });

  it('masks the number for anyone without the key', async () => {
    const { links } = demo();
    const { id } = await links.lookupParcel({ trackingNumber: '1ZDEMO202600000001' });
    for (const key of [undefined, null, 'x'.repeat(43)]) {
      const view = await read(links, id, { key });
      expect(view.link).toMatchObject({ role: 'viewer', numberShown: false, canKeep: false });
      expect(view.parcel.trackingNumber).toBe('');
      expect(view.numberHint).toEqual({ head: '', tail: '0001' });
    }
  });

  it('reads an unknown or malformed id as unavailable and forgets only for the key', async () => {
    const { links } = demo();
    const { id, key } = await links.lookupParcel({ trackingNumber: '1234567899' });
    expect(await links.readParcelLink('k7Qm2xHd9RtW')).toBe('unavailable');
    expect(await links.readParcelLink('__proto__')).toBe('unavailable');
    await expect(links.forgetParcelLink(id, 'wrong')).rejects.toMatchObject({ kind: 'unavailable' });
    expect(await links.readParcelLink(id)).not.toBe('unavailable');
    await links.forgetParcelLink(id, key);
    expect(await links.readParcelLink(id, { key })).toBe('unavailable');
    await expect(links.forgetParcelLink(id, key)).rejects.toBeInstanceOf(ParcelLinkError);
  });

  it('forgets like the server: 90 days after the last sign of life, 30 days after delivery', async () => {
    const { links, clock } = demo();
    const quiet = await links.lookupParcel({ trackingNumber: '1ZDEMO202600000001' });
    const done = await links.lookupParcel({ trackingNumber: '1ZDEMO202600000002' });
    await links.readParcelLink(done.id, { key: done.key, advance: true });
    await links.readParcelLink(done.id, { key: done.key, advance: true });
    const delivered = await read(links, done.id, { key: done.key, advance: true });
    expect(currentStage(delivered.parcel.events)).toBe('delivered');
    expect(Date.parse(delivered.link.forgetAt!) - clock.now).toBeLessThanOrEqual(30 * DAY + 5_000);
    expect(Date.parse((await read(links, quiet.id)).link.forgetAt!)).toBe(START + 90 * DAY);
    clock.now = START + 31 * DAY;
    expect(await links.readParcelLink(done.id, { key: done.key })).toBe('unavailable');
    // Opening a link is a sign of life: its forget date moves with it.
    expect(Date.parse((await read(links, quiet.id)).link.forgetAt!)).toBe(START + 121 * DAY);
    clock.now = START + 122 * DAY;
    expect(await links.readParcelLink(quiet.id, { key: quiet.key })).toBe('unavailable');
  });

  it('refuses what is not a tracking number and honours a cancelled request', async () => {
    const { links } = demo();
    for (const trackingNumber of ['', 'abc', 'no digits here', '1'.repeat(41)]) {
      await expect(links.lookupParcel({ trackingNumber })).rejects.toMatchObject({ kind: 'validation', guidance: 'error.trackingNumber' });
    }
    const cancelled = AbortSignal.abort();
    await expect(links.lookupParcel({ trackingNumber: '1234567899' }, cancelled)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(links.readParcelLink('k7Qm2xHd9RtW', { signal: cancelled })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(links.detectCarrierPublic('1234567899', cancelled)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('detects the carrier from the number alone, without a network', async () => {
    const { links } = demo();
    expect(await links.detectCarrierPublic('99 34 111111 22222222')).toEqual({ trackingNumber: '993411111122222222', carrier: 'swiss-post' });
  });

  it('keeps working for the life of the page when storage is unusable', async () => {
    const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } as unknown as Storage;
    for (const storage of [null, broken]) {
      const { links } = demo(storage);
      const { id, key } = await links.lookupParcel({ trackingNumber: '1234567899' });
      expect((await read(links, id, { key })).link.role).toBe('owner');
      await links.forgetParcelLink(id, key);
      expect(await links.readParcelLink(id)).toBe('unavailable');
    }
    localStorage.setItem(DEMO_LINKS_STORAGE_KEY, '[not an object');
    expect(await demo().links.readParcelLink('k7Qm2xHd9RtW')).toBe('unavailable');
  });
});
