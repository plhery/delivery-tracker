/**
 * Hermes Germany status classification.
 *
 * The public recipient service labels every history row with a stable
 * `parcelStatus` enum, so this carrier is mapped by code alone: no wording
 * rules, no language guessing. `description` is the fallback text used when the
 * row carries no `historyText` of its own.
 *
 * A code that is not in this map is deliberately left unclassified. The adapter
 * then reports the shipment as `unknown` rather than inventing a stage, and the
 * sync records the wording for review.
 */
import type { CarrierStatus } from '../../core/result';
import type { Stage } from '../../generated/catalog';

export interface Milestone {
  stage: Stage;
  status: CarrierStatus;
  description: string;
}

function milestone(stage: Stage, status: CarrierStatus, description: string): Milestone {
  return { stage, status, description };
}

/** `parcelStatus` → milestone, read from the public recipient bundle on 2026-09-08. */
export const STATUSES: Record<string, Milestone> = {
  ANNOUNCED: milestone('registered', 'pending', 'Shipment announced to Hermes'),
  ORDER_INFO_RECEIVED: milestone('registered', 'pending', 'Shipment announced to Hermes'),
  PREANNOUNCED: milestone('registered', 'pending', 'Shipment announced to Hermes'),
  PARCELSHOP_DROP_OFF: milestone('registered', 'pending', 'Dropped off at a ParcelShop'),
  ATG_OUT_OF_WAREHOUSE: milestone('registered', 'pending', 'Sender preparing handover to Hermes'),
  HANDED_OVER: milestone('accepted', 'in_transit', 'Shipment handed to Hermes'),
  HANDED_OVER_TO_HERMES: milestone('accepted', 'in_transit', 'Shipment handed to Hermes'),
  TAKEN_OVER_BY_HERMES: milestone('accepted', 'in_transit', 'Shipment collected by Hermes'),
  PICKED_UP: milestone('accepted', 'in_transit', 'Shipment collected by Hermes'),
  SHIPMENT_PICKED_UP: milestone('accepted', 'in_transit', 'Shipment collected by Hermes'),
  PARCELSHOP_COLLECTED_BY_DRIVER: milestone('accepted', 'in_transit', 'Shipment collected by Hermes'),
  ARRIVED_IN_DESTINATION_REGION: milestone('in_transit', 'in_transit', 'Shipment arrived in the destination region'),
  ARRIVED_AT_DEPOT: milestone('in_transit', 'in_transit', 'Shipment arrived at the depot'),
  ARRIVED_AT_DELIVERY_DEPOT: milestone('in_transit', 'in_transit', 'Shipment arrived at the delivery depot'),
  ARRIVED_IN_DESTINATION_REGION_V2: milestone('in_transit', 'in_transit', 'Shipment arrived in the destination region'),
  IN_TRANSIT: milestone('in_transit', 'in_transit', 'Shipment in transit'),
  SORTED: milestone('in_transit', 'in_transit', 'Shipment sorted at the hub'),
  DELIVERY_TOUR_STARTED: milestone('out_for_delivery', 'out_for_delivery', 'Out for delivery'),
  OUT_FOR_DELIVERY: milestone('out_for_delivery', 'out_for_delivery', 'Out for delivery'),
  NEXT_STOP: milestone('out_for_delivery', 'out_for_delivery', 'Courier is at the next stop'),
  DELIVERED: milestone('delivered', 'delivered', 'Delivered'),
  DELIVERED_HOMEDELIVERY: milestone('delivered', 'delivered', 'Delivered'),
  DELIVERED_NEIGHBOUR: milestone('delivered', 'delivered', 'Delivered to a neighbour'),
  DELIVERED_DROPOFF: milestone('delivered', 'delivered', 'Delivered to the agreed safe place'),
  DELIVERED_MAILBOX: milestone('delivered', 'delivered', 'Delivered to the mailbox'),
  DELIVERED_PARCELSHOP: milestone('delivered', 'delivered', 'Collected at the ParcelShop'),
  DELIVERED_PARCELBOX: milestone('delivered', 'delivered', 'Delivered to the parcel box'),
  PICKED_UP_BY_RECIPIENT: milestone('delivered', 'delivered', 'Collected by the recipient'),
  COLLECTED: milestone('delivered', 'delivered', 'Collected by the recipient'),
  READY_FOR_PICKUP: milestone('ready_for_pickup', 'out_for_delivery', 'Ready for collection'),
  PARCELSHOP_ITEMS_FOR_COLLECTION: milestone('ready_for_pickup', 'out_for_delivery', 'Ready for collection at the ParcelShop'),
  READY_FOR_COLLECTION: milestone('ready_for_pickup', 'out_for_delivery', 'Ready for collection'),
  DELIVERY_FAILED: milestone('failed_attempt', 'exception', 'Delivery attempt unsuccessful'),
  NOT_DELIVERABLE: milestone('exception', 'exception', 'Shipment not deliverable'),
  UNKNOWN_WHEREABOUTS: milestone('exception', 'exception', 'Shipment whereabouts unknown'),
  RETURN_TO_SENDER: milestone('returned', 'exception', 'Returning to sender'),
  RETURN_DELIVERED_TO_SENDER: milestone('returned', 'exception', 'Returned to sender'),
  RETURN: milestone('returned', 'exception', 'Returning to sender'),
  RETOURE_DELIVERED: milestone('returned', 'exception', 'Returned to sender'),
};

// Pre-announcement preference bookings fire before collection and must never
// move the parcel backwards on their own.
export const IGNORED_BOOKING_STATUS = new Set(['EDL_BOOKED_DROPOFF']);

/** The milestone for a `parcelStatus`, or undefined when the code is not mapped. */
export function hermesGermanyMilestone(parcelStatus: string): Milestone | undefined {
  return Object.hasOwn(STATUSES, parcelStatus) ? STATUSES[parcelStatus] : undefined;
}
