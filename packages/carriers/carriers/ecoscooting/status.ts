import type { ClassifiedStatus } from '../../core/status';

const DELIVERED: ClassifiedStatus = { status: 'delivered', stage: 'delivered' };
// A pickup point signing for the parcel or receiving it means it waits there.
const AT_PICKUP_POINT: ClassifiedStatus = { status: 'out_for_delivery', stage: 'ready_for_pickup' };
const RETURNED: ClassifiedStatus = { status: 'exception', stage: 'returned' };

const CODES = new Map<string, ClassifiedStatus>([
  // Codes of the GTMS/TD family.
  ['GTMS_SIGNED', DELIVERED],
  ['GTMS_PUDO_SIGNED', DELIVERED],
  ['GTMS_STA_SIGNED', AT_PICKUP_POINT],
  ['GTMS_PUDO_INBOUND', AT_PICKUP_POINT],
  ['GTMS_PUDO_OVERDUE', RETURNED],
  ['GTMS_SIGN_FAILURE', RETURNED],
  ['RT_SIGNIN_SUCCESS', RETURNED],
  ['RT_DO_DEPART', RETURNED],
  ['RT_DO_ARRIVE', RETURNED],
  ['RT_WH_OUTBOUND', RETURNED],
  ['RT_WH_INBOUND', RETURNED],
  ['GTMS_DO_DEPART', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['GTMS_DEL_FAILURE', { status: 'exception', stage: 'failed_attempt' }],
  ['GTMS_ACCEPT', { status: 'in_transit', stage: 'accepted' }],
  ['TD_TRANSWH_OUTBOUND', { status: 'in_transit', stage: 'in_transit' }],
  ['TD_TRANS_ARRIVE_C', { status: 'in_transit', stage: 'in_transit' }],
  ['In_transit', { status: 'in_transit', stage: 'in_transit' }],
  ['Partner_outbound', { status: 'in_transit', stage: 'in_transit' }],
  ['create', { status: 'pending', stage: 'registered' }],
  ['Label_created', { status: 'pending', stage: 'registered' }],
  // Codes of the last-mile family, which every CN reference uses.
  ['LM_SIGN_SUCCESS', DELIVERED],
  ['PUDO_SIGN_SUCCESS', DELIVERED],
  ['PUDO_DELIVERY', AT_PICKUP_POINT],
  ['PUDO_INBOUND', AT_PICKUP_POINT],
  ['PUDO_OVERDUE', RETURNED],
  ['LM_UNREACHABLE_RETURN', RETURNED],
  ['RT_LM_SIGN_SUCCESS', RETURNED],
  ['RT_LM_DELIVERY_DEPART', RETURNED],
  ['RT_LM_DELIVERY_ARRIVE', RETURNED],
  ['RT_SC_OUTBOUND', RETURNED],
  ['RT_SC_INBOUND', RETURNED],
  ['LM_DELIVERY_DEPART', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['LM_DELIVERY_FAILURE', { status: 'exception', stage: 'failed_attempt' }],
  ['LM_PARCEL_EXCEPTION', { status: 'exception', stage: 'exception' }],
  ['SL_ACCEPT', { status: 'in_transit', stage: 'accepted' }],
  ['TRANSFER_ARRIVE', { status: 'in_transit', stage: 'in_transit' }],
  ['TRANSFER_DEPART', { status: 'in_transit', stage: 'in_transit' }],
  ['SC_OUTBOUND', { status: 'in_transit', stage: 'in_transit' }],
  ['SC_INBOUND', { status: 'in_transit', stage: 'in_transit' }],
  ['PU_PICKUP_SUCCESS', { status: 'in_transit', stage: 'accepted' }],
  ['CREATE_ORDER_CES', { status: 'pending', stage: 'registered' }],
]);

export function ecoscootingStatus(code: string): ClassifiedStatus | undefined { return CODES.get(code); }
