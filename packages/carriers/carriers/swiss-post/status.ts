/**
 * Swiss Post status classification.
 *
 * Two independent vocabularies meet here. `globalStatus` is the shipment-level
 * summary the portal shows at the top of the page. Event codes are the last
 * segment of a dotted `eventCode` such as `PARCEL.*.1.1003`, and they are the
 * authority for the current stage: the summary lags behind (a MyPost24 deposit
 * reads `DELIVERED` while the parcel is still waiting in the locker).
 *
 * Only codes with a confirmed meaning are mapped. Anything else is left without
 * a stage so the sync can classify the wording and record the code for review.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../generated/catalog';

/** Shipment-level `globalStatus` → status. The event codes below refine it. */
export const STATUS_MAP = new Map<string, CarrierStatus>([
  ['REPORTED', 'pending'],
  ['REGISTERED', 'pending'],
  ['TO_BE_DELIVERED', 'in_transit'],
  ['IN_DELIVERY', 'out_for_delivery'],
  ['DELIVERED', 'delivered'],
  ['MISSED_DELIVERY', 'exception'],
  ['NOT_DELIVERED', 'exception'],
  ['RETURNED', 'exception'],
  ['CUSTOMS', 'in_transit'],
]);

/** Wording for codes the translation service does not resolve. */
export const FALLBACK_EVENT_LABELS: Record<string, string> = {
  '600': 'Your shipment will shortly be handed over to Swiss Post',
  '1003': 'Loading into delivery vehicle',
  '1201': 'Sorted for delivery',
  '1202': 'Shipment was sorted',
};

/** Parcel event codes (the last dotted segment) with a confirmed stage. */
export const EVENT_STAGE_BY_CODE: Record<string, Stage> = {
  '600': 'registered',
  '820': 'in_transit',
  '1003': 'out_for_delivery',
  '1201': 'in_transit',
  '1202': 'in_transit',
  '2102': 'ready_for_pickup',
  '3600': 'returned',
  '4600': 'delivered',
};

// International letter/packet scans used for postal handoffs (including DHL
// Kleinpaket). Their wording can otherwise imply delivery or active customs.
export const LETTER_IMPORT_STAGE_BY_CODE: Record<string, Stage> = {
  '620': 'registered',
  '803': 'customs',
  '804': 'in_transit',
  '805': 'in_transit',
  '818': 'in_transit',
  '912': 'accepted',
  '915': 'in_transit',
  '1001': 'in_transit',
  '1213': 'in_transit',
  '1218': 'in_transit',
};

/** The shipment status implied by the newest event's stage. */
export const STAGE_STATUS: Record<string, CarrierStatus> = {
  registered: 'pending',
  accepted: 'in_transit',
  in_transit: 'in_transit',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
  customs: 'in_transit',
  failed_attempt: 'exception',
  ready_for_pickup: 'in_transit',
  returned: 'exception',
};

/** Only `LETTER.*.90.*` scans use the import table; everything else uses the parcel table. */
export const LETTER_IMPORT_EVENT = /^LETTER\.[^.]+\.90\./;

/** The stage for a full dotted event code, or undefined when the code is not mapped. */
export function swissPostEventStage(eventCode: string): Stage | undefined {
  const code = eventCode.split('.').at(-1) ?? '';
  return (LETTER_IMPORT_EVENT.test(eventCode) ? LETTER_IMPORT_STAGE_BY_CODE[code] : undefined)
    ?? EVENT_STAGE_BY_CODE[code];
}
