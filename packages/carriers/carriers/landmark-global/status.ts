import type { ClassifiedStatus } from '../../core/status';

const WORDINGS = new Map<string, ClassifiedStatus>([
  ['Delivered', { status: 'delivered', stage: 'delivered' }],
  ['Delivered to your community mailbox, parcel locker or apt./condo mailbox', { status: 'delivered', stage: 'delivered' }],
  ...['Onboard for delivery', 'Item out for delivery'].map(wording => [wording, { status: 'out_for_delivery', stage: 'out_for_delivery' }] as [string, ClassifiedStatus]),
  ['Shipment Data Uploaded', { status: 'pending', stage: 'registered' }],
  ['Transmitted customs information', { status: 'in_transit', stage: 'customs' }],
  ...['Customs cleared', 'Item processed at facility', 'Item processed', 'Received in destination country',
    'Crossing border and in transit to carrier hub', 'Scanned at Landmark crossdock facility', 'Processed',
    'Shipment received at originating postal facility', 'Departure to country of destination', 'Shipment has arrived at depot',
    'Received at international processing center', 'Incoming scan at facility', 'Shipment has departed from airport',
    'Shipment has departed from depot'].map(wording => [wording, { status: 'in_transit', stage: 'in_transit' }] as [string, ClassifiedStatus]),
]);

export function landmarkStatus(wording: string): ClassifiedStatus | undefined { return WORDINGS.get(wording); }
