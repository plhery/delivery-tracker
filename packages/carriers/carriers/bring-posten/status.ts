import type { ClassifiedStatus } from '../../core/status';

const groups: Array<[string[], ClassifiedStatus]> = [
  [['PRE_NOTIFIED', 'READY_FROM_SENDER', 'DELIVERY_ORDERED'], { status: 'pending', stage: 'registered' }],
  [['HANDED_IN', 'COLLECTED', 'COURIER_PICK_UP', 'PICKUP_FROM_MAILBOX'], { status: 'in_transit', stage: 'accepted' }],
  [['TERMINAL', 'INTERNATIONAL', 'IN_TRANSIT', 'CUSTOMS', 'RETURN', 'DELIVERY_CHANGED'], { status: 'in_transit', stage: 'in_transit' }],
  [['TRANSPORT_TO_RECIPIENT'], { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  [['READY_FOR_PICKUP'], { status: 'in_transit', stage: 'ready_for_pickup' }],
  [['DELIVERED'], { status: 'delivered', stage: 'delivered' }],
  [['DELIVERED_SENDER'], { status: 'exception', stage: 'returned' }],
  [['ATTEMPTED_DELIVERY', 'DEVIATION', 'DELIVERY_CANCELLED'], { status: 'exception', stage: 'exception' }],
];
const codes = new Map(groups.flatMap(([names, status]) => names.map(name => [name, status] as const)));

export function bringStatus(code: string): ClassifiedStatus | undefined { return codes.get(code); }

const labels = new Map([
  ['PRE_NOTIFIED', 'Shipment information received'], ['READY_FROM_SENDER', 'Ready for collection'],
  ['DELIVERY_ORDERED', 'Delivery requested'], ['HANDED_IN', 'Handed in'], ['COLLECTED', 'Collected'],
  ['COURIER_PICK_UP', 'Collected by courier'], ['PICKUP_FROM_MAILBOX', 'Collected from mailbox'],
  ['TERMINAL', 'At terminal'], ['INTERNATIONAL', 'International transport'], ['IN_TRANSIT', 'In transit'],
  ['CUSTOMS', 'Customs clearance'], ['RETURN', 'Returning to sender'], ['DELIVERY_CHANGED', 'Delivery rescheduled'],
  ['TRANSPORT_TO_RECIPIENT', 'Out for delivery'], ['READY_FOR_PICKUP', 'Ready for pickup'],
  ['DELIVERED', 'Delivered'], ['DELIVERED_SENDER', 'Returned to sender'], ['ATTEMPTED_DELIVERY', 'Delivery attempted'],
  ['DEVIATION', 'Delivery exception'], ['DELIVERY_CANCELLED', 'Home delivery cancelled'], ['NOTIFICATION_SENT', 'Notification sent'],
]);
export function bringWording(code: string): string { return labels.get(code) ?? code.replaceAll('_', ' ').toLowerCase().replace(/^./, letter => letter.toUpperCase()); }
