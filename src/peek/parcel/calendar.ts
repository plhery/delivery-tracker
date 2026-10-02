import { parcelDeliveryEstimate } from '../../lib/parcelStatus';
import type { ParcelWithEvents } from '../../types';

/**
 * When a parcel is expected, for a calendar: a whole day when the carrier
 * gave only a date, else a window. `floating` times are the carrier's
 * wall-clock times without a zone: the calendar reads them as local.
 */
export type DeliverySlot =
  | { kind: 'day'; date: string }
  | { kind: 'window'; start: string; end: string; floating: boolean };

/** A point estimate is "by then": the calendar gets the hour before it. */
const POINT_MS = 3_600_000;
const pad = (value: number) => String(value).padStart(2, '0');
const digits = (value: string) => value.replace(/\D/g, '');

function utc(time: number): string {
  const date = new Date(time);
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/** A wall-clock time one hour earlier, staying on its day. */
function hourBefore(clock: string): string {
  const [hours, minutes] = clock.split(':').map(Number);
  return hours < 1 ? '00:00' : `${pad(hours - 1)}:${pad(minutes)}`;
}

/** The calendar slot of a parcel's delivery estimate, or null when there is none worth a calendar entry. */
export function deliverySlot(parcel: ParcelWithEvents, now = Date.now()): DeliverySlot | null {
  const estimate = parcelDeliveryEstimate(parcel, now)?.trim();
  if (!estimate) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(estimate)) return { kind: 'day', date: digits(estimate) };
  // "2026-10-02 13:00–17:00": the carrier's own clock, with no zone to convert from.
  const wall = /^(\d{4}-\d{2}-\d{2})[ T]+(\d{2}:\d{2})(?:[–-](\d{2}:\d{2}))?$/.exec(estimate);
  if (wall) {
    const [, day, first, second] = wall;
    const [start, end] = second ? [first, second] : [hourBefore(first), first];
    return { kind: 'window', start: `${digits(day)}T${digits(start)}00`, end: `${digits(day)}T${digits(end)}00`, floating: true };
  }
  const end = Date.parse(estimate);
  if (!Number.isFinite(end)) return null;
  // A time without a zone is the carrier's wall clock too.
  const from = parcel.expectedDeliveryFrom ? Date.parse(parcel.expectedDeliveryFrom) : Number.NaN;
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(estimate)) {
    const [day, clock] = [estimate.slice(0, 10), estimate.slice(11, 16)];
    const earlier = parcel.expectedDeliveryFrom?.trim() ?? '';
    const opens = Number.isFinite(from) && from < end && earlier.startsWith(`${day}T`) ? earlier.slice(11, 16) : hourBefore(clock);
    return { kind: 'window', start: `${digits(day)}T${digits(opens)}00`, end: `${digits(day)}T${digits(clock)}00`, floating: true };
  }
  const start = Number.isFinite(from) && from < end ? from : end - POINT_MS;
  return { kind: 'window', start: utc(start), end: utc(end), floating: false };
}

/** Text as RFC 5545 wants it: backslashes, separators and line breaks escaped. */
export function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Lines of at most 75 octets, continued with a leading space, never splitting a character. */
function folded(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = '';
  let size = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (size + width > 75) {
      lines.push(current);
      current = ' ';
      size = 1;
    }
    current += character;
    size += width;
  }
  lines.push(current);
  return lines.join('\r\n');
}

/** The day after a `YYYYMMDD` date: an all-day event ends where the next day starts. */
function nextDay(date: string): string {
  const next = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)) + 1));
  return `${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`;
}

/**
 * A calendar file for one delivery, made in the browser: nothing is sent
 * anywhere. `url` is the parcel's own link; `uid` keeps a later download of
 * the same parcel from making a second entry.
 */
export function deliveryCalendar({ slot, title, description, url, uid, now = Date.now() }: {
  slot: DeliverySlot;
  title: string;
  description?: string;
  url: string;
  uid: string;
  now?: number;
}): string {
  const when = slot.kind === 'day'
    ? [`DTSTART;VALUE=DATE:${slot.date}`, `DTEND;VALUE=DATE:${nextDay(slot.date)}`]
    : [`DTSTART:${slot.start}`, `DTEND:${slot.end}`];
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Peek//Universal Parcel Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsText(uid)}`,
    `DTSTAMP:${utc(now)}`,
    ...when,
    `SUMMARY:${icsText(title)}`,
    ...(description ? [`DESCRIPTION:${icsText(description)}`] : []),
    `URL:${url}`,
    // A delivery does not keep anyone busy.
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
    'END:VCALENDAR',
  ].map(folded).join('\r\n') + '\r\n';
}

/** Hands a calendar file to the browser, which opens or saves it. Says whether it could. */
export function downloadCalendar(calendar: string, filename = 'peek-delivery.ics'): boolean {
  try {
    const address = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = address;
    link.download = filename;
    link.rel = 'noopener';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(address), 30_000);
    return true;
  } catch {
    return false;
  }
}
