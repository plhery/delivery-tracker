/**
 * FedEx status vocabulary.
 *
 * The tracking reply carries two signals per shipment and per scan: a short
 * machine code (`keyStatusCD` on the package, `statusCD` on a scan) and
 * English prose (`keyStatus`, `status`, `scanDetails`). The code is read
 * first; the prose is matched on substrings because FedEx re-words it freely.
 * A `delivered` code is terminal and outranks an intuitive translation of the
 * wording, the way the tracking page itself treats it.
 *
 * Code provenance: `DE` and `DY` drive the page's own delivery-exception and
 * delay flags, `DL`/`OD`/`OC`/`PU`/`AR`/`DP` come from the page bundle and
 * FedEx's tracking documentation; `IT`/`SE`/`CA` match the official Track API
 * vocabulary (prior art). `statuses.json` holds the full list.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../core/status';

/** Package and scan codes, uppercased, to the product stage. */
export const FEDEX_CODE_STAGE: Readonly<Record<string, Stage>> = {
  OC: 'registered',
  PU: 'accepted',
  AR: 'in_transit',
  DP: 'in_transit',
  IT: 'in_transit',
  OD: 'out_for_delivery',
  DL: 'delivered',
  DE: 'failed_attempt',
  DY: 'exception',
  SE: 'exception',
  CA: 'exception',
};

const RETURNED_TERMS = ['return to sender', 'returned to shipper', 'returning to shipper'];
const FAILED_ATTEMPT_TERMS = [
  'delivery exception',
  'delivery attempted',
  'delivery attempt',
  'we missed you',
  'customer not available',
  'business closed',
  'not delivered',
  'unable to deliver',
  'delivery not attempted',
];
const EXCEPTION_TERMS = [
  'shipment exception',
  'exception',
  'delayed',
  'delay',
  'damaged',
  'lost',
  'held',
  'action required',
  'clearance delay',
];
const DELIVERED_TERMS = ['delivered', 'signed for', 'left at', 'received by'];
const CUSTOMS_TERMS = ['clearance', 'customs'];
const OUT_FOR_DELIVERY_TERMS = ['out for delivery', 'on fedex vehicle for delivery', 'on vehicle for delivery'];
const REGISTERED_TERMS = [
  'shipment information sent',
  'information sent to fedex',
  'label created',
  'manifest',
  'initiated',
  'order created',
];
const ACCEPTED_TERMS = ['picked up', 'pickedup', 'tendered at fedex', 'arrived at fedex location', 'accepted at'];
const IN_TRANSIT_TERMS = [
  'in transit',
  'on the way',
  'departed fedex location',
  'departed',
  'arrived',
  'at local fedex facility',
  'at destination sort facility',
];

/**
 * Classify FedEx status prose. Returns null when nothing matches, so callers
 * can fall back to the code or leave an event unstaged rather than invent a
 * stage. `hasEvents` reports an existing scan history, which makes
 * unrecognized wording "moving" rather than "unknown".
 */
export function fedexStage(text: string): Stage | null {
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

/**
 * The result-level status for a package code plus its prose. The code wins,
 * except that an unmapped code falls back to the wording, and unrecognized
 * wording on a shipment that already has scans reads as moving.
 */
export function fedexStatus(code: string, text: string, hasEvents = false): CarrierStatus {
  const stage = FEDEX_CODE_STAGE[code.toUpperCase()];
  if (stage) return statusForStage(stage);
  const wording = fedexStage(text);
  if (wording) return statusForStage(wording);
  // Unrecognized wording only means "moving" once the shipment has scans.
  return hasEvents ? 'in_transit' : 'unknown';
}
