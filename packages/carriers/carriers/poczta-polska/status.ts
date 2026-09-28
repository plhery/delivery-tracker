import type { ClassifiedStatus } from '../../core/status';

// The specific scan code takes precedence over its broader state label: an
// unsuccessful delivery can still carry the state DOR (in delivery).
const CODES: Record<string, ClassifiedStatus> = {
  P_REJ_KN1: { status: 'pending', stage: 'registered' },
  P_NAD: { status: 'in_transit', stage: 'accepted' },
  P_PZL: { status: 'in_transit', stage: 'in_transit' },
  P_WZL: { status: 'in_transit', stage: 'in_transit' },
  P_WEOC: { status: 'in_transit', stage: 'in_transit' },
  P_WYPL: { status: 'in_transit', stage: 'in_transit' },
  P_WD: { status: 'out_for_delivery', stage: 'out_for_delivery' },
  P_D: { status: 'delivered', stage: 'delivered' },
};
const FAILED_DELIVERY = new Set(['P_ND', 'P_NDZ', 'P_NDZK', 'P_NDPD', 'P_R',
  'P_NDZAP', 'P_NDZKON', 'P_ZDUN', 'P_CZDKN', 'P_NDPJ']);

export function classifyPocztaPolskaStatus(code: string): ClassifiedStatus | undefined {
  if (Object.hasOwn(CODES, code)) return CODES[code];
  if (FAILED_DELIVERY.has(code)) return { status: 'exception', stage: 'exception' };
  return undefined;
}
