/**
 * Amazon Shipping status classification.
 *
 * The tracker sends several loosely related signals per row — a localized
 * string id (`swa_rex_detail_delivered`), an `eventCode` (`Delivered`), a
 * `subReasonCode`, and at shipment level a `trackingStatus`, a `status` and
 * `containerStatusTags`. They are folded into one lower-case, punctuation-free
 * key and matched as substrings, so `OUT_FOR_DELIVERY`, `outForDelivery` and
 * `swa_rex_ofd` all land on the same rule.
 *
 * Order matters: returns and failures are decided before the broad "delivered"
 * substring they contain, and delays before the transit words.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../generated/catalog';

export interface ClassifiedStatus {
  status: CarrierStatus;
  stage: Stage;
  description: string;
}

export const UNKNOWN_STATUS: ClassifiedStatus = {
  status: 'unknown',
  stage: 'in_transit',
  description: 'Amazon Shipping update',
};

/** Fold any provider signal into the comparison key: lower case, letters and digits only. */
export function statusKey(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 200)
    .toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, '');
}

function includesAny(value: string, candidates: string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

/** Classify one or more provider signals; the first matching rule wins. */
export function classifyStatus(...values: unknown[]): ClassifiedStatus {
  const key = values.map(statusKey).filter(Boolean).join(' ');
  if (includesAny(key, [
    'returnedtoretailer',
    'returnedtomerchant',
    'returnedtoshopper',
    'returnedtoshipper',
    'returntosender',
    'returningtosender',
    'returnedtosender',
    'lostonreturn',
  ])) {
    return { status: 'exception', stage: 'returned', description: 'Returning to sender' };
  }
  if (includesAny(key, [
    'informationneeded',
    'addressproblem',
    'damaged',
    'destroyed',
    'rejected',
    'cancelled',
    'canceled',
    'lost',
  ])) {
    return { status: 'exception', stage: 'exception', description: 'Shipment exception' };
  }
  if (includesAny(key, [
    'deliveryattempted',
    'failedattempt',
    'unabletodeliver',
    'undeliverable',
  ])) {
    return { status: 'exception', stage: 'failed_attempt', description: 'Delivery issue' };
  }
  if (includesAny(key, ['delayed', 'late'])) {
    return { status: 'in_transit', stage: 'in_transit', description: 'Delivery delayed' };
  }
  if (includesAny(key, ['delivered'])) {
    return { status: 'delivered', stage: 'delivered', description: 'Delivered' };
  }
  if (includesAny(key, [
    'readyforpickup',
    'readyforcollection',
    'holdforpickup',
    'awaitingcustomerpickup',
  ])) {
    return {
      status: 'out_for_delivery',
      stage: 'ready_for_pickup',
      description: 'Ready for pickup',
    };
  }
  if (includesAny(key, ['outfordelivery', 'swarexofd'])) {
    return {
      status: 'out_for_delivery',
      stage: 'out_for_delivery',
      description: 'Out for delivery',
    };
  }
  if (includesAny(key, ['customs', 'clearance'])) {
    return { status: 'in_transit', stage: 'customs', description: 'In customs clearance' };
  }
  if (includesAny(key, [
    'pickupdone',
    'pickedup',
    'receivedfromseller',
    'receivedfromshipper',
    'acceptedbycarrier',
  ])) {
    return { status: 'in_transit', stage: 'accepted', description: 'Shipment picked up' };
  }
  if (includesAny(key, [
    'creationconfirmed',
    'labelcreated',
    'shippinglabelcreated',
    'shipmentcreated',
    'informationreceived',
    'registered',
  ])) {
    return {
      status: 'pending',
      stage: 'registered',
      description: 'Shipment information received',
    };
  }
  if (includesAny(key, [
    'intransit',
    'swarexintransit',
    'received',
    'departed',
    'arrived',
    'sortcenter',
    'deliverycenter',
    'transport',
  ])) {
    return { status: 'in_transit', stage: 'in_transit', description: 'In transit' };
  }
  return UNKNOWN_STATUS;
}

export function amazonShippingStatus(value: unknown): CarrierStatus {
  return classifyStatus(value).status;
}
