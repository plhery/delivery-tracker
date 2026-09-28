import type { ClassifiedStatus } from '../../core/status';

// The official client's milestone groups distinguish delivery, transfer and
// completed return. Failed attempts are observed individual scan states.
const STATES = new Map<number, ClassifiedStatus>([
  [190, { status: 'pending', stage: 'registered' }],
  [1870, { status: 'pending', stage: 'registered' }],
  ...[199, 1910, 4010, 195, 255, 218, 219, 200].map(code => [code, { status: 'in_transit', stage: 'in_transit' }] as [number, ClassifiedStatus]),
  [202, { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  [211, { status: 'exception', stage: 'failed_attempt' }],
  ...[203, 216, 228].map(code => [code, { status: 'delivered', stage: 'delivered' }] as [number, ClassifiedStatus]),
  [217, { status: 'in_transit', stage: 'in_transit' }],
  ...[206, 207, 209, 215, 222, 229, 235].map(code => [code, { status: 'exception', stage: 'exception' }] as [number, ClassifiedStatus]),
  [230, { status: 'exception', stage: 'returned' }],
]);

export function uniuniStatus(code: number): ClassifiedStatus | undefined {
  return STATES.get(code);
}
