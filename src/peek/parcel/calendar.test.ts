import { afterEach, describe, expect, it, vi } from 'vitest';
import { LINK_ID, testParcel } from '../../test/parcelLinks';
import { deliveryCalendar, deliverySlot, downloadCalendar, icsText } from './calendar';

// Noon, local time, on a day the estimates below are on or after.
const NOW = new Date(2026, 9, 2, 12, 0, 0).getTime();
const parcel = (expectedDelivery: string | undefined, expectedDeliveryFrom?: string) =>
  testParcel({ expectedDelivery, expectedDeliveryFrom }, ['accepted', 'in_transit']);
const lines = (calendar: string) => calendar.split('\r\n');
const calendar = (slot: NonNullable<ReturnType<typeof deliverySlot>>, title = 'New sneakers') =>
  deliveryCalendar({ slot, title, description: 'Follow it on Peek.', url: `https://peek.example/p/${LINK_ID}`, uid: `${LINK_ID}@peek`, now: Date.UTC(2026, 9, 2, 10, 0, 0) });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('the delivery slot of an estimate', () => {
  it('is a whole day when the carrier gave only a date', () => {
    expect(deliverySlot(parcel('2026-10-05'), NOW)).toEqual({ kind: 'day', date: '20261005' });
  });

  it('is the carrier’s own window, without a zone, when the estimate is a wall-clock one', () => {
    expect(deliverySlot(parcel('2026-10-02 13:00–17:00'), NOW)).toEqual({ kind: 'window', start: '20261002T130000', end: '20261002T170000', floating: true });
    expect(deliverySlot(parcel('2026-10-02 13:00-17:00'), NOW)).toMatchObject({ start: '20261002T130000', end: '20261002T170000' });
    // "By 17:00" is the hour before it; an early-morning one stays on its day.
    expect(deliverySlot(parcel('2026-10-03 17:00'), NOW)).toMatchObject({ start: '20261003T160000', end: '20261003T170000', floating: true });
    expect(deliverySlot(parcel('2026-10-03 00:30'), NOW)).toMatchObject({ start: '20261003T000000', end: '20261003T003000' });
    expect(deliverySlot(parcel('2026-10-03T17:00:00', '2026-10-03T14:30:00'), NOW)).toEqual({ kind: 'window', start: '20261003T143000', end: '20261003T170000', floating: true });
    expect(deliverySlot(parcel('2026-10-03T17:00:00'), NOW)).toMatchObject({ start: '20261003T160000', end: '20261003T170000', floating: true });
  });

  it('is a moment in universal time when the estimate names its zone', () => {
    expect(deliverySlot(parcel('2026-10-03T17:00:00+02:00', '2026-10-03T13:00:00+02:00'), NOW))
      .toEqual({ kind: 'window', start: '20261003T110000Z', end: '20261003T150000Z', floating: false });
    expect(deliverySlot(parcel('2026-10-03T15:00:00Z'), NOW)).toEqual({ kind: 'window', start: '20261003T140000Z', end: '20261003T150000Z', floating: false });
    // A window that crosses midnight in universal time keeps both of its days.
    expect(deliverySlot(parcel('2026-10-04T01:30:00+09:00', '2026-10-03T22:00:00+09:00'), NOW))
      .toMatchObject({ start: '20261003T130000Z', end: '20261003T163000Z' });
    // A start that is not before the end is no window.
    expect(deliverySlot(parcel('2026-10-03T15:00:00Z', '2026-10-03T18:00:00Z'), NOW)).toMatchObject({ start: '20261003T140000Z' });
  });

  it('is nothing without an estimate that still helps', () => {
    expect(deliverySlot(parcel(undefined), NOW)).toBeNull();
    expect(deliverySlot(parcel('soon'), NOW)).toBeNull();
    expect(deliverySlot(parcel('2026-09-30'), NOW)).toBeNull();
    expect(deliverySlot(testParcel({ expectedDelivery: '2026-10-05' }, ['in_transit', 'delivered']), NOW)).toBeNull();
  });
});

describe('the calendar file', () => {
  it('holds one all-day event for a date, ending where the next day starts', () => {
    const file = lines(calendar({ kind: 'day', date: '20261231' }));
    expect(file.slice(0, 6)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Peek//Universal Parcel Tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT']);
    expect(file).toContain('DTSTART;VALUE=DATE:20261231');
    expect(file).toContain('DTEND;VALUE=DATE:20270101');
    expect(file).toContain(`UID:${LINK_ID}@peek`);
    expect(file).toContain('DTSTAMP:20261002T100000Z');
    expect(file).toContain('SUMMARY:New sneakers');
    expect(file).toContain('DESCRIPTION:Follow it on Peek.');
    expect(file).toContain(`URL:https://peek.example/p/${LINK_ID}`);
    expect(file.slice(-3)).toEqual(['END:VEVENT', 'END:VCALENDAR', '']);
  });

  it('holds a window as local times, or as universal ones', () => {
    expect(lines(calendar({ kind: 'window', start: '20261002T130000', end: '20261002T170000', floating: true })))
      .toEqual(expect.arrayContaining(['DTSTART:20261002T130000', 'DTEND:20261002T170000']));
    expect(lines(calendar({ kind: 'window', start: '20261003T110000Z', end: '20261003T150000Z', floating: false })))
      .toEqual(expect.arrayContaining(['DTSTART:20261003T110000Z', 'DTEND:20261003T150000Z']));
  });

  it('escapes what a name may contain, and folds long lines without splitting a character', () => {
    expect(icsText('Shoes; socks, laces\\more\nsecond line\r\nthird')).toBe('Shoes\\; socks\\, laces\\\\more\\nsecond line\\nthird');
    const title = `Geschenk für Mélanie 🎁, ${'sehr '.repeat(20)}lang; wirklich`;
    const file = calendar({ kind: 'day', date: '20261005' }, title);
    const encoder = new TextEncoder();
    for (const line of lines(file)) expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    // Unfolded, the summary is the escaped title again.
    const unfolded = file.replace(/\r\n /g, '');
    expect(unfolded).toContain(`SUMMARY:${icsText(title)}\r\n`);
    expect(unfolded).not.toContain('�');
    expect(file).not.toMatch(/[^\r]\n/);
  });
});

describe('handing the file to the browser', () => {
  it('downloads it as a calendar file and cleans up after itself', () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    const create = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:calendar'; });
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { clicked.push(this); });
    expect(downloadCalendar('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(blobs[0].type).toBe('text/calendar;charset=utf-8');
    expect(clicked[0]).toMatchObject({ download: 'peek-delivery.ics', href: 'blob:calendar' });
    expect(document.querySelector('a[download]')).toBeNull();
    vi.advanceTimersByTime(30_000);
    expect(revoke).toHaveBeenCalledWith('blob:calendar');
  });

  it('says when the browser cannot', () => {
    Object.assign(URL, { createObjectURL: () => { throw new Error('unsupported'); } });
    expect(downloadCalendar('BEGIN:VCALENDAR')).toBe(false);
  });
});
