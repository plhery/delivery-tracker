import type { ClassifiedStatus } from '../../core/status';

const CODES = new Map<string, ClassifiedStatus>([
  ['GTMS_SIGNED', { status: 'delivered', stage: 'delivered' }],
  ['GTMS_PUDO_SIGNED', { status: 'delivered', stage: 'delivered' }],
  // The pickup point signed for the parcel, not the recipient.
  ['GTMS_STA_SIGNED', { status: 'out_for_delivery', stage: 'ready_for_pickup' }],
  ['GTMS_PUDO_INBOUND', { status: 'out_for_delivery', stage: 'ready_for_pickup' }],
  ['GTMS_DO_DEPART', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['GTMS_DEL_FAILURE', { status: 'exception', stage: 'failed_attempt' }],
  ['GTMS_ACCEPT', { status: 'in_transit', stage: 'accepted' }],
  ['TD_TRANSWH_OUTBOUND', { status: 'in_transit', stage: 'in_transit' }],
  ['TD_TRANS_ARRIVE_C', { status: 'in_transit', stage: 'in_transit' }],
  ['In_transit', { status: 'in_transit', stage: 'in_transit' }],
  ['Partner_outbound', { status: 'in_transit', stage: 'in_transit' }],
  ['create', { status: 'pending', stage: 'registered' }],
  ['Label_created', { status: 'pending', stage: 'registered' }],
  ['LM_SIGN_SUCCESS', { status: 'delivered', stage: 'delivered' }],
  ['LM_DELIVERY_DEPART', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['SL_ACCEPT', { status: 'in_transit', stage: 'accepted' }],
  ['SC_OUTBOUND', { status: 'in_transit', stage: 'in_transit' }],
  ['SC_INBOUND', { status: 'in_transit', stage: 'in_transit' }],
  ['CREATE_ORDER_CES', { status: 'pending', stage: 'registered' }],
]);

export function ecoscootingStatus(code: string): ClassifiedStatus | undefined { return CODES.get(code); }
