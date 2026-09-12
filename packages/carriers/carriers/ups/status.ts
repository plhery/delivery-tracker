/**
 * UPS status vocabulary.
 *
 * UPS answers with two things: `progressBarType`, a short machine token on the
 * shipment detail, and English prose (`packageStatus`, `simplifiedText`, the
 * milestone name, the activity scans). The token is the stable key and is
 * mapped first; the prose is matched on substrings because UPS localizes and
 * re-words it freely and the same page mixes several phrasings for one state.
 *
 * The map produces a result-level `CarrierStatus`. UPS activities carry no
 * stable per-event code, so the adapter attaches no `stage` to an event: the
 * sync classifies the raw wording and records it for review instead.
 */
import type { CarrierStatus } from '../../core/result';

const EXCEPTION_TERMS = [
  'return to sender', 'returned', 'delivery attempted', 'we missed you',
  'not delivered', 'exception', 'action required',
];
const DELIVERED_TERMS = ['delivered', 'left at'];
const IN_TRANSIT_TERMS = [
  'on the way', 'in transit', 'we have your package', 'first ups possession',
  'departed', 'arrived', 'processing at ups facility',
];
const PENDING_TERMS = ['label created', 'manifest upload', 'shipment ready for ups'];

/**
 * Classify UPS status prose. `hasEvents` reports that the shipment already has
 * a scan history, which is what makes unrecognized wording "moving" rather
 * than "unknown"; without it an unmapped phrase stays `unknown` on purpose.
 */
export function upsStatus(text: string, hasEvents = false): CarrierStatus {
  const value = text.toLocaleLowerCase('en-US');
  if (EXCEPTION_TERMS.some((term) => value.includes(term))) return 'exception';
  if (DELIVERED_TERMS.some((term) => value.includes(term))) return 'delivered';
  if (value.includes('out for delivery')) return 'out_for_delivery';
  if (hasEvents || IN_TRANSIT_TERMS.some((term) => value.includes(term))) return 'in_transit';
  if (PENDING_TERMS.some((term) => value.includes(term))) return 'pending';
  return 'unknown';
}

/**
 * `progressBarType` on a shipment detail, lowercased. It outranks the prose
 * because it is the value the page's own progress bar is driven by.
 */
export const UPS_PROGRESS_STATUS: Readonly<Record<string, CarrierStatus>> = {
  manifestupload: 'pending',
  firstupspossession: 'in_transit',
  intransit: 'in_transit',
  outfordelivery: 'out_for_delivery',
  delivered: 'delivered',
  exception: 'exception',
};
