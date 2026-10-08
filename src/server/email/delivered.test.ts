// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CarrierId, EventPlace, ParcelWithEvents, TrackingEvent } from '../../types';
import { deliveredScan, deliveredWhen } from './delivered';

function scan(occurredAt: string, extra: Partial<TrackingEvent> = {}): TrackingEvent {
  return { id: occurredAt, parcelId: 'p', stage: 'delivered', description: 'Delivered', occurredAt, ...extra };
}

function parcel(carrier: CarrierId, events: TrackingEvent[], extra: Partial<ParcelWithEvents> = {}): ParcelWithEvents {
  return { id: 'p', trackingNumber: '', label: '', carrier, createdAt: '2026-09-28T08:00:00Z', syncStatus: 'ok', events, ...extra };
}

const place = (country: string): EventPlace => ({ latitude: 0, longitude: 0, precision: 'city', country, name: 'Exampletown' });
const reader = { timezone: 'Europe/Zurich', now: new Date('2026-10-03T15:00:00Z'), languageTag: 'en-CH' };

describe('deliveredScan', () => {
  it('is the newest scan that says delivered', () => {
    const events = [
      scan('2026-10-01T09:00:00Z'),
      scan('2026-10-03T12:12:00Z'),
      scan('2026-10-03T13:00:00Z', { stage: 'in_transit' }),
    ];
    expect(deliveredScan(parcel('dhl', events))?.occurredAt).toBe('2026-10-03T12:12:00Z');
    expect(deliveredScan(parcel('dhl', [scan('2026-10-03T13:00:00Z', { stage: 'in_transit' })]))).toBeNull();
  });

  it('is the newest scan of the stage it is asked for', () => {
    const events = [
      scan('2026-10-02T10:00:00Z', { stage: 'ready_for_pickup' }),
      scan('2026-10-03T09:30:00Z', { stage: 'ready_for_pickup' }),
      scan('2026-10-03T12:12:00Z'),
    ];
    expect(deliveredScan(parcel('dhl', events), 'ready_for_pickup')?.occurredAt).toBe('2026-10-03T09:30:00Z');
    expect(deliveredScan(parcel('dhl', events.slice(0, 2)))).toBeNull();
    expect(deliveredWhen(parcel('dhl', events), { ...reader, stage: 'ready_for_pickup', known: 'timed' })).toEqual({ kind: 'today', time: '11:30' });
  });
});

