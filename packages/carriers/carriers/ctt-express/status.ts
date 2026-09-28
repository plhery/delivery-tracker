import type { ClassifiedStatus } from '../../core/status';

const codes: Record<string, ClassifiedStatus> = {
  '0000': { status: 'pending', stage: 'registered' },
  '0600': { status: 'exception', stage: 'exception' },
  '1000': { status: 'in_transit', stage: 'in_transit' },
  '1500': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  '1600': { status: 'exception', stage: 'exception' },
  // Actual "Nuevo reparto" scan, grouped with 1500 by the official widget.
  '2400': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  '2310': { status: 'in_transit', stage: 'ready_for_pickup' },
  // The widget explicitly says the parcel is on its way back to the sender.
  '2500': { status: 'exception', stage: 'exception' },
  '2100': { status: 'delivered', stage: 'delivered' },
  '2110': { status: 'delivered', stage: 'delivered' },
};

export function classifyCttExpressStatus(code: string): ClassifiedStatus | undefined {
  return Object.hasOwn(codes, code) ? codes[code] : undefined;
}
