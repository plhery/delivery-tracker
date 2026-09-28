import type { ClassifiedStatus } from '../../core/status';

// Codes and their labels come from the official tracking widget. EN_ROUTE and
// OTHER also cover several distinct milestones and administrative notices.
const codes: Record<string, ClassifiedStatus> = {
  CREATED: { status: 'pending', stage: 'registered' },
  INFORMED: { status: 'pending', stage: 'registered' },
  EN_ROUTE: { status: 'in_transit', stage: 'in_transit' },
  AVAILABLE_FOR_DELIVERY: { status: 'in_transit', stage: 'ready_for_pickup' },
  DELIVERED: { status: 'delivered', stage: 'delivered' },
  DELIVERY_IMPOSSIBLE: { status: 'exception', stage: 'failed_attempt' },
  DELIVERY_REFUSED: { status: 'exception', stage: 'failed_attempt' },
  RETURNED: { status: 'exception', stage: 'returned' },
  DELAYED: { status: 'exception', stage: 'exception' },
  STOPPED: { status: 'exception', stage: 'exception' },
  CUSTOMS_STOPPED_VAT: { status: 'exception', stage: 'customs' },
};

export function isPostnordAdministrativeEvent(code: string, description: string): boolean {
  return code === 'OTHER' && [
    'Suggested delivery time.',
    'Information to the driver added by the recipient.',
    'A text message notification has been delivered to the recipient.',
    'Notification sent via APP.',
  ].includes(description);
}

export function classifyPostnordStatus(code: string, description = ''): ClassifiedStatus | undefined {
  if (code === 'EN_ROUTE' || code === 'OTHER') {
    if (description === 'The delivery of the shipment item is in progress.') {
      return { status: 'out_for_delivery', stage: 'out_for_delivery' };
    }
    if ([
      'The shipment item is under transportation.',
      'The shipment item has arrived at the distribution terminal.',
      'Your item is being processed at our sorting center.',
      'The shipment item has been loaded.',
    ].includes(description)) return { status: 'in_transit', stage: 'in_transit' };
  }
  return codes[code];
}
