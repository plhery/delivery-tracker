import type { ClassifiedStatus } from '../../core/status';

// EDIFACT groups used by the official consumer tracking client. Pickup requests
// are pre-advice; they do not establish that NZ Post has collected the parcel.
const CODES: Record<string, ClassifiedStatus> = {
  '997': { status: 'pending', stage: 'registered' },
  '205': { status: 'pending', stage: 'registered' },
  '206': { status: 'pending', stage: 'registered' },
  '13': { status: 'in_transit', stage: 'accepted' },
  '8': { status: 'in_transit', stage: 'in_transit' },
  '58': { status: 'in_transit', stage: 'in_transit' },
  '40': { status: 'exception', stage: 'exception' },
};
const DELIVERED = new Set(['22', '5022', '6033', '5207', '4014']);
const DELIVERY = new Set(['5322', '32', '35', '5045', '5323', '6032', '6035']);
const ATTEMPTED = new Set(['42', '50', '51', '52', '53', '62', '63', '5021', '5312', '5313',
  '5314', '5315', '5316', '5317', '5318', '5319', '5320', '4003', '6019', '6048']);
const COLLECTION = new Set(['141', '6003', '5351', '99', '1099', '2099']);

export function classifyNzPostStatus(code: string): ClassifiedStatus | undefined {
  if (Object.hasOwn(CODES, code)) return CODES[code];
  if (DELIVERED.has(code)) return { status: 'delivered', stage: 'delivered' };
  if (DELIVERY.has(code)) return { status: 'out_for_delivery', stage: 'out_for_delivery' };
  if (ATTEMPTED.has(code)) return { status: 'exception', stage: 'exception' };
  if (COLLECTION.has(code)) return { status: 'in_transit', stage: 'ready_for_pickup' };
  return undefined;
}
