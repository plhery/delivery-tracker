import type { ClassifiedStatus } from '../../core/status';

const DELIVERED: ClassifiedStatus = { stage: 'delivered', status: 'delivered' };
const TRANSIT: ClassifiedStatus = { stage: 'in_transit', status: 'in_transit' };
const EXCEPTION: ClassifiedStatus = { stage: 'exception', status: 'exception' };
const RETURNED: ClassifiedStatus = { stage: 'returned', status: 'exception' };
const REASONS = new Map<string, ClassifiedStatus>([['1', DELIVERED], ['2', EXCEPTION], ['3', TRANSIT], ['4', RETURNED], ['6', EXCEPTION]]);
const SUMMARY = new Map<string, ClassifiedStatus>([['2', EXCEPTION], ['3', TRANSIT], ['4', RETURNED], ['5', EXCEPTION], ['6', EXCEPTION], ['99', TRANSIT], ['100', DELIVERED]]);

// The official Taiwan frontend's operation-code groups, plus codes observed in
// its public route response. The warehouse "delivered" group means dispatched.
const CODES = new Map<string, ClassifiedStatus>([
  ...['80', '8000_1', '980'].map((code) => [code, DELIVERED] as const),
  ...['50', '54', '950'].map((code) => [code, { stage: 'accepted', status: 'in_transit' } as const] as const),
  ...['44', '34', '122', '123', '630', '640', '83', '47', '634', '125', '204', '70_5', '70_7', '70_65']
    .map((code) => [code, { stage: 'out_for_delivery', status: 'out_for_delivery' } as const] as const),
  ...['14', '30', '31', '36', '105', '106', '88', '89', '205', '201', '206', '646', '202', '626']
    .map((code) => [code, TRANSIT] as const),
  ['8000_2', EXCEPTION],
]);

/** Code 8000 is ambiguous without its reason; do not default it to signed. */
export function sfExpressEventStatus(code: string, reason: string): ClassifiedStatus | undefined {
  if (code === '8000') {
    return REASONS.get(reason);
  }
  return CODES.get(code);
}

export function sfExpressSummaryStatus(state: string, signed: boolean): ClassifiedStatus | undefined {
  const explicit = SUMMARY.get(state);
  return explicit ?? (signed ? DELIVERED : undefined);
}
