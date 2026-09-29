import type { ClassifiedStatus } from '../../core/status';

const groups: Array<[string[], ClassifiedStatus]> = [
  [['submitted', 'pending-approval', 'collection-assigned', 'awaiting-dropoff', 'collection-accepted'], { status: 'pending', stage: 'registered' }],
  [['collected'], { status: 'in_transit', stage: 'accepted' }],
  [['at-hub', 'manifested', 'ready-for-dispatch', 'in-transit', 'at-destination-hub', 'returned-to-hub',
    'delivery-assigned', 'delivery-scheduled', 'outsourced', 'collect-and-return-to-hub', 'return-to-hub'], { status: 'in_transit', stage: 'in_transit' }],
  [['out-for-delivery'], { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  [['ready-for-pickup', 'in-locker'], { status: 'in_transit', stage: 'ready_for_pickup' }],
  [['delivered', 'collected-from-locker', 'collected-from-counter'], { status: 'delivered', stage: 'delivered' }],
  [['returned-to-sender'], { status: 'exception', stage: 'returned' }],
  [['cancelled', 'collection-exception', 'collection-failed-attempt', 'delivery-exception', 'delivery-failed-attempt',
    'inbound-customs-and-vat', 'on-hold', 'undeliverable', 'under-query', 'damaged'], { status: 'exception', stage: 'exception' }],
];
const codes = new Map(groups.flatMap(([names, status]) => names.map(name => [name, status] as const)));

export function courierGuyStatus(code: string): ClassifiedStatus | undefined { return codes.get(code); }

/** The consumer page hides operational events from the shipment timeline. */
export const HIDDEN_COURIER_GUY_CODES = new Set(['bob-box-reservation-failed', 'on-hold-internal', 'delivery-rejected',
  'delivery-unassigned', 'collection-rejected', 'collection-unassigned', 'collection-accepted',
  'bob-box-dropoff-pin-revealed', 'operational-event']);

export function courierGuyWording(code: string): string {
  return code === 'delivered' ? 'Delivered' : code.replaceAll('-', ' ').replace(/^./, letter => letter.toUpperCase());
}
