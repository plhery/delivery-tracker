import type { ClassifiedStatus } from '../../core/status';

const WORDING = new Map<string, ClassifiedStatus>([
  ['Posting/Collection', { status: 'in_transit', stage: 'accepted' }],
  ['Departure from inward office of exchange', { status: 'in_transit', stage: 'in_transit' }],
  ['Arrival at Office of Exchange', { status: 'in_transit', stage: 'in_transit' }],
  ['Arrival at outward office of exchange', { status: 'in_transit', stage: 'in_transit' }],
  ['Ready for dispatch', { status: 'in_transit', stage: 'in_transit' }],
  ['Handed over to a transport company', { status: 'in_transit', stage: 'in_transit' }],
  ['Received by Air carriers', { status: 'in_transit', stage: 'in_transit' }],
  ['Departure from the Airport', { status: 'in_transit', stage: 'in_transit' }],
  ['Arrival at Destination Airport', { status: 'in_transit', stage: 'in_transit' }],
  ['Delivered to Destination Post', { status: 'in_transit', stage: 'in_transit' }],
  ['Arrival at inward office of exchange', { status: 'in_transit', stage: 'in_transit' }],
  ['Ready for customs clearance', { status: 'in_transit', stage: 'customs' }],
  ['Unsuccessful delivery', { status: 'exception', stage: 'failed_attempt' }],
  ['Delivery complete', { status: 'delivered', stage: 'delivered' }],
]);

export function koreaPostStatus(description: string): ClassifiedStatus | undefined {
  return WORDING.get(description);
}
