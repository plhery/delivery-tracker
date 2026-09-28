import type { ClassifiedStatus } from '../../core/status';

const CODES = new Map<string, ClassifiedStatus>([
  ['FPX_S_OK', { status: 'delivered', stage: 'delivered' }],
  ['FPX_D_SD', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['FPX_L_RPIF', { status: 'pending', stage: 'registered' }],
  ['FPX_O_IRI', { status: 'pending', stage: 'registered' }],
  ['FPX_L_SC', { status: 'in_transit', stage: 'accepted' }],
  ['FPX_C_SPLS', { status: 'in_transit', stage: 'accepted' }],
  ['FPX_C_AAF', { status: 'in_transit', stage: 'in_transit' }],
  ['FPX_C_ADFF', { status: 'in_transit', stage: 'in_transit' }],
  ['FPX_M_HA', { status: 'in_transit', stage: 'in_transit' }],
  ['FPX_M_DFOA', { status: 'in_transit', stage: 'in_transit' }],
  ['FPX_M_ATA', { status: 'in_transit', stage: 'in_transit' }],
  ['FPX_M_CRSD', { status: 'in_transit', stage: 'customs' }],
  ['FPX_I_RCUK', { status: 'in_transit', stage: 'in_transit' }],
  ['FPX_D_STPP', { status: 'in_transit', stage: 'in_transit' }],
  ['FPX_D_HQ', { status: 'in_transit', stage: 'in_transit' }],
  ['FPX_O_RR', { status: 'in_transit', stage: 'in_transit' }],
  ['FPX_M_IT', { status: 'in_transit', stage: 'in_transit' }],
]);

export function fourPxStatus(code: string): ClassifiedStatus | undefined {
  return CODES.get(code);
}
