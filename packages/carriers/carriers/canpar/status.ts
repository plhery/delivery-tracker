import type { ClassifiedStatus } from '../../core/status';

const codes: Record<string, ClassifiedStatus> = {
  DEL: { status: 'delivered', stage: 'delivered' },
  NSR: { status: 'delivered', stage: 'delivered' },
  WC: { status: 'out_for_delivery', stage: 'out_for_delivery' },
  PIC: { status: 'in_transit', stage: 'accepted' },
  ARR: { status: 'in_transit', stage: 'in_transit' },
  DPT: { status: 'in_transit', stage: 'in_transit' },
  SRT: { status: 'in_transit', stage: 'in_transit' },
  COA: { status: 'in_transit', stage: 'in_transit' },
  MIS: { status: 'exception', stage: 'exception' },
  NL: { status: 'exception', stage: 'failed_attempt' },
  RTN: { status: 'exception', stage: 'returned' },
};

export function canparStatus(code: string): ClassifiedStatus | undefined {
  return Object.hasOwn(codes, code) ? codes[code] : undefined;
}
