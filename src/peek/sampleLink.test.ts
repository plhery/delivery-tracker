import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { currentStage } from '../lib/stages';
import { linkNote, noteLink } from './deviceNotes';
import { readParcelLink, removeParcelAlert, setParcelAlert, startSample } from './links';
import { RECENTS_STORAGE_KEY } from './recents';
import { SAMPLE_LINK_ID } from './sample';
import { readSampleLink, restartSample } from './sampleLink';

const START = Date.parse('2026-10-02T08:00:00Z');

beforeEach(() => { restartSample(); });
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the sample parcel', () => {
  it('reads as a looked-up parcel on its way, that can be looked at and never kept', async () => {
    const { link, parcel, numberHint } = await readSampleLink({}, START);
    expect(link).toMatchObject({ id: SAMPLE_LINK_ID, role: 'owner', kind: 'lookup', numberShown: true, canKeep: false, forgetAt: null, gift: false, shared: true });
    // No push service stands behind it.
    expect(link.alerts).toEqual({ available: true, vapidPublicKey: null });
    expect(parcel).toMatchObject({ trackingNumber: 'DEMOGLS20260001', carrier: 'gls-de', label: 'Moon lamp 🌙', syncStatus: 'ok', lastSyncedAt: '2026-10-02T08:00:00.000Z' });
    expect(currentStage(parcel.events)).toBe('in_transit');
    expect(parcel.events.every((event) => event.parcelId === SAMPLE_LINK_ID)).toBe(true);
    expect(parcel.expectedDelivery).toBeTruthy();
    expect(numberHint).toBeNull();
  });

  it('tells one story for as long as the page lives, which a check moves on, scan by scan, to its delivery', async () => {
    const first = await readSampleLink({}, START);
    const again = await readSampleLink({}, START + 30_000);
    // Reading again brings no new scan: only the moment it was checked moves.
    expect(again.parcel.events).toEqual(first.parcel.events);
    expect(again.parcel.lastSyncedAt).toBe('2026-10-02T08:00:30.000Z');

    const out = await readSampleLink({ advance: true }, START + 60_000);
    expect(currentStage(out.parcel.events)).toBe('out_for_delivery');
    expect(out.parcel.events.slice(0, first.parcel.events.length)).toEqual(first.parcel.events);
    expect(out.parcel.events.at(-1)).toMatchObject({ parcelId: SAMPLE_LINK_ID, description: 'With the courier for delivery today', occurredAt: '2026-10-02T08:01:00.000Z' });
    const delivered = await readSampleLink({ advance: true }, START + 60_000);
    expect(currentStage(delivered.parcel.events)).toBe('delivered');
    // Two checks in the same instant still tell their scans in order.
    expect(delivered.parcel.events.at(-1)!.occurredAt).toBe('2026-10-02T08:01:01.000Z');
    // The journey is over: a check has nothing to add.
    expect((await readSampleLink({ advance: true }, START + 120_000)).parcel.events).toHaveLength(delivered.parcel.events.length);

    restartSample();
    const fresh = await readSampleLink({}, START + 180_000);
    expect(currentStage(fresh.parcel.events)).toBe('in_transit');
    expect(fresh.parcel.events).toHaveLength(first.parcel.events.length);
  });

  it('is told in the reader’s language, the scans a check brings included', async () => {
    const french = await readSampleLink({ advance: true, locale: 'fr' }, START);
    expect(french.parcel.label).toBe('Lampe lune 🌙');
    expect(french.parcel.events.map((event) => event.description)).toContain('A quitté le centre de tri. Pleine lune attendue bientôt.');
    expect(french.parcel.events.at(-1)!.description).not.toBe('With the courier for delivery today');
    // The same story in another language: the scans are the same ones.
    const english = await readSampleLink({}, START);
    expect(english.parcel.label).toBe('Moon lamp 🌙');
    expect(english.parcel.events.map((event) => event.id)).toEqual(french.parcel.events.map((event) => event.id));
  });

  it('gives up a read that was called off', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readSampleLink({ signal: controller.signal })).rejects.toThrow();
  });

  it('is read through the links like any parcel, without a server and without a trace on the device', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const sample = await startSample('de');
    expect(sample.link.id).toBe(SAMPLE_LINK_ID);
    expect(sample.parcel.label).toBe('Mondlampe 🌙');
    const moved = await readParcelLink(SAMPLE_LINK_ID, { advance: true });
    expect(moved).not.toBe('unavailable');
    expect(moved !== 'unavailable' && currentStage(moved.parcel.events)).toBe('out_for_delivery');
    // Opening the sample again starts its story over.
    expect(currentStage((await startSample('en')).parcel.events)).toBe('in_transit');

    // Its alert is a note of this browser alone.
    const alert = { preset: 'important' as const, endpoint: 'demo:1' };
    await setParcelAlert(SAMPLE_LINK_ID, { subscription: { endpoint: alert.endpoint, keys: { p256dh: 'demo', auth: 'demo' } }, preset: alert.preset, locale: 'en' });
    noteLink(SAMPLE_LINK_ID, { alert });
    expect(linkNote(SAMPLE_LINK_ID).alert).toEqual(alert);
    await removeParcelAlert(SAMPLE_LINK_ID, alert.endpoint);
    noteLink(SAMPLE_LINK_ID, { alert: null });
    expect(linkNote(SAMPLE_LINK_ID).alert).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    expect(localStorage.getItem(RECENTS_STORAGE_KEY)).toBeNull();
  });
});
