/**
 * Royal Mail status vocabulary.
 *
 * The summary reply carries a status plus scan wording; both are English
 * prose, matched on substrings. The map produces a result-level
 * `CarrierStatus` and, when the wording is recognized, the event `Stage`.
 *
 * Wording provenance: Royal Mail's public tracking states (prior art).
 * `statuses.json` holds the full list.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../core/status';

const RETURNED_TERMS = ['return to sender', 'returned to sender', 'returning to sender'];
const FAILED_ATTEMPT_TERMS = [
  'delivery attempted', 'delivery attempt', 'delivery was attempted', 'no answer',
  'not delivered', 'unable to deliver', 'business closed', 'refused',
];
const EXCEPTION_TERMS = ['exception', 'delayed', 'delay', 'damaged', 'lost', 'customs charges', 'held'];

const OUT_FOR_DELIVERY_TERMS = ['out for delivery', 'out-for-delivery', 'on delivery'];
const READY_FOR_PICKUP_TERMS = ['ready for collection', 'ready to collect', 'available for collection'];
const REGISTERED_TERMS = ['manifest', 'label created', 'information received', 'order received', 'sender preparing'];
const ACCEPTED_TERMS = ['accepted', 'received', 'item received', 'collected', 'posted', 'handed over'];
const CUSTOMS_TERMS = ['customs', 'clearance'];
const IN_TRANSIT_TERMS = ['despatched', 'dispatched', 'redirected', 'in transit', 'on its way', 'in-transit', 'arrived', 'departed', 'processing', 'distribution centre', 'distribution center', 'mail centre', 'delivery office'];

/**
 * Classify Royal Mail status prose. Returns null when nothing matches, so
 * callers leave an event unstaged rather than invent a stage.
 */
export function royalMailStage(text: string): Stage | null {
  const value = text.toLocaleLowerCase('en-US');
  if (!value) return null;
  if (RETURNED_TERMS.some((term) => value.includes(term))) return 'returned';
  if (FAILED_ATTEMPT_TERMS.some((term) => value.includes(term))) return 'failed_attempt';
  if (/^(?:delivered\b|(?:your )?item (?:was |has been )?delivered\b)/.test(value)) return 'delivered';
  if (OUT_FOR_DELIVERY_TERMS.some((term) => value.includes(term))) return 'out_for_delivery';
  if (READY_FOR_PICKUP_TERMS.some((term) => value.includes(term))) return 'ready_for_pickup';
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

/** The result-level status for summary and scan wording. */
export function royalMailStatus(text: string): CarrierStatus {
  const stage = royalMailStage(text);
  if (stage) return statusForStage(stage);
  return 'unknown';
}
