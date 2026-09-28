import type { ClassifiedStatus } from '../../core/status';

const vocabulary: Record<string, ClassifiedStatus> = {
  'shipment delivered': { status: 'delivered', stage: 'delivered' },
  'shipment out for delivery': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'shipment arrived': { status: 'in_transit', stage: 'in_transit' },
  'shipment arrived at hub': { status: 'in_transit', stage: 'in_transit' },
  'shipment further connected': { status: 'in_transit', stage: 'in_transit' },
  'clubbed canvas bag scan': { status: 'in_transit', stage: 'in_transit' },
  'delivery delayed': { status: 'exception', stage: 'exception' },
  'delay caused beyond control': { status: 'exception', stage: 'exception' },
  'cnee refused id/otp not shared-incorrect': { status: 'exception', stage: 'failed_attempt' },
};

export function classifyBlueDartStatus(wording: string): ClassifiedStatus | undefined {
  return vocabulary[wording.toLowerCase()];
}
