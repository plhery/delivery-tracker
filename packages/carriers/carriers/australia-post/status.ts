import type { ClassifiedStatus } from '../../core/status';

// Event codes and milestone labels consumed by the public tracking application.
// statuses.json distinguishes live vocabulary from synthetic status boundaries.
const CODES: Record<string, ClassifiedStatus> = {
  'DD-ER15': { stage: 'delivered', status: 'delivered' },
  'AFP-ER13': { stage: 'out_for_delivery', status: 'out_for_delivery' },
  'TTP-ER81': { stage: 'in_transit', status: 'in_transit' },
  'AFP-ER37': { stage: 'in_transit', status: 'in_transit' },
  'NSS-ER42': { stage: 'in_transit', status: 'in_transit' },
  'AFC-ER36': { stage: 'accepted', status: 'in_transit' },
  'ADMIN-ER40': { stage: 'registered', status: 'pending' },
  'ADMIN-ER39': { stage: 'registered', status: 'pending' },
  'CE-SR05': { stage: 'registered', status: 'pending' },
};
const LABELS: Record<string, ClassifiedStatus> = {
  'delivered': { stage: 'delivered', status: 'delivered' },
  "it's coming today": { stage: 'out_for_delivery', status: 'out_for_delivery' },
  'onboard for delivery': { stage: 'out_for_delivery', status: 'out_for_delivery' },
  'out for delivery': { stage: 'out_for_delivery', status: 'out_for_delivery' },
  "it's on its way": { stage: 'in_transit', status: 'in_transit' },
  'in transit': { stage: 'in_transit', status: 'in_transit' },
  "we've got it": { stage: 'accepted', status: 'in_transit' },
  'label created by sender': { stage: 'registered', status: 'pending' },
  'awaiting collection': { stage: 'ready_for_pickup', status: 'in_transit' },
  'attempted delivery': { stage: 'failed_attempt', status: 'exception' },
  'delayed': { stage: 'exception', status: 'exception' },
  'return to sender': { stage: 'returned', status: 'exception' },
  'returned to sender': { stage: 'returned', status: 'exception' },
};

export function australiaPostStatus(label: string, code?: string): ClassifiedStatus | undefined {
  if (code && Object.hasOwn(CODES, code)) return CODES[code];
  const key = label.trim().toLowerCase().replace(/’/g, "'");
  return Object.hasOwn(LABELS, key) ? LABELS[key] : undefined;
}
