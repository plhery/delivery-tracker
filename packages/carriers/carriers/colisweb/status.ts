/**
 * Colisweb delivery steps.
 *
 * The anonymous search endpoint reports one machine step per delivery (`step`)
 * and no wording. Steps arrive in several spellings across the provider's own
 * surfaces (`pickedUp`, `picked_up`, `PICKED_UP`), so they are compared with
 * case and separators removed. The French descriptions below are ours: Colisweb
 * sends none.
 *
 * A step that is not listed stays unmapped — the adapter reports the delivery
 * with no stage and the sync classifies it.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../generated/catalog';

export interface ClassifiedStatus {
  status: CarrierStatus;
  /** Absent when the step is unknown: the sync's classifier decides instead. */
  stage?: Stage;
  description: string;
}

/** Lowercase and drop everything that is not a letter or a digit. */
export function statusKey(value: unknown): string {
  return typeof value === 'string'
    ? value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '')
    : '';
}

export const DELIVERED_STEPS: readonly string[] = ['delivered', 'deliverypbok'];
export const RETURNED_STEPS: readonly string[] = [
  'packagereturned',
  'deliveryreturned',
  'packagereturnfailed',
  'deliveryreturnfailed',
];
export const CANCELED_STEPS: readonly string[] = [
  'canceled',
  'cancelled',
  'deliverycanceled',
  'deliverycancelled',
];
/** A carrier-reported problem that is neither a missed attempt nor a return. */
export const EXCEPTION_STEPS: readonly string[] = ['nondeliverable'];
export const FAILED_STEPS: readonly string[] = [
  'pickupfailed',
  'packagewithdrawalfailed',
  'deliveryfailed',
];
export const OUT_FOR_DELIVERY_STEPS: readonly string[] = ['outfordelivery', 'deliveryinprogress'];
export const PICKED_UP_STEPS: readonly string[] = ['pickedup', 'packagewithdrawn', 'packagewithdrawalpbok'];
export const CONFIRMED_STEPS: readonly string[] = ['idle', 'confirmed', 'courseaccepted'];

export function classifyStatus(value: unknown): ClassifiedStatus {
  const key = statusKey(value);
  if (DELIVERED_STEPS.includes(key)) {
    return { status: 'delivered', stage: 'delivered', description: 'Livraison effectuée' };
  }
  if (RETURNED_STEPS.includes(key)) {
    return { status: 'exception', stage: 'returned', description: 'Colis retourné' };
  }
  if (CANCELED_STEPS.includes(key)) {
    return { status: 'exception', stage: 'returned', description: 'Livraison annulée' };
  }
  if (EXCEPTION_STEPS.includes(key)) {
    return { status: 'exception', stage: 'exception', description: 'Incident de livraison' };
  }
  if (FAILED_STEPS.includes(key)) {
    return { status: 'exception', stage: 'failed_attempt', description: 'Incident de livraison' };
  }
  if (OUT_FOR_DELIVERY_STEPS.includes(key)) {
    return {
      status: 'out_for_delivery',
      stage: 'out_for_delivery',
      description: 'Livraison en cours',
    };
  }
  if (PICKED_UP_STEPS.includes(key)) {
    return { status: 'in_transit', stage: 'in_transit', description: 'Colis pris en charge' };
  }
  if (CONFIRMED_STEPS.includes(key)) {
    return { status: 'pending', stage: 'registered', description: 'Livraison confirmée' };
  }
  return { status: 'unknown', description: 'Mise à jour Colisweb' };
}
