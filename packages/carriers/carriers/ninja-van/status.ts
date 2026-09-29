import type { ClassifiedStatus } from '../../core/status';

// Public tracking events. The website omits its internal routing and shipment
// bookkeeping rows from the visible timeline.
export const HIDDEN_NINJA_EVENTS = new Set(['ADDED_TO_SHIPMENT', 'PARCEL_ROUTING_SCAN', 'FROM_DP_TO_DRIVER']);

const STATES: Record<string, ClassifiedStatus> = {
  RTS: { status: 'exception', stage: 'exception' },
  DRIVER_PICKUP_SCAN: { status: 'in_transit', stage: 'in_transit' },
  HUB_INBOUND_SCAN: { status: 'in_transit', stage: 'in_transit' },
  DRIVER_INBOUND_SCAN: { status: 'in_transit', stage: 'in_transit' },
  ARRIVED_AT_ORIGIN_HUB: { status: 'in_transit', stage: 'in_transit' },
  ARRIVED_AT_TRANSIT_HUB: { status: 'in_transit', stage: 'in_transit' },
  ARRIVED_AT_DESTINATION_HUB: { status: 'in_transit', stage: 'in_transit' },
  ROUTE_INBOUND_SCAN: { status: 'in_transit', stage: 'in_transit' },
  FROM_SHIPPER_TO_DP: { status: 'in_transit', stage: 'in_transit' },
  FROM_DRIVER_TO_DP: { status: 'in_transit', stage: 'in_transit' },
  FROM_DP_TO_CUSTOMER: { status: 'in_transit', stage: 'in_transit' },
  DELIVERY_SUCCESS: { status: 'delivered', stage: 'delivered' },
  DELIVERY_FAILURE: { status: 'exception', stage: 'failed_attempt' },
  INACCURATE_ADDRESS: { status: 'exception', stage: 'exception' },
  DAMAGE: { status: 'exception', stage: 'exception' },
  LOST: { status: 'exception', stage: 'exception' },
  CANCEL: { status: 'exception', stage: 'exception' },
};

export function ninjaVanStatus(type: string): ClassifiedStatus | undefined {
  return Object.hasOwn(STATES, type) ? STATES[type] : undefined;
}
