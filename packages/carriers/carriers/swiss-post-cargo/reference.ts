import { NotFoundError, SchemaError } from '../../core/errors';

const DAY_MS = 24 * 3_600_000;
/** The pieces of one consignment are announced and picked up together. */
const CONSIGNMENT_SPREAD_MS = DAY_MS;
/** Carrier recognition's window: a shipment quiet this long is an older one reusing the reference. */
const CURRENT_MS = 60 * DAY_MS;

/**
 * The barcodes an eos customer reference (`Type: 2`) stands for in a parcel.
 *
 * Shippers reuse references, so an answer can list unrelated shipments years
 * apart; the official tracker shows each barcode on its own behind a filter. A
 * parcel needs one consignment: the barcodes first scanned within a day of the
 * newest one, read only when they have a scan from the last 60 days and no
 * other barcode does. Any other answer names no single current shipment and is
 * a not-found. `scanTimes` gives one instant per history row, NaN when the row's
 * time cannot be read; barcodes without a dated scan cannot be placed and are
 * dropped.
 */
export function referenceConsignment<T>(
  shipments: readonly T[],
  scanTimes: (shipment: T) => number[],
  provider: string,
  now: number,
): T[] {
  const scanned = shipments.map((shipment) => ({ shipment, times: scanTimes(shipment) }));
  const timelines = scanned.flatMap(({ shipment, times }) => {
    const dated = times.filter(Number.isFinite);
    if (dated.length === 0) return [];
    return [{
      shipment,
      first: dated.reduce((earliest, time) => Math.min(earliest, time)),
      last: dated.reduce((latest, time) => Math.max(latest, time)),
    }];
  });
  if (timelines.length === 0) {
    if (scanned.some(({ times }) => times.length > 0)) {
      throw new SchemaError(provider, `${provider} returned reference scans without a readable time`);
    }
    throw new NotFoundError(provider, `${provider} has no scans for this reference yet`);
  }
  const newest = timelines.reduce((latest, timeline) => Math.max(latest, timeline.first), Number.NEGATIVE_INFINITY);
  const joins = (timeline: { first: number }) => newest - timeline.first <= CONSIGNMENT_SPREAD_MS;
  const current = (timeline: { last: number }) => now - timeline.last < CURRENT_MS;
  const consignment = timelines.filter(joins);
  if (!consignment.some(current)) {
    throw new NotFoundError(provider, `${provider} only has older shipments for this reference`);
  }
  if (timelines.some((timeline) => !joins(timeline) && current(timeline))) {
    throw new NotFoundError(provider, `${provider} has several shipments for this reference`);
  }
  return consignment.map((timeline) => timeline.shipment);
}
