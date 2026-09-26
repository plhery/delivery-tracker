import type { ClassifiedStatus } from '../../core/status';

// Exact English tracking labels from the official Japan Post result table and
// its tracking notices. Provenance is recorded in statuses.json.
const STATUS = new Map<string, ClassifiedStatus>([
  ['Posting/Collection', { status: 'in_transit', stage: 'accepted' }],
  ['En route', { status: 'in_transit', stage: 'in_transit' }],
  ['Arrival at outward office of exchange', { status: 'in_transit', stage: 'in_transit' }],
  ['Dispatch from outward office of exchange', { status: 'in_transit', stage: 'in_transit' }],
  ['Arrival at inward office of exchange', { status: 'in_transit', stage: 'in_transit' }],
  ['Item presented to import Customs', { status: 'in_transit', stage: 'customs' }],
  ['In Customs', { status: 'in_transit', stage: 'customs' }],
  ['Item held at inward Office of Exchange', { status: 'in_transit', stage: 'in_transit' }],
  ['Item returned from import Customs', { status: 'in_transit', stage: 'in_transit' }],
  ['Departure from inward office of exchange', { status: 'in_transit', stage: 'in_transit' }],
  ['Processing at delivery Post Office', { status: 'in_transit', stage: 'in_transit' }],
  ['Item out for physical delivery', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['Final delivery', { status: 'delivered', stage: 'delivered' }],
  ['Arrival', { status: 'in_transit', stage: 'in_transit' }],
  ['Dispatched from Exchange Office', { status: 'in_transit', stage: 'in_transit' }],
  ['Transported in bond', { status: 'in_transit', stage: 'customs' }],
  ['Arrived in bond', { status: 'in_transit', stage: 'customs' }],
  ['Returned to sender', { status: 'exception', stage: 'returned' }],
]);

export function japanPostStatus(description: string): ClassifiedStatus | undefined {
  return STATUS.get(description);
}
