import type { ClassifiedStatus } from '../../core/status';

const CODES = new Map<string, ClassifiedStatus>([
  ['HC', { status: 'in_transit', stage: 'customs' }],
  ['DGS', { status: 'in_transit', stage: 'customs' }],
  ['CS', { status: 'in_transit', stage: 'customs' }],
  ['HE', { status: 'in_transit', stage: 'in_transit' }],
  ['LL', { status: 'in_transit', stage: 'in_transit' }],
  ['AD', { status: 'in_transit', stage: 'in_transit' }],
  ['DA', { status: 'in_transit', stage: 'in_transit' }],
  ['DO', { status: 'in_transit', stage: 'in_transit' }],
  ['PO', { status: 'in_transit', stage: 'accepted' }],
  ['PL', { status: 'in_transit', stage: 'in_transit' }],
  ['DP', { status: 'in_transit', stage: 'accepted' }],
  ['IR', { status: 'pending', stage: 'registered' }],
]);

export function singaporePostStatus(code: string): ClassifiedStatus | undefined {
  return CODES.get(code);
}
