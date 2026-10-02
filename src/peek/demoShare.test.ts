import { describe, expect, it } from 'vitest';
import { currentStage } from '../lib/stages';
import { testParcel } from '../test/parcelLinks';
import type { EventPlace, Stage, TrackingEvent } from '../types';
import { createDemoLinks, wrappedGiftEvents } from './demoLinks';
import { ParcelLinkError, type ParcelLinkView } from './linkModel';

const START = Date.parse('2026-10-02T08:00:00Z');

function demo() {
  const clock = { now: START };
  return { clock, links: createDemoLinks(window.localStorage, () => clock.now) };
}

/** A lookup whose first check has landed: the demo's sneakers, sent from Germany to Switzerland. */
async function looked(trackingNumber = '1234567899') {
  const { links, clock } = demo();
  const { id, key } = await links.lookupParcel({ trackingNumber });
  clock.now += 1_500;
  const read = async (asOwner: boolean, options: { advance?: boolean; tellStopped?: boolean } = {}) => {
    const view = await links.readParcelLink(id, { key: asOwner ? key : null, ...options });
    if (view === 'unavailable') throw new Error('The link should be readable');
    return view;
  };
  await read(true);
  return { links, clock, id, key, read };
}

const alert = (endpoint: string) => ({ subscription: { endpoint, keys: { p256dh: 'demo', auth: 'demo' } }, preset: 'important' as const, locale: 'en' as const });
const failed = async (operation: Promise<unknown>) => {
  const error = await operation.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(ParcelLinkError);
  return (error as ParcelLinkError).kind;
};

