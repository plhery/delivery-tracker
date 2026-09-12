import type { Stage } from '../types';
import type { IconName } from '../components/Icon';

export function parcelTone(stage?: Stage | null) {
  if (stage === 'delivered') return 'green';
  if (stage && ['customs', 'exception', 'failed_attempt', 'ready_for_pickup', 'returned'].includes(stage)) return 'peach';
  if (stage === 'out_for_delivery') return 'ochre';
  if (!stage || stage === 'pending' || stage === 'registered') return 'lilac';
  return 'blue';
}

export function parcelIcon(stage?: Stage | null): IconName {
  if (stage === 'delivered') return 'check';
  if (stage === 'ready_for_pickup') return 'location';
  if (stage === 'customs') return 'globe';
  if (stage === 'returned') return 'back';
  if (stage === 'exception') return 'parcel';
  if (stage === 'in_transit' || stage === 'out_for_delivery') return 'truck';
  return 'parcel';
}
