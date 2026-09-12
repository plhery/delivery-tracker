/**
 * GLS France status codes.
 *
 * The public consignee endpoint reports letter codes and no human wording:
 * `statutEvenement` and `typeEvenement` on every event, `statutColis` on the
 * parcel. This map is therefore the only status source for the adapter, and the
 * English descriptions below are ours, not GLS's. A code that is not listed
 * stays unmapped: the adapter emits the event without a stage and the sync
 * classifies and records it for review.
 */
import type { CarrierStatus } from '../../core/result';
import { cleanScalar } from '../../core/transport';
import type { Stage } from '../../generated/catalog';

export interface GLSFranceStatusMetadata {
  status: CarrierStatus;
  stage: Stage;
  description: string;
}

/**
 * GLS's frontend treats DEL as a rescheduled delay by default. It only marks
 * the parcel as failed when the newest event has typeEvenement=LIV.
 */
export const DELAYED_DELIVERY: GLSFranceStatusMetadata = {
  status: 'in_transit',
  stage: 'in_transit',
  description: 'Delivery delayed',
};
export const FAILED_DELAYED_DELIVERY: GLSFranceStatusMetadata = {
  status: 'exception',
  stage: 'failed_attempt',
  description: 'Delivery delayed',
};

export const GLS_FRANCE_STATUSES = new Map<string, GLSFranceStatusMetadata>([
  ['CON', { status: 'pending', stage: 'registered', description: 'Shipment information received' }],
  ['REC', { status: 'in_transit', stage: 'accepted', description: 'Parcel received at GLS depot' }],
  ['EXP', { status: 'in_transit', stage: 'in_transit', description: 'Parcel in transit' }],
  ['PBC', { status: 'in_transit', stage: 'in_transit', description: 'Parcel in transit' }],
  ['DOU', { status: 'in_transit', stage: 'customs', description: 'Parcel in customs clearance' }],
  ['TRV', { status: 'out_for_delivery', stage: 'out_for_delivery', description: 'Out for delivery' }],
  ['LIV', { status: 'delivered', stage: 'delivered', description: 'Delivered' }],
  ['LTV', { status: 'delivered', stage: 'delivered', description: 'Delivered' }],
  ['LTL', { status: 'delivered', stage: 'delivered', description: 'Delivered' }],
  ['LIL', { status: 'delivered', stage: 'delivered', description: 'Delivered' }],
  ['LIT', { status: 'delivered', stage: 'delivered', description: 'Delivered' }],
  ['LTT', { status: 'delivered', stage: 'delivered', description: 'Delivered' }],
  ['INC', { status: 'exception', stage: 'failed_attempt', description: 'Incomplete delivery information' }],
  ['PBP', { status: 'exception', stage: 'failed_attempt', description: 'Parcel delivery issue' }],
  ['NLI', { status: 'exception', stage: 'failed_attempt', description: 'Delivery attempt unsuccessful' }],
  ['NLK', { status: 'exception', stage: 'failed_attempt', description: 'Locker delivery unsuccessful' }],
  ['NLP', { status: 'exception', stage: 'failed_attempt', description: 'ParcelShop delivery unsuccessful' }],
  ['RET', { status: 'exception', stage: 'returned', description: 'Returning to sender' }],
  ['PBA', { status: 'exception', stage: 'failed_attempt', description: 'Parcel delivery issue' }],
  ['SIN', { status: 'exception', stage: 'failed_attempt', description: 'Shipment incident' }],
  ['LIP', { status: 'out_for_delivery', stage: 'ready_for_pickup', description: 'Ready for pickup at GLS ParcelShop' }],
  ['LTP', { status: 'out_for_delivery', stage: 'ready_for_pickup', description: 'Ready for pickup at GLS ParcelShop' }],
  ['LIK', { status: 'out_for_delivery', stage: 'ready_for_pickup', description: 'Ready for pickup at GLS Locker' }],
  ['LTK', { status: 'out_for_delivery', stage: 'ready_for_pickup', description: 'Ready for pickup at GLS Locker' }],
  ['PAQ', { status: 'out_for_delivery', stage: 'ready_for_pickup', description: 'Ready for pickup at GLS depot' }],
  // These additional values are present in the current official tracking frontend.
  ['DEP', { status: 'in_transit', stage: 'in_transit', description: 'ParcelShop delivery planned' }],
  ['DEK', { status: 'in_transit', stage: 'in_transit', description: 'Locker delivery planned' }],
  ['DEL', DELAYED_DELIVERY],
  ['LIR', { status: 'exception', stage: 'returned', description: 'Returned to sender' }],
]);

/** A provider code is two to four letters; anything else is not a code we can read. */
export function glsFranceStatusCode(value: unknown): string {
  const code = cleanScalar(value, 12).toLocaleUpperCase('en-US');
  return /^[A-Z]{2,4}$/.test(code) ? code : '';
}

export function glsFranceStatusMetadata(value: unknown): GLSFranceStatusMetadata | null {
  return GLS_FRANCE_STATUSES.get(glsFranceStatusCode(value)) ?? null;
}

export function glsFranceStatus(value: unknown): CarrierStatus {
  return glsFranceStatusMetadata(value)?.status ?? 'unknown';
}