describe('sharing in the device demo', () => {
  it('shows a viewer the number’s ends until the owner shows the number, and tells the owner everything all along', async () => {
    const { links, id, key, read } = await looked();
    const hidden = await read(false);
    expect(hidden.link).toMatchObject({ role: 'viewer', numberShown: false, canKeep: false, gift: false, shared: true, alerts: { available: true, vapidPublicKey: null } });
    expect(hidden.parcel.trackingNumber).toBe('');
    expect(hidden.numberHint).toEqual({ head: '123', tail: '99' });

    const owner = await links.updateParcelLink(id, key, { showNumber: true });
    expect(owner.link).toMatchObject({ role: 'owner', numberShown: true });
    const shown = await read(false);
    expect(shown.link).toMatchObject({ role: 'viewer', numberShown: true, canKeep: true });
    expect(shown.parcel.trackingNumber).toBe('1234567899');
    expect(shown.numberHint).toBeNull();
    await links.updateParcelLink(id, key, { showNumber: false });
    expect((await read(false)).parcel.trackingNumber).toBe('');
  });

  it('changes a link only with its owner key', async () => {
    const { links, id, key } = await looked();
    expect(await failed(links.updateParcelLink(id, 'B'.repeat(43), { gift: true }))).toBe('unavailable');
    expect(await failed(links.updateParcelLink('k7Qm2xHd9RtW', key, { gift: true }))).toBe('unavailable');
    await expect(links.updateParcelLink(id, key, {}, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops sharing: viewers get nothing, the owner still sees the parcel, and sharing again brings it back', async () => {
    const { links, id, key, read } = await looked();
    await links.setParcelAlert(id, alert('demo:viewer'));
    await links.setParcelAlert(id, alert('demo:owner'), key);
    const stopped = await links.updateParcelLink(id, key, { shared: false });
    expect(stopped.link).toMatchObject({ role: 'owner', shared: false });
    expect(await links.readParcelLink(id)).toBe('unavailable');
    expect(await failed(links.readParcelLink(id, { tellStopped: true }))).toBe('stopped');
    expect((await read(true)).link.shared).toBe(false);
    // A viewer cannot turn alerts on for a stopped link; the owner's alert outlived the stop.
    expect(await failed(links.setParcelAlert(id, alert('demo:viewer')))).toBe('stopped');
    await expect(links.setParcelAlert(id, alert('demo:owner'), key)).resolves.toBeUndefined();
    const stored = JSON.parse(localStorage.getItem('sdt.peek.demo.v1')!)[id];
    expect(stored.alerts).toEqual([{ endpoint: 'demo:owner', preset: 'important', owner: true }]);

    await links.updateParcelLink(id, key, { shared: true });
    expect((await read(false)).link).toMatchObject({ role: 'viewer', shared: true });
  });

  it('wraps a gift for its viewer until it is delivered: no sender, no number, and where it comes from only as a country', async () => {
    const { links, id, key, read } = await looked();
    await links.updateParcelLink(id, key, { gift: true, showNumber: true });
    const owner = await read(true);
    expect(owner.link).toMatchObject({ gift: true, numberShown: true });
    expect(owner.parcel.senderName).toBe('Elbe Laufladen');

    const wrapped = await read(false);
    // The number stays masked whatever the link shows otherwise, and a gift cannot be kept before it arrives.
    expect(wrapped.link).toMatchObject({ role: 'viewer', gift: true, numberShown: false, canKeep: false });
    expect(wrapped.parcel).toMatchObject({ trackingNumber: '', label: '', carrier: 'dhl' });
    for (const hidden of ['senderName', 'pickupPoint', 'weightKg', 'dimensionsText', 'lastStatusText'] as const) expect(wrapped.parcel[hidden]).toBeUndefined();
    expect(JSON.stringify(wrapped)).not.toMatch(/Elbe|Hamburg|1234567899/);
    const origin = wrapped.parcel.events.filter((event) => event.description === 'Left the sender');
    expect(origin.length).toBeGreaterThan(0);
    expect(origin.every((event) => event.location === 'DE' && !event.place)).toBe(true);
    expect(wrapped.parcel.events.some((event) => event.stage === 'registered' || event.stage === 'pending')).toBe(false);
    // What follows abroad is told as it is.
    expect(wrapped.parcel.events.some((event) => event.place?.country === 'CH')).toBe(true);
  });

  it('unwraps the gift once it is delivered', async () => {
    const { links, id, key, read } = await looked('DEMOCHOC20260001');
    await links.updateParcelLink(id, key, { gift: true, showNumber: true });
    expect((await read(false)).link.numberShown).toBe(false);
    let view: ParcelLinkView = await read(true);
    for (let step = 0; step < 6 && currentStage(view.parcel.events) !== 'delivered'; step += 1) view = await read(true, { advance: true });
    expect(currentStage(view.parcel.events)).toBe('delivered');
    const opened = await read(false);
    expect(opened.link).toMatchObject({ gift: true, numberShown: true, canKeep: true });
    expect(opened.parcel.trackingNumber).toBe('DEMOCHOC20260001');
    expect(opened.parcel.senderName).toBe(view.parcel.senderName);
    expect(opened.parcel.events).toEqual(view.parcel.events);
  });

  it('remembers who asked for alerts: ten for viewers and ten for the owner, none once the parcel has arrived', async () => {
    const { links, id, key, read } = await looked('DEMOCHOC20260001');
    for (let index = 0; index < 10; index += 1) await links.setParcelAlert(id, alert(`demo:${index}`));
    // The same browser again only changes what it hears about.
    await links.setParcelAlert(id, { ...alert('demo:3'), preset: 'all' });
    expect(await failed(links.setParcelAlert(id, alert('demo:one-too-many')))).toBe('full');
    await expect(links.setParcelAlert(id, alert('demo:owner'), key)).resolves.toBeUndefined();
    await links.removeParcelAlert(id, 'demo:0');
    await links.removeParcelAlert(id, 'demo:never-there');
    await links.removeParcelAlert('k7Qm2xHd9RtW', 'demo:0');
    await expect(links.setParcelAlert(id, alert('demo:now-there-is-room'))).resolves.toBeUndefined();
    expect(await failed(links.setParcelAlert('k7Qm2xHd9RtW', alert('demo:1')))).toBe('unavailable');
    const stored = () => JSON.parse(localStorage.getItem('sdt.peek.demo.v1')!)[id].alerts as { endpoint: string; preset: string }[];
    expect(stored()).toHaveLength(11);
    expect(stored().find((entry) => entry.endpoint === 'demo:3')!.preset).toBe('all');

    let view = await read(true);
    for (let step = 0; step < 6 && currentStage(view.parcel.events) !== 'delivered'; step += 1) view = await read(true, { advance: true });
    await read(true);
    expect(stored()).toEqual([]);
    await links.setParcelAlert(id, alert('demo:too-late'));
    expect(stored()).toEqual([]);
  });
});

describe('sharing a parcel of the demo deliveries', () => {
  const parcel = testParcel({ id: 'demo-parcel-1', label: 'New sneakers', receiverName: 'A private name', dpdPostcode: '9999' }, ['accepted', 'in_transit']);

  it('makes the link on the first share, changes it afterwards, and shows it to anyone as a viewer of a shared link', async () => {
    const { links } = demo();
    expect(await links.accountShare.current(parcel.id)).toBeNull();
    const made = await links.accountShare.share(parcel);
    expect(made).toMatchObject({ showNumber: false, gift: false, createdAt: '2026-10-02T08:00:00.000Z' });
    expect(await links.accountShare.current(parcel.id)).toEqual(made);
    expect(await links.accountShare.share(parcel, { showNumber: true })).toEqual({ ...made, showNumber: true });

    const view = await links.readParcelLink(made.id) as ParcelLinkView;
    expect(view.link).toMatchObject({ role: 'viewer', kind: 'shared', forgetAt: null, numberShown: true, canKeep: true });
    // The name, the recipient and the postcode stay with the deliveries.
    expect(view.parcel).toMatchObject({ trackingNumber: '1234567899', label: '' });
    expect(JSON.stringify(view)).not.toMatch(/sneakers|private name|9999/);
    // Nobody holds a key to a link from an account: it cannot be changed or forgotten from outside.
    expect(await failed(links.updateParcelLink(made.id, 'A'.repeat(43), { shared: false }))).toBe('unavailable');
    expect(await failed(links.forgetParcelLink(made.id, 'A'.repeat(43)))).toBe('unavailable');
  });

  it('stops for good: the old link says it is not shared anymore, and sharing again makes a new one', async () => {
    const { links } = demo();
    const first = await links.accountShare.share(parcel, { gift: true });
    await links.accountShare.stop(parcel.id);
    await links.accountShare.stop('another-parcel');
    expect(await links.accountShare.current(parcel.id)).toBeNull();
    expect(await links.readParcelLink(first.id)).toBe('unavailable');
    expect(await failed(links.readParcelLink(first.id, { tellStopped: true }))).toBe('stopped');
    const second = await links.accountShare.share(parcel);
    expect(second.id).not.toBe(first.id);
    expect(second.gift).toBe(false);
    expect((await links.readParcelLink(second.id) as ParcelLinkView).link.shared).toBe(true);
  });
});

describe('a gift’s journey as its viewer reads it', () => {
  const place = (country: string, name: string): EventPlace => ({ latitude: 1, longitude: 2, precision: 'city', country, name });
  const scan = (id: string, hour: number, stage: Stage, country?: string): TrackingEvent => ({
    id, parcelId: 'p', stage, description: `Scan ${id}`, occurredAt: `2026-10-01T${String(hour).padStart(2, '0')}:00:00.000Z`,
    ...(country ? { location: `Town ${id}, ${country}`, place: place(country, `Town ${id}`) } : {}),
  });
  const told = (events: TrackingEvent[], destination: string | null) => wrappedGiftEvents(events, destination)
    .map((event) => `${event.id}:${event.description === 'Left the sender' ? `blurred@${event.location ?? '-'}` : 'shown'}`);

  it('blurs everything scanned in the country of origin once the parcel crosses a border', () => {
    const journey = [scan('a', 8, 'registered'), scan('b', 9, 'accepted', 'DE'), scan('c', 10, 'in_transit'), scan('d', 11, 'in_transit', 'DE'),
      scan('e', 12, 'customs', 'CH'), scan('f', 13, 'in_transit'), scan('g', 14, 'out_for_delivery', 'CH')];
    expect(told(journey, null)).toEqual(['b:blurred@DE', 'c:blurred@DE', 'd:blurred@DE', 'e:shown', 'f:shown', 'g:shown']);
    // A blurred scan keeps its time and stage, and nothing of its place.
    expect(wrappedGiftEvents(journey, null)[0]).toEqual({ id: 'b', parcelId: 'p', stage: 'accepted', occurredAt: '2026-10-01T09:00:00.000Z', description: 'Left the sender', location: 'DE' });
  });

  it('blurs a journey still in its country of origin when it is bound for another one', () => {
    const journey = [scan('a', 9, 'accepted', 'DE'), scan('b', 10, 'in_transit'), scan('c', 11, 'in_transit', 'DE')];
    expect(told(journey, 'CH')).toEqual(['a:blurred@DE', 'b:blurred@DE', 'c:blurred@DE']);
    expect(told(journey, 'DE')).toEqual(['a:blurred@DE', 'b:shown', 'c:shown']);
  });

  it('blurs only the hand-over on a journey within one country, or with no place at all', () => {
    expect(told([scan('a', 9, 'accepted', 'CH'), scan('b', 10, 'in_transit', 'CH'), scan('c', 11, 'out_for_delivery', 'CH')], null))
      .toEqual(['a:blurred@CH', 'b:shown', 'c:shown']);
    expect(told([scan('a', 8, 'pending'), scan('b', 9, 'accepted'), scan('c', 10, 'in_transit')], null)).toEqual(['b:blurred@-', 'c:shown']);
  });
});
