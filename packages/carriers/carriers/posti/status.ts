import type { ClassifiedStatus } from '../../core/status';

// ConsumerShipmentStatusMain in Posti's public parcels bundle, inspected
// 2026-09-21. Return movement is not a completed return.
const MAIN: Record<string, ClassifiedStatus> = {
  ORDER_RECEIVED: { status: 'pending', stage: 'registered' },
  WAITING: { status: 'pending', stage: 'registered' },
  RECEIVED: { status: 'in_transit', stage: 'accepted' },
  IN_TRANSPORT: { status: 'in_transit', stage: 'in_transit' },
  IN_DELIVERY: { status: 'out_for_delivery', stage: 'out_for_delivery' },
  READY_FOR_PICKUP: { status: 'in_transit', stage: 'ready_for_pickup' },
  DELIVERED: { status: 'delivered', stage: 'delivered' },
  RETURN_WAITING: { status: 'in_transit', stage: 'in_transit' },
  RETURN_IN_TRANSPORT: { status: 'in_transit', stage: 'in_transit' },
  RETURN_READY_FOR_PICKUP: { status: 'in_transit', stage: 'in_transit' },
  RETURN_DELIVERED: { status: 'exception', stage: 'returned' },
};

export function postiStatus(main: string, subStatus: string[]): ClassifiedStatus | undefined {
  if (main === 'IN_TRANSPORT' && subStatus.some((code) => ['IN_CUSTOMS_PROCESS', 'UNDECLARED'].includes(code))) {
    return { status: 'in_transit', stage: 'customs' };
  }
  return MAIN[main];
}

/** Map each scan's own label, never the current parcel state or explanatory reason text. */
export function postiEventStage(description: string): string {
  const text = description.trim().toLowerCase();
  if (/^(?:the )?item has been delivered\.?$/.test(text)) return 'delivered';
  if (/^(?:the )?item is ready for (?:a )?pick ?up\.?$/.test(text)) return 'ready_for_pickup';
  if (/^(?:the )?item is (?:out for|in) delivery\.?$/.test(text)) return 'out_for_delivery';
  if (/^(?:the )?item has been returned to (?:the )?sender\.?$/.test(text)) return 'returned';
  if (/^declare the item|^the item has been declared|^handling fee for item/.test(text)) return 'customs';
  if (/^(?:the )?item (?:is in (?:sorting|transport)|accepted from transport|has been released for delivery|arrived in the destination country|has departed from country of origin)/.test(text)) return 'in_transit';
  if (/^(?:the )?item (?:has been received|has been accepted)/.test(text)) return 'accepted';
  // Notifications, electronic pre-advice and unmapped wording prove no new movement.
  return 'pending';
}
