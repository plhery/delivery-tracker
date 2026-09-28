import type { ClassifiedStatus } from '../../core/status';

const CODES = new Map<string, ClassifiedStatus>([
  ['100', { status: 'pending', stage: 'registered' }],
  ...['200', '201', '202', '203'].map(code => [code, { status: 'in_transit', stage: 'in_transit' }] as [string, ClassifiedStatus]),
  ['208', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['205', { status: 'delivered', stage: 'delivered' }],
]);

export function gofoStatus(code: string): ClassifiedStatus | undefined { return CODES.get(code); }
