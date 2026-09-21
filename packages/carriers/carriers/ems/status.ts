import type { ClassifiedStatus } from '../../core/status';

// English labels from the EMS Cooperative public table. Observed vocabulary
// and separately reconstructed terminal examples are recorded in statuses.json.
const STATUS = new Map<string, ClassifiedStatus>([
  ['Posted', { status: 'in_transit', stage: 'accepted' }],
  ['Arrived at export office', { status: 'in_transit', stage: 'in_transit' }],
  ['Presented to export customs and security', { status: 'in_transit', stage: 'customs' }],
  ['Released from export customs and security', { status: 'in_transit', stage: 'in_transit' }],
  ['Departed from export office', { status: 'in_transit', stage: 'in_transit' }],
  ['Held for export customs inspection', { status: 'in_transit', stage: 'customs' }],
  ['Arrived at destination import office', { status: 'in_transit', stage: 'in_transit' }],
  ['Held at destination import office', { status: 'in_transit', stage: 'customs' }],
  ['Presented to import customs', { status: 'in_transit', stage: 'customs' }],
  ['Released from import customs', { status: 'in_transit', stage: 'in_transit' }],
  ['Departed from destination import office', { status: 'in_transit', stage: 'in_transit' }],
  ['Arrived at post office', { status: 'in_transit', stage: 'in_transit' }],
  ['Out for delivery', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['Delivered', { status: 'delivered', stage: 'delivered' }],
  ['Delivery attempted', { status: 'exception', stage: 'failed_attempt' }],
  ['Returned to sender', { status: 'exception', stage: 'returned' }],
]);

export function emsStatus(description: string): ClassifiedStatus | undefined {
  return STATUS.get(description);
}
