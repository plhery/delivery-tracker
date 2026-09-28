import type { ClassifiedStatus } from '../../core/status';

const statuses: Record<string, ClassifiedStatus> = {
  DELIVERED: { status: 'delivered', stage: 'delivered' },
  'OUT FOR DELIVERY': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'IN TRANSIT': { status: 'in_transit', stage: 'in_transit' },
  'PICKED UP': { status: 'in_transit', stage: 'accepted' },
  MANIFESTED: { status: 'pending', stage: 'registered' },
  'RTO DELIVERED': { status: 'exception', stage: 'returned' },
};

export function classifyDelhiveryStatus(value: string): ClassifiedStatus | undefined {
  return statuses[value.toUpperCase()];
}
