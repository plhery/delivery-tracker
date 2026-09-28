import type { ClassifiedStatus } from '../../core/status';

// The current consumer site's status labels and its published sample history.
const STATUSES: Record<string, ClassifiedStatus & { wording: string }> = {
  '已揽件': { status: 'in_transit', stage: 'accepted', wording: 'Picked up' },
  '运输中': { status: 'in_transit', stage: 'in_transit', wording: 'In transit' },
  '派送中': { status: 'in_transit', stage: 'out_for_delivery', wording: 'Out for delivery' },
  '待取件': { status: 'in_transit', stage: 'ready_for_pickup', wording: 'Ready for pickup' },
  '已签收': { status: 'delivered', stage: 'delivered', wording: 'Delivered' },
};

export const yundaStatus = (label: string) => Object.hasOwn(STATUSES, label.trim()) ? STATUSES[label.trim()] : null;
