/**
 * Paack event identifiers → product stage.
 *
 * The recipient page ships a timeline whose entries carry a stable `id` and a
 * translation `label`; the visible text is localized per viewer, so the map
 * keys on the identifiers instead. Both fields are reduced to lower-case
 * letters and digits and concatenated, then matched by substring, which keeps
 * suffixed variants ("scannedAtOriginHeader", "pudoAssignedHeader") on the
 * same stage as their base identifier.
 *
 * Order matters: return and failure identifiers are tested before the broader
 * delivery ones, so "notDelivered" can never match the "delivered" substring.
 * The provider's own wording is never returned; each mapped entry supplies the
 * English description we display.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../generated/catalog';
import type { JsonObject } from '../../core/types';

export interface ClassifiedPaackStatus {
  status: CarrierStatus;
  stage: Stage;
  description: string;
}

/** Reduce a provider identifier or label to lower-case letters and digits. */
export function statusKey(value: unknown): string {
  return typeof value === 'string'
    ? value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '')
    : '';
}

function includesAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

export function classifyPaackEvent(value: JsonObject): ClassifiedPaackStatus {
  const key = `${statusKey(value.label)} ${statusKey(value.id)}`;
  if (includesAny(key, [
    'returnedsender',
    'returnedtosender',
    'returnedtoretailer',
  ])) {
    return { status: 'exception', stage: 'returned', description: 'Shipment returned' };
  }
  if (includesAny(key, [
    'returntosenderscheduled',
    'returnabsent',
    'returnother',
    'incorrectaddress',
    'absent',
    'attempted',
    'deliveryfailed',
    'failedattempt',
    'notdelivered',
    'undelivered',
    'notaccepted',
    'rejected',
    'damaged',
    'lost',
    'nondeliverable',
    'integrationerror',
    'cancelled',
    'canceled',
  ])) return { status: 'exception', stage: 'failed_attempt', description: 'Delivery issue' };
  if (includesAny(key, ['delivered', 'deliverycompleted'])) {
    return { status: 'delivered', stage: 'delivered', description: 'Delivered' };
  }
  if (includesAny(key, ['readyforpickup', 'atpickuppoint'])) {
    return { status: 'out_for_delivery', stage: 'ready_for_pickup', description: 'Ready for pickup' };
  }
  if (includesAny(key, ['outfordelivery', 'driverassigned', 'inprogress'])) {
    return {
      status: 'out_for_delivery',
      stage: 'out_for_delivery',
      description: 'Out for delivery',
    };
  }
  if (includesAny(key, [
    'manifested',
    'created',
    'notreceivedfromretailer',
    'additionaldeliveryattemptscheduled',
    'orderreactivated',
    'appointmentbroughtforward',
    'appointmentrescheduled',
    'appointmentscheduled',
  ])) return { status: 'pending', stage: 'registered', description: 'Shipment registered' };
  if (includesAny(key, ['scannedatorigin'])) {
    return { status: 'in_transit', stage: 'accepted', description: 'Shipment accepted' };
  }
  if (includesAny(key, [
    'received',
    'collected',
    'transit',
    'hub',
    'warehouse',
    'sorted',
    'pudoassigned',
  ])) {
    return { status: 'in_transit', stage: 'in_transit', description: 'In transit' };
  }
  return { status: 'unknown', stage: 'in_transit', description: 'Shipment update' };
}
