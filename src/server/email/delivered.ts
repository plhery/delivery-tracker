import 'server-only';

import { DateTime, IANAZone } from 'luxon';
import { countryTimeZone } from 'universal-parcel-scraper';
import { sortEventsDesc } from '../../lib/stages';
import type { ParcelWithEvents, TrackingEvent } from '../../types';
import { carrierTimezone } from '../carriers';
import type { DeliveredTime, EmailStage } from './types';

/**
 * When a parcel was delivered, or reached its pickup point, as much as the
 * email may say of it: the clock time on the reader's own day, an older date
 * with its time, a day alone for a scan without a clock, or nothing.
 */
export type DeliveredWhen =
  | { kind: 'today' | 'yesterday'; time: string }
  | { kind: 'date'; date: string; time: string }
  | { kind: 'day'; date: string }
  | { kind: 'plain' };

/**
 * The scan the email tells of, delivered or ready to collect: the newest one,
 * as the app orders scans. A relay copy gives way to the scan it repeats,
 * which is served with it.
 */
export function deliveredScan(parcel: ParcelWithEvents, stage: EmailStage = 'delivered'): TrackingEvent | null {
  return sortEventsDesc(parcel.events.filter((event) => event.stage === stage && !event.relayOf))[0] ?? null;
}

/**
 * The zones a scan's carrier time may have been read in, likeliest first: the
 * carrier delivering, the one the parcel was added with, and the country the
 * scan happened in when it keeps one clock. A carrier without a zone of its
 * own is read in UTC.
 */
function scanZones(parcel: ParcelWithEvents, scan: TrackingEvent): string[] {
  const zones = [parcel.trackingSource, parcel.carrier].map((carrier) => {
    try {
      return carrier ? carrierTimezone(carrier) : null;
    } catch {
      return null;
    }
  });
  return [...new Set([...zones, countryTimeZone(scan.place?.country), 'UTC'])].filter((zone): zone is string => !!zone && IANAZone.isValidZone(zone));
}

const startsDay = (local: DateTime) => local.isValid && local.toMillis() === local.startOf('day').toMillis();

/**
 * The day of a scan that carries no clock. Such a scan is stored as the
 * midnight that starts its day, in the zone its carrier's times are read in:
 * the day is read back there. When none of the parcel's zones has midnight at
 * that instant, it is read where a day does start then, nearest the carrier's
 * own clock.
 */
function scanDay(at: DateTime, zones: readonly string[]): DateTime {
  const home = at.setZone(zones[0]);
  const local = zones.map((zone) => at.setZone(zone)).find(startsDay);
  if (local) return local;
  const sinceMidnight = at.toUTC().diff(at.toUTC().startOf('day')).as('minutes');
  // Clocks run from twelve hours behind UTC to fourteen ahead, on the quarter hour.
  const offsets = [-sinceMidnight, 1440 - sinceMidnight].filter((offset) => offset % 15 === 0 && offset >= -720 && offset <= 840)
    .sort((a, b) => Math.abs(a - home.offset) - Math.abs(b - home.offset));
  return offsets.length ? at.toUTC(offsets[0]) : home;
}

/**
 * What a scan knows of its time when nobody says: a scan at midnight sharp in
 * one of its parcel's zones carries a day only, and one stamped to a fraction
 * of a second is the moment the app noticed the delivery, since carriers'
 * times are whole seconds. Anything else is the carrier's clock.
 */
function guessedTime(at: DateTime, zones: readonly string[]): DeliveredTime {
  if (zones.some((zone) => startsDay(at.setZone(zone)))) return 'date';
  return at.millisecond ? 'none' : 'timed';
}

/**
 * When the parcel was delivered, or reached its pickup point when `stage` says
 * so, for a reader in `timezone` at `now`. `known` is what the sender read in
 * the carrier's own data; left out, the scan is judged by its timestamp. A
 * scan later than `now`, or without a readable time, says nothing. Dates are
 * written as push notifications write them.
 */
export function deliveredWhen(parcel: ParcelWithEvents, { stage = 'delivered', known, timezone, now, languageTag }: {
  stage?: EmailStage;
  known?: DeliveredTime;
  timezone: string;
  now: Date;
  languageTag: string;
}): DeliveredWhen {
  const scan = deliveredScan(parcel, stage);
  const at = scan ? DateTime.fromISO(scan.occurredAt, { setZone: true }) : null;
  if (!scan || !at?.isValid || at.toMillis() > now.getTime()) return { kind: 'plain' };
  const zones = scanZones(parcel, scan);
  const time = known ?? guessedTime(at, zones);
  const written = (day: DateTime) => day.setLocale(languageTag).toLocaleString(DateTime.DATE_SHORT);
  if (time === 'none') return { kind: 'plain' };
  if (time === 'date') return { kind: 'day', date: written(scanDay(at, zones)) };
  const zone = IANAZone.isValidZone(timezone) ? timezone : 'Europe/Zurich';
  const delivered = at.setZone(zone);
  const today = DateTime.fromJSDate(now, { zone });
  const clock = delivered.toFormat('HH:mm');
  if (delivered.hasSame(today, 'day')) return { kind: 'today', time: clock };
  if (delivered.hasSame(today.minus({ days: 1 }), 'day')) return { kind: 'yesterday', time: clock };
  return { kind: 'date', date: written(delivered), time: clock };
}
