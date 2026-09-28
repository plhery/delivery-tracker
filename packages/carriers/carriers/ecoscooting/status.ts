import type { ClassifiedStatus } from '../../core/status';

const CODES = new Map<string, ClassifiedStatus>([
  ['GTMS_SIGNED', { status: 'delivered', stage: 'delivered' }],
  ['GTMS_DO_DEPART', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['GTMS_DEL_FAILURE', { status: 'exception', stage: 'failed_attempt' }],
  ['GTMS_ACCEPT', { status: 'in_transit', stage: 'accepted' }],
  ['TD_TRANSWH_OUTBOUND', { status: 'in_transit', stage: 'in_transit' }],
  ['TD_TRANS_ARRIVE_C', { status: 'in_transit', stage: 'in_transit' }],
]);

export function ecoscootingStatus(code: string): ClassifiedStatus | undefined { return CODES.get(code); }
