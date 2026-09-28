import type { ClassifiedStatus } from '../../core/status';

const WORDING = new Map<string, ClassifiedStatus>([
  ['Delivered.', { status: 'delivered', stage: 'delivered' }],
  ['Shipment out for delivery.', { status: 'out_for_delivery', stage: 'out_for_delivery' }],
  ['<User not at home>', { status: 'exception', stage: 'failed_attempt' }],
  ['<wrong address>', { status: 'exception', stage: 'failed_attempt' }],
  ['Arrived.', { status: 'in_transit', stage: 'in_transit' }],
  ['Received.', { status: 'in_transit', stage: 'in_transit' }],
  ['Batch delivery to carrier', { status: 'in_transit', stage: 'in_transit' }],
  ['Pick up by local carrier at destination port', { status: 'in_transit', stage: 'in_transit' }],
  ['International shipment release - Import', { status: 'in_transit', stage: 'in_transit' }],
  ['International shipment release - Export', { status: 'in_transit', stage: 'in_transit' }],
  ['Port of destination - Arrival', { status: 'in_transit', stage: 'in_transit' }],
  ['Port of departure - Departure', { status: 'in_transit', stage: 'in_transit' }],
  ['Port of departure - Received by carrier', { status: 'in_transit', stage: 'in_transit' }],
  ['Arrived at domestic terminal station', { status: 'in_transit', stage: 'in_transit' }],
  ['Yanwen facility - Outbound', { status: 'in_transit', stage: 'in_transit' }],
  ['Yanwen Pickup Scan', { status: 'in_transit', stage: 'accepted' }],
  ['Order processed by shipper', { status: 'pending', stage: 'registered' }],
  ['Order Submited.', { status: 'pending', stage: 'registered' }],
]);

export function yanwenStatus(description: string): ClassifiedStatus | undefined {
  // Partner wording can prefix its facility in full-width brackets. Removing
  // that observed prefix makes the remaining exact wording reusable.
  return WORDING.get(description.replace(/^【[^】]*】\s*/, '').trim());
}