describe('deliveredWhen, told what the scan knows', () => {
  it('tells a clock time on the reader’s own day', () => {
    const delivered = parcel('dhl', [scan('2026-10-03T12:12:00Z')]);
    expect(deliveredWhen(delivered, { ...reader, known: 'timed' })).toEqual({ kind: 'today', time: '14:12' });
    // Half past midnight in Zürich is still the evening before in New York.
    const late = parcel('dhl', [scan('2026-10-02T22:30:00Z')]);
    expect(deliveredWhen(late, { ...reader, known: 'timed' })).toEqual({ kind: 'today', time: '00:30' });
    expect(deliveredWhen(late, { ...reader, known: 'timed', timezone: 'America/New_York' })).toEqual({ kind: 'yesterday', time: '18:30' });
  });

  it('writes an older day as push notifications write dates', () => {
    const delivered = parcel('dhl', [scan('2026-10-01T07:05:00Z')]);
    expect(deliveredWhen(delivered, { ...reader, known: 'timed' })).toEqual({ kind: 'date', date: '01.10.2026', time: '09:05' });
    expect(deliveredWhen(delivered, { ...reader, known: 'timed', languageTag: 'de-CH' })).toEqual({ kind: 'date', date: '1.10.2026', time: '09:05' });
    expect(deliveredWhen(delivered, { ...reader, known: 'timed', languageTag: 'es-ES' })).toEqual({ kind: 'date', date: '1/10/2026', time: '09:05' });
  });

  it('reads a day without a clock where the carrier’s day began, not where the reader is', () => {
    // DHL's "3 October", stored as that midnight in Berlin: still 2 October in Los Angeles.
    const delivered = parcel('dhl', [scan('2026-10-02T22:00:00+00:00')]);
    expect(deliveredWhen(delivered, { ...reader, known: 'date', timezone: 'America/Los_Angeles' })).toEqual({ kind: 'day', date: '03.10.2026' });
    // The carrier delivering says more than the one the parcel was added with.
    const handedOver = parcel('dhl', [scan('2026-10-02T15:00:00+00:00')], { trackingSource: 'yamato' });
    expect(deliveredWhen(handedOver, { ...reader, known: 'date' })).toEqual({ kind: 'day', date: '03.10.2026' });
    // A carrier without a zone of its own: the scan's country keeps one clock.
    const located = parcel('ups', [scan('2026-10-02T15:00:00+00:00', { place: place('JP') })]);
    expect(deliveredWhen(located, { ...reader, known: 'date' })).toEqual({ kind: 'day', date: '03.10.2026' });
  });

  it('finds the day of a midnight in a zone the parcel does not name', () => {
    // Midnight in Tokyo, for a parcel that only knows Berlin.
    expect(deliveredWhen(parcel('dhl', [scan('2026-10-02T15:00:00+00:00')]), { ...reader, known: 'date' })).toEqual({ kind: 'day', date: '03.10.2026' });
    // 11:00 UTC starts a day eleven hours behind and thirteen ahead: the one nearer the carrier's clock.
    expect(deliveredWhen(parcel('yamato', [scan('2026-10-03T11:00:00+00:00')]), { ...reader, known: 'date' })).toEqual({ kind: 'day', date: '04.10.2026' });
    expect(deliveredWhen(parcel('ups', [scan('2026-10-03T11:00:00+00:00')]), { ...reader, known: 'date' })).toEqual({ kind: 'day', date: '03.10.2026' });
    // No midnight anywhere: the carrier's own day.
    expect(deliveredWhen(parcel('dhl', [scan('2026-10-02T22:07:30+00:00')]), { ...reader, known: 'date' })).toEqual({ kind: 'day', date: '03.10.2026' });
  });

  it('says no time for a delivery the app only noticed', () => {
    expect(deliveredWhen(parcel('dhl', [scan('2026-10-03T12:12:00Z')]), { ...reader, known: 'none' })).toEqual({ kind: 'plain' });
  });

  it('refuses a scan from the future, an unreadable one and a parcel without one', () => {
    expect(deliveredWhen(parcel('dhl', [scan('2026-10-03T15:00:01Z')]), { ...reader, known: 'timed' })).toEqual({ kind: 'plain' });
    expect(deliveredWhen(parcel('dhl', [scan('soon')]), { ...reader, known: 'timed' })).toEqual({ kind: 'plain' });
    expect(deliveredWhen(parcel('dhl', []), { ...reader, known: 'timed' })).toEqual({ kind: 'plain' });
  });

  it('falls back to Zürich for a time zone that does not exist, as push does', () => {
    const delivered = parcel('dhl', [scan('2026-10-03T12:12:00Z')]);
    expect(deliveredWhen(delivered, { ...reader, known: 'timed', timezone: 'Mars/Olympus' })).toEqual({ kind: 'today', time: '14:12' });
  });
});

describe('deliveredWhen, judging the scan itself', () => {
  it('takes a whole-second time as the carrier’s clock', () => {
    expect(deliveredWhen(parcel('dhl', [scan('2026-10-03T12:12:00+00:00')]), reader)).toEqual({ kind: 'today', time: '14:12' });
    expect(deliveredWhen(parcel('dhl', [scan('2026-10-02T12:12:31+00:00')]), reader)).toEqual({ kind: 'yesterday', time: '14:12' });
  });

  it('takes midnight sharp in one of the parcel’s zones as a day without a clock', () => {
    // Berlin for DHL, UTC for a carrier without a zone, Tokyo for a scan in Japan.
    expect(deliveredWhen(parcel('dhl', [scan('2026-10-02T22:00:00+00:00')]), reader)).toEqual({ kind: 'day', date: '03.10.2026' });
    expect(deliveredWhen(parcel('ups', [scan('2026-10-03T00:00:00+00:00')]), reader)).toEqual({ kind: 'day', date: '03.10.2026' });
    expect(deliveredWhen(parcel('ups', [scan('2026-10-02T15:00:00+00:00', { place: place('JP') })]), reader)).toEqual({ kind: 'day', date: '03.10.2026' });
    // The same instant is an afternoon scan for a parcel that never left Europe.
    expect(deliveredWhen(parcel('dhl', [scan('2026-10-02T15:00:00+00:00')]), reader)).toEqual({ kind: 'yesterday', time: '17:00' });
  });

  it('takes a time with a fraction of a second as the moment the app noticed', () => {
    expect(deliveredWhen(parcel('dhl', [scan('2026-10-03T12:12:34.567+00:00')]), reader)).toEqual({ kind: 'plain' });
  });

  it('survives a carrier the catalog does not know', () => {
    const delivered = parcel('no-such-carrier' as CarrierId, [scan('2026-10-03T12:12:00+00:00')]);
    expect(deliveredWhen(delivered, reader)).toEqual({ kind: 'today', time: '14:12' });
  });
});
