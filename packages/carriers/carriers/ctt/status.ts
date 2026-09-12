/**
 * CTT Portugal status vocabulary.
 *
 * `StateId` is the stable integer key of an event; the Portuguese `State` text
 * next to it is display prose and is never mapped. The vocabulary is explicitly
 * still being observed, so an unmapped id yields no stage at all: the sync then
 * classifies the raw wording and records where the stage came from, rather than
 * this map inventing movement.
 *
 * Provenance: derived from the prior-art client
 * https://github.com/ha-parcel-integrations/ha-ctt (MIT) and confirmed live on
 * 2026-09-10 against a delivered parcel whose whole history mapped.
 */
import type { ClassifiedStatus } from '../../core/status';

const EVENT_STATUS: Record<number, ClassifiedStatus> = {
  1: { status: 'pending', stage: 'registered' },
  2: { status: 'in_transit', stage: 'in_transit' },
  5: { status: 'exception', stage: 'returned' },
  7: { status: 'out_for_delivery', stage: 'out_for_delivery' },
  8: { status: 'in_transit', stage: 'in_transit' },
  10: { status: 'in_transit', stage: 'in_transit' },
  11: { status: 'in_transit', stage: 'in_transit' },
  12: { status: 'delivered', stage: 'delivered' },
  13: { status: 'exception', stage: 'failed_attempt' },
  14: { status: 'out_for_delivery', stage: 'ready_for_pickup' },
};

/** The stage and status for a CTT `StateId`, or undefined when the id is not mapped. */
export function classifyCttStatus(stateId: unknown): ClassifiedStatus | undefined {
  return typeof stateId === 'number' && Number.isSafeInteger(stateId) ? EVENT_STATUS[stateId] : undefined;
}
