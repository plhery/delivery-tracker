import type { ClassifiedStatus } from '../../core/status';

const STATUS = new Map<string, ClassifiedStatus>([
  ['Pickup Awaited', { status: 'pending', stage: 'registered' }],
  ['Pickup Scheduled', { status: 'pending', stage: 'registered' }],
  ['Booked', { status: 'pending', stage: 'registered' }],
  ['Booked at Origin Branch', { status: 'pending', stage: 'registered' }],
  ['Picked Up', { status: 'in_transit', stage: 'accepted' }],
  ['Pickup Completed', { status: 'in_transit', stage: 'accepted' }],
  ['In Transit', { status: 'in_transit', stage: 'in_transit' }],
  ['Out For Delivery', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['Delivered', { status: 'delivered', stage: 'delivered' }],
  ['RTO Booked', { status: 'exception', stage: 'returned' }],
]);

export function dtdcStatus(wording: string): ClassifiedStatus | undefined {
  return STATUS.get(wording);
}
