import { currentStage } from './stages';
import type { ParcelWithEvents, Stage } from '../types';

import { trackingLocationCountry } from './trackingLocation';
export { trackingLocationCountry as firstScanCountry } from './trackingLocation';

const stageOrder: Stage[] = ['registered', 'accepted', 'in_transit', 'customs', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup', 'delivered', 'returned'];

export interface DeliveryRecord { parcelId: string; label: string; duration: number; deliveredAt: number }

/** Match iOS: the clock starts at a physical scan, never when a parcel is added. */
export function passportStatistics(parcels: readonly ParcelWithEvents[], timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  let deliveredCount = 0;
  let activeCount = 0;
  const records: DeliveryRecord[] = [];
  const countries = new Map<string, number>();
  const deliveredDays = new Map<string, number>();
  const calendar = new Intl.DateTimeFormat('en-US', { timeZone, calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit' });
  let crossBorderCount = 0, domesticDeliveryCount = 0, longWaitDeliveryCount = 0, pickupDeliveryCount = 0, decemberDeliveryCount = 0;
  for (const parcel of parcels) {
    const meaningful = parcel.events.filter((event) => event.stage !== 'pending');
    const dated = meaningful.map((event) => ({ event, date: Date.parse(event.occurredAt) }))
      .filter(({ date }) => Number.isFinite(date))
      .sort((a, b) => a.date - b.date || stageOrder.indexOf(a.event.stage) - stageOrder.indexOf(b.event.stage) || a.event.id.localeCompare(b.event.id));
    const datesAreComplete = dated.length === meaningful.length;
    const stage = datesAreComplete ? dated.at(-1)?.event.stage : currentStage(parcel.events);
    if (stage === 'delivered') deliveredCount += 1;
    if (!parcel.archivedAt && stage !== 'delivered' && stage !== 'returned') activeCount += 1;
    const physical = dated.filter(({ event }) => event.stage !== 'registered');
    const first = physical[0];
    const completion = physical.find(({ event }) => event.stage === 'delivered');
    if (datesAreComplete && stage === 'delivered' && completion) {
      // One completion per parcel, even when the carrier repeats its delivery scan.
      const parts = calendar.formatToParts(completion.date);
      const day = parts.filter(({ type }) => ['year', 'month', 'day'].includes(type)).map(({ value }) => value).join('-');
      deliveredDays.set(day, (deliveredDays.get(day) ?? 0) + 1);
      if (parts.some(({ type, value }) => type === 'month' && value === '12')) decemberDeliveryCount += 1;
      if (physical.some(({ event, date }) => event.stage === 'ready_for_pickup' && date < completion.date)) pickupDeliveryCount += 1;
      const located = physical.filter(({ date }) => date <= completion.date).map(({ event, date }) => ({ country: trackingLocationCountry(event.location), date })).filter(({ country }) => country);
      // Different countries must be observed at different instants; tied scans do not prove travel.
      if (located.some((scan, index) => located.slice(0, index).some((prior) => prior.date < scan.date && prior.country !== scan.country))) crossBorderCount += 1;
    }
    if (!datesAreComplete || !first || !['accepted', 'in_transit'].includes(first.event.stage)) continue;
    const country = trackingLocationCountry(first.event.location);
    if (country) countries.set(country, (countries.get(country) ?? 0) + 1);
    if (stage !== 'delivered' || !completion || completion.date <= first.date) continue;
    if (country && country === trackingLocationCountry(completion.event.location)) domesticDeliveryCount += 1;
    if (completion.date - first.date > 30 * 86400_000) longWaitDeliveryCount += 1;
    records.push({ parcelId: parcel.id, label: parcel.label, duration: completion.date - first.date, deliveredAt: completion.date });
  }
  records.sort((a, b) => a.duration - b.duration || a.parcelId.localeCompare(b.parcelId));
  return {
    crossBorderCount, domesticDeliveryCount, longWaitDeliveryCount, pickupDeliveryCount, decemberDeliveryCount,
    maxDeliveriesInOneDay: Math.max(0, ...deliveredDays.values()),
    deliveredCount, activeCount, carrierCount: new Set(parcels.map((parcel) => parcel.carrier)).size,
    durationSampleCount: records.length,
    averageDeliveryDuration: records.length ? records.reduce((sum, record) => sum + record.duration, 0) / records.length : null,
    fastestDelivery: records[0] ?? null,
    originCountries: [...countries].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
  };
}

export function formatJourneyDuration(duration: number, languageTag: string) {
  const totalMinutes = Math.max(1, Math.floor(duration / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const unit = (value: number, name: 'day' | 'hour' | 'minute') => new Intl.NumberFormat(languageTag, { style: 'unit', unit: name, unitDisplay: 'narrow' }).format(value);
  return days ? [unit(days, 'day'), hours ? unit(hours, 'hour') : ''].filter(Boolean).join(' ')
    : hours ? [unit(hours, 'hour'), minutes ? unit(minutes, 'minute') : ''].filter(Boolean).join(' ')
      : unit(totalMinutes, 'minute');
}
