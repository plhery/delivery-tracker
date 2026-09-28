import type { ClassifiedStatus } from '../../core/status';

// Event codes observed in the official anonymous tracking service. The
// website's lifecycle rail combines these into much broader presentation states.
const codes: Record<string, ClassifiedStatus> = {
  '3010': { status: 'pending', stage: 'registered' },
  '2380': { status: 'in_transit', stage: 'accepted' },
  '0300': { status: 'in_transit', stage: 'in_transit' },
  '4060': { status: 'in_transit', stage: 'in_transit' },
  '7220': { status: 'in_transit', stage: 'in_transit' },
  '7525': { status: 'in_transit', stage: 'in_transit' },
  '4200': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  '9260': { status: 'exception', stage: 'failed_attempt' },
  '9550': { status: 'in_transit', stage: 'ready_for_pickup' },
  '9500': { status: 'delivered', stage: 'delivered' },
};

export function classifyPurolatorStatus(code: string): ClassifiedStatus | undefined {
  return Object.hasOwn(codes, code) ? codes[code] : undefined;
}
