import { isActiveParcel } from './parcelPriority';
import { isDelivered } from './stages';
import type { ParcelWithEvents } from '../types';

/**
 * The parcels the list last showed on their way that have since been delivered, as the
 * list showed them: each keeps that place until its card leaves for the past deliveries.
 */
export function justDelivered(shown: ParcelWithEvents[], parcels: ParcelWithEvents[]): ParcelWithEvents[] {
  const now = new Map(parcels.map((parcel) => [parcel.id, parcel]));
  return shown.filter((was) => {
    const parcel = now.get(was.id);
    return parcel !== undefined && isActiveParcel(was) && !parcel.archivedAt && isDelivered(parcel.events);
  });
}
