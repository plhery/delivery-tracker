import type { ClassifiedStatus } from '../../core/status';

const CODES: Record<string, ClassifiedStatus> = {
  '10601': { status: 'pending', stage: 'registered' },
  '10100': { status: 'in_transit', stage: 'accepted' },
  '20700': { status: 'in_transit', stage: 'in_transit' },
  '20800': { status: 'in_transit', stage: 'in_transit' },
  '21600': { status: 'in_transit', stage: 'in_transit' },
  '21700': { status: 'in_transit', stage: 'ready_for_pickup' },
  '2201': { status: 'in_transit', stage: 'in_transit' },
  '24300': { status: 'in_transit', stage: 'customs' },
  '27900': { status: 'in_transit', stage: 'in_transit' },
  '29500': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  '31200': { status: 'exception', stage: 'exception' },
  '4006': { status: 'in_transit', stage: 'in_transit' },
  '4021': { status: 'in_transit', stage: 'in_transit' },
  '4024': { status: 'in_transit', stage: 'in_transit' },
  '4074': { status: 'in_transit', stage: 'in_transit' },
  '41000': { status: 'delivered', stage: 'delivered' },
  '48000': { status: 'delivered', stage: 'delivered' },
  '67300': { status: 'in_transit', stage: 'in_transit' },
  '70800': { status: 'in_transit', stage: 'in_transit' },
  '82700': { status: 'in_transit', stage: 'customs' },
  '82800': { status: 'in_transit', stage: 'in_transit' },
  '89000': { status: 'in_transit', stage: 'customs' },
  '89100': { status: 'in_transit', stage: 'in_transit' },
  '97700': { status: 'in_transit', stage: 'in_transit' },
};

export function ukrposhtaStatus(code: string): ClassifiedStatus | undefined {
  return Object.hasOwn(CODES, code) ? CODES[code] : undefined;
}

// "Returned to Sender" is the decision to start the journey back. The
// separate "Return: Delivered to Sender" scan confirms its completion.
export function ukrposhtaReturnCue(label: string): boolean {
  return /^Return: /i.test(label) || /^Returned to Sender(?:\s|\()/i.test(label);
}
