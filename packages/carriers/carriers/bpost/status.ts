import type { ClassifiedStatus } from '../../core/status';

const WORDINGS: Record<string, ClassifiedStatus> = {
  'Item delivered': { status: 'delivered', stage: 'delivered' },
  'Item available at Pick-up point': { status: 'in_transit', stage: 'ready_for_pickup' },
  "The postman's delivery round for your item has started": { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'Your shipment has arrived at the postal operator of the country of destination and will be delivered in the coming days': { status: 'in_transit', stage: 'in_transit' },
  'Your item has been sorted': { status: 'in_transit', stage: 'in_transit' },
  'Item is ready for transport': { status: 'in_transit', stage: 'in_transit' },
  'Shipment ready for transport': { status: 'in_transit', stage: 'in_transit' },
  'Departure to country of destination': { status: 'in_transit', stage: 'in_transit' },
  'Arrival at international depot': { status: 'in_transit', stage: 'in_transit' },
  'Parcel is handled': { status: 'in_transit', stage: 'in_transit' },
  'Landmark Global (bpost) has received the item': { status: 'in_transit', stage: 'accepted' },
  'Confirmation of preparation of the shipment received': { status: 'pending', stage: 'registered' },
  'Item is announced / Landmark Global (bpost) received the information': { status: 'pending', stage: 'registered' },
};

export function classifyBpostStatus(description: string): ClassifiedStatus | undefined {
  return Object.hasOwn(WORDINGS, description) ? WORDINGS[description] : undefined;
}
