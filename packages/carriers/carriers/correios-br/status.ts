import type { ClassifiedStatus } from '../../core/status';

// Subtypes distinguish delivery from address problems and cancelled dispatches.
const codes: Record<string, ClassifiedStatus> = {
  'BDE/01': { status: 'delivered', stage: 'delivered' },
  'BDE/34': { status: 'exception', stage: 'exception' },
  'BDE/47': { status: 'exception', stage: 'exception' },
  'OEC/01': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'DO/01': { status: 'in_transit', stage: 'in_transit' },
  'RO/01': { status: 'in_transit', stage: 'in_transit' },
  'PAR/10': { status: 'in_transit', stage: 'in_transit' },
  'PAR/16': { status: 'in_transit', stage: 'accepted' },
  'PO/01': { status: 'in_transit', stage: 'accepted' },
  'PAR/07': { status: 'in_transit', stage: 'in_transit' },
  'PAR/21': { status: 'in_transit', stage: 'customs' },
};

export function classifyCorreiosStatus(code: string): ClassifiedStatus | undefined {
  return Object.hasOwn(codes, code) ? codes[code] : undefined;
}
