import type { ClassifiedStatus } from '../../core/status';

// The official portal's statusCodes.json describes both regional code sets.
// Its presentation TYPE can label pickup as Created and damage or handoff as Delivered.
// Classification follows the milestone description instead.
const stages: Record<string, ClassifiedStatus> = {};
function add(codes: string[], status: ClassifiedStatus['status'], stage: ClassifiedStatus['stage']) {
  for (const code of codes) stages[code] = { status, stage };
}
add(['XX', 'OVRC', 'AUTO', 'EXRL', 'INRL'], 'pending', 'registered');
add(['PKUP', 'PU', 'RL', 'ALPK'], 'in_transit', 'accepted');
add(['ARRD', 'ORIG', 'RCVD', 'OS', 'FCTF', 'SFCT', 'LOAD', 'NFRP'], 'in_transit', 'in_transit');
add(['OFDL', 'OD'], 'out_for_delivery', 'out_for_delivery');
add(['BCLD', 'UTLV', 'NH', 'ACSS', 'RFDM'], 'exception', 'failed_attempt');
add(['DN', 'DLVD', 'CL', 'DM', 'DW', 'OK', 'DD'], 'delivered', 'delivered');
add(['RETD', 'RETN', 'RS'], 'exception', 'returned');
add(['LOST', 'MSPK', 'UD'], 'exception', 'exception');

export function classifyOntracStatus(code: string): ClassifiedStatus | undefined {
  return stages[code];
}
