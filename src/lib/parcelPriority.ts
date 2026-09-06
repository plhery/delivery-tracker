import { currentEvent, currentStage } from './stages';
import { parcelIsUnannounced } from './parcelStatus';
import type { ParcelWithEvents } from '../types';

const DAY = 86_400_000;

export type ParcelAttention =
  | 'sync_error'
  | 'failed_attempt'
  | 'ready_for_pickup'
  | 'customs'
  | 'stalled'
  | 'not_announced';

export interface PrioritizedParcels {
  attention: Array<{ parcel: ParcelWithEvents; reason: ParcelAttention }>;
  arrivingToday: ParcelWithEvents[];
  onTheWay: ParcelWithEvents[];
}

function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function expectedDeliveryDay(value: string | undefined): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[ T])/.exec(value?.trim() ?? '');
  return match?.[1] ?? null;
}

export function parcelAttention(
  parcel: ParcelWithEvents,
  now: number = Date.now(),
): ParcelAttention | null {
  const current = currentEvent(parcel.events);
  switch (current?.stage) {
    case 'failed_attempt': return 'failed_attempt';
    case 'ready_for_pickup': return 'ready_for_pickup';
    case 'customs': return 'customs';
  }
  if (parcel.syncStatus === 'error') return 'sync_error';

  const latestTime = current ? new Date(current.occurredAt).getTime() : NaN;
  if (
    Number.isFinite(latestTime)
    && ['registered', 'accepted', 'in_transit'].includes(current?.stage ?? '')
    && now - latestTime >= 4 * DAY
  ) {
    return 'stalled';
  }

  const created = new Date(parcel.createdAt).getTime();
  if (
    parcelIsUnannounced(parcel)
    && Number.isFinite(created)
    && now - created >= 2 * DAY
  ) {
    return 'not_announced';
  }
  return null;
}

export function compareParcelPriority(
  first: ParcelWithEvents,
  second: ParcelWithEvents,
): number {
  const firstDay = expectedDeliveryDay(first.expectedDelivery) ?? '9999-99-99';
  const secondDay = expectedDeliveryDay(second.expectedDelivery) ?? '9999-99-99';
  if (firstDay !== secondDay) return firstDay.localeCompare(secondDay);
  const firstUpdate = currentEvent(first.events)?.occurredAt ?? first.createdAt;
  const secondUpdate = currentEvent(second.events)?.occurredAt ?? second.createdAt;
  return secondUpdate.localeCompare(firstUpdate);
}

export function prioritizeActiveParcels(
  parcels: ParcelWithEvents[],
  now: number = Date.now(),
  compare: (first: ParcelWithEvents, second: ParcelWithEvents) => number = (
    compareParcelPriority
  ),
): PrioritizedParcels {
  const attention: PrioritizedParcels['attention'] = [];
  const arrivingToday: ParcelWithEvents[] = [];
  const onTheWay: ParcelWithEvents[] = [];
  const today = dateKey(new Date(now));

  for (const parcel of parcels) {
    const reason = parcelAttention(parcel, now);
    if (reason) attention.push({ parcel, reason });
    else if (expectedDeliveryDay(parcel.expectedDelivery) === today) arrivingToday.push(parcel);
    else onTheWay.push(parcel);
  }

  attention.sort((first, second) => compare(first.parcel, second.parcel));
  arrivingToday.sort(compare);
  onTheWay.sort(compare);
  return { attention, arrivingToday, onTheWay };
}

export function isActiveParcel(parcel: ParcelWithEvents): boolean {
  const stage = currentStage(parcel.events);
  return !parcel.archivedAt && (stage === null || (stage !== 'delivered' && stage !== 'returned'));
}

/** A carrier outage must not displace a pickup or delivery happening today. */
export function nextPriorityParcel(parcels: ParcelWithEvents[], now = Date.now()): ParcelWithEvents | null {
  const today = dateKey(new Date(now));
  const urgency = (parcel: ParcelWithEvents) => {
    const reason = parcelAttention(parcel, now);
    if (reason === 'ready_for_pickup' || reason === 'failed_attempt' || reason === 'customs') return 0;
    if (currentStage(parcel.events) === 'out_for_delivery' || expectedDeliveryDay(parcel.expectedDelivery) === today) return 1;
    if (reason === 'stalled' || reason === 'not_announced') return 2;
    return reason === 'sync_error' ? 3 : 4;
  };
  return parcels.filter(isActiveParcel).sort((a, b) => (
    urgency(a) - urgency(b) || compareParcelPriority(a, b)
  ))[0] ?? null;
}
