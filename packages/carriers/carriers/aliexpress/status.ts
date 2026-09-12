/**
 * Cainiao status vocabulary.
 *
 * Two vocabularies arrive in the same payload and they are not equivalent:
 *
 * - `latestTrace.actionCode` (and `detailList[].actionCode`) is the leg-level
 *   scan code. It is the primary signal, mapped by `ACTION_STATUS` below.
 * - The parcel-level `status` token is a coarse order state. Its vocabulary is
 *   unestablished (real parcels carry values such as DELIVERED, CLEAR_CUSTOMS,
 *   transport, pickup, delivered), so it is only consulted when no action code
 *   is present.
 *
 * Provenance: the action map follows the prior-art client
 * https://github.com/ha-parcel-integrations/ha-cainiao (`parcels.py`
 * `_ACTION_MAP`, 41 codes grouped by leg, MIT).
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../core/status';

/** Parcel-level order tokens, used only when the newest trace has no action code. */
export const CAINIAO_STATUS = new Map<string, CarrierStatus>([
  ['WAIT_SELLER_SEND_GOODS', 'pending'],
  ['SELLER_SEND_GOODS', 'pending'],
  ['WAIT_BUYER_ACCEPT_GOODS', 'in_transit'],
  ['DELIVERING', 'in_transit'],
  ['SIGN', 'delivered'],
  ['FAILED', 'exception'],
  ['RETURNED', 'exception'],
]);

// Primary signal, from ha-cainiao parcels.py _ACTION_MAP (41 codes, grouped by
// leg). The parcel-level `status` token vocabulary is unestablished (real
// parcels carry DELIVERED/CLEAR_CUSTOMS/transport/pickup/delivered), so the
// newest latestTrace.actionCode wins and the token is only a fallback.
export const CAINIAO_ACTION_STATUS = new Map<string, CarrierStatus>([
  ['GWMS_ACCEPT', 'pending'],
  ['GWMS_PACKAGE', 'pending'],
  ['PRE_READY_TO_SHIP', 'pending'],
  ['CONSIGN', 'pending'],
  ['CW_INBOUND', 'in_transit'],
  ['CW_OUTBOUND', 'in_transit'],
  ['CW_COMMON_PROCESSING1', 'in_transit'],
  ['PU_PICKUP_SUCCESS', 'in_transit'],
  ['GWMS_OUTBOUND', 'in_transit'],
  ['SC_INBOUND_SUCCESS', 'in_transit'],
  ['SC_OUTBOUND_SUCCESS', 'in_transit'],
  ['SC_TRANS_INBOUND_SUCCESS', 'in_transit'],
  ['SC_TRANS_OUTBOUND_SUCCESS', 'in_transit'],
  ['CC_EX_START', 'in_transit'],
  ['CC_EX_SUCCESS', 'in_transit'],
  ['LH_HO_IN_SUCCESS', 'in_transit'],
  ['LH_HO_AIRLINE', 'in_transit'],
  ['LH_DEPART', 'in_transit'],
  ['LH_ARRIVE', 'in_transit'],
  ['LH_POST_COLLECTION', 'in_transit'],
  ['COMMON_INTRANSIT', 'in_transit'],
  ['TD_TRANS_DEPART', 'in_transit'],
  ['TD_TRANS_ARRIVE', 'in_transit'],
  ['TD_TRANS_DEPART_C', 'in_transit'],
  ['TD_TRANS_ARRIVE_C', 'in_transit'],
  ['CC_HO_IN_SUCCESS', 'in_transit'],
  ['CC_IM_START', 'in_transit'],
  ['CC_IM_SUCCESS', 'in_transit'],
  ['CC_HO_OUT_SUCCESS', 'in_transit'],
  ['CC_IM_FAILURE', 'exception'],
  ['CC_IM_EXCEPTION', 'exception'],
  ['GTMS_ACCEPT', 'in_transit'],
  ['SC_ARRIVE', 'in_transit'],
  ['SC_DEPART', 'in_transit'],
  ['OE_DEPART', 'in_transit'],
  ['LAST_MILE_ASN_NOTIFY', 'in_transit'],
  ['GTMS_DO_DEPART', 'out_for_delivery'],
  ['GSTA_INFORM_BUYER', 'out_for_delivery'],
  ['GTMS_WAIT_SELF_PICK', 'out_for_delivery'],
  // Station signed, not the recipient — must never read as delivered.
  ['GTMS_STA_SIGNED', 'out_for_delivery'],
  ['GTMS_SIGNED', 'delivered'],
  ['GTMS_STA_SIGN_FAILURE', 'exception'],
  ['EXCEPTION', 'exception'],
]);

/** Out-for-delivery actions that mean "waiting at a pickup point", not "on the van". */
export const CAINIAO_PICKUP_ACTIONS = new Set(['GSTA_INFORM_BUYER', 'GTMS_WAIT_SELF_PICK', 'GTMS_STA_SIGNED']);

/** Normalize an action code: Cainiao has been seen spelling them with spaces and in lower case. */
export function cainiaoActionCode(value: unknown): string {
  return (typeof value === 'string' ? value : '').trim().toLocaleUpperCase('en-US').replace(/\s+/g, '_');
}

/**
 * Status → stage for one lookup. The pickup distinction depends on the newest
 * action code, so the whole table is derived from it once and then applied to
 * the shipment and to every historical event, exactly as before the move.
 */
export function cainiaoStageByStatus(latestActionCode: string): Partial<Record<CarrierStatus, Stage>> {
  return {
    pending: 'registered',
    out_for_delivery: CAINIAO_PICKUP_ACTIONS.has(latestActionCode) ? 'ready_for_pickup' : 'out_for_delivery',
    delivered: 'delivered',
    exception: 'exception',
  };
}
