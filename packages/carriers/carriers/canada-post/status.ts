/**
 * Canada Post status vocabulary.
 *
 * The tracking reply carries a numeric package `status` and per-scan codes.
 * The package codes come from the tracking application's own enum, observed
 * in its bundle (`HalfAccepted` 0 through `Delivered` 8). Scan wording is
 * matched on substrings as a fallback.
 *
 * The map produces a result-level `CarrierStatus` and, when the code or
 * wording is recognized, the event `Stage`. `statuses.json` holds the list.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../core/status';

/** Package status codes, as the reply spells them, to the product stage. */
export const CANADA_POST_STATUS_STAGE: Readonly<Record<string, Stage>> = {
  '0': 'accepted',
  '1': 'accepted',
  '2': 'in_transit',
  '3': 'exception',
  '4': 'exception',
  '5': 'in_transit',
  '6': 'in_transit',
  '7': 'ready_for_pickup',
  '8': 'delivered',
};

const RETURNED_TERMS = ['return to sender', 'returned to sender', 'returning to sender'];
const FAILED_ATTEMPT_TERMS = [
  'delivery attempted', 'delivery attempt', 'notice left', 'delivery notice',
  'no answer', 'business closed', 'not delivered', 'unable to deliver',
  'held at post office', 'available for pickup',
];
const EXCEPTION_TERMS = ['exception', 'alert', 'delayed', 'delay', 'damaged', 'lost', 'seized', 'held'];
const DELIVERED_TERMS = ['delivered'];
const OUT_FOR_DELIVERY_TERMS = ['out for delivery'];
const REGISTERED_TERMS = ['manifest', 'label created', 'information received', 'order received', 'pre-shipment'];
const ACCEPTED_TERMS = ['accepted', 'picked up', 'received at', 'received by canada post', 'arrived at'];
const CUSTOMS_TERMS = ['customs', 'clearance'];
const IN_TRANSIT_TERMS = ['in transit', 'on its way', 'departed', 'processed', 'processing', 'distribution centre', 'distribution center', 'sorting'];

/**
 * Classify Canada Post scan wording. Returns null when nothing matches, so
 * callers leave an event unstaged rather than invent a stage.
 */
export function canadaPostStage(text: string): Stage | null {
  const value = text.toLocaleLowerCase('en-US');
  if (!value) return null;
  if (RETURNED_TERMS.some((term) => value.includes(term))) return 'returned';
  if (FAILED_ATTEMPT_TERMS.some((term) => value.includes(term))) return 'failed_attempt';
  if (DELIVERED_TERMS.some((term) => value.includes(term))) return 'delivered';
  if (OUT_FOR_DELIVERY_TERMS.some((term) => value.includes(term))) return 'out_for_delivery';
  if (CUSTOMS_TERMS.some((term) => value.includes(term))) return 'customs';
  if (EXCEPTION_TERMS.some((term) => value.includes(term))) return 'exception';
  if (REGISTERED_TERMS.some((term) => value.includes(term))) return 'registered';
  if (ACCEPTED_TERMS.some((term) => value.includes(term))) return 'accepted';
  if (IN_TRANSIT_TERMS.some((term) => value.includes(term))) return 'in_transit';
  return null;
}

export function statusForStage(stage: Stage): CarrierStatus {
  if (stage === 'delivered') return 'delivered';
  if (stage === 'out_for_delivery' || stage === 'ready_for_pickup') return 'out_for_delivery';
  if (stage === 'exception' || stage === 'failed_attempt' || stage === 'returned') return 'exception';
  if (stage === 'registered' || stage === 'pending') return 'pending';
  return 'in_transit';
}

/** The result-level status for a package code plus scan wording. */
export function canadaPostStatus(code: string, text: string, hasEvents = false): CarrierStatus {
  const stage = CANADA_POST_STATUS_STAGE[code.trim()];
  if (stage) return statusForStage(stage);
  const wording = canadaPostStage(text);
  if (wording) return statusForStage(wording);
  // Unrecognized wording only means "moving" once the shipment has scans.
  return hasEvents ? 'in_transit' : 'unknown';
}
