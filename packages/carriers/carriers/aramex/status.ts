import type { ClassifiedStatus } from '../../core/status';

const wording: Record<string, ClassifiedStatus> = {
  'The shipment has been delivered': { status: 'delivered', stage: 'delivered' },
  "An Aramex Delivery Champion has the shipment and is expected to reach the customer's doorstep shortly": { status: 'out_for_delivery', stage: 'out_for_delivery' },
  "We've attempted to deliver the shipment, but the customer was not available at the time. Not to worry, the delivery has been rescheduled": { status: 'exception', stage: 'failed_attempt' },
  'Updated delivery address required from customer': { status: 'exception', stage: 'exception' },
  'The shipment is currently going through customs inspection': { status: 'in_transit', stage: 'customs' },
  'The shipment is on its way to our Aramex facility': { status: 'in_transit', stage: 'in_transit' },
  'The shipment has arrived at the Aramex office at the destination and is being prepared for customer pickup/delivery': { status: 'in_transit', stage: 'in_transit' },
  'The shipment has left the Aramex transit office and is now on its way to the final destination country': { status: 'in_transit', stage: 'in_transit' },
  'The shipment has reached Aramex transit office and is on its way to the final destination office': { status: 'in_transit', stage: 'in_transit' },
  'The shipment is being processed and on its way to the next destination': { status: 'in_transit', stage: 'in_transit' },
  'Shipment collected from the shipper': { status: 'in_transit', stage: 'accepted' },
};

export function classifyAramexStatus(value: string): ClassifiedStatus | undefined {
  return wording[value];
}
