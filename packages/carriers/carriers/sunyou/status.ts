/**
 * SunYou status vocabulary.
 *
 * The tracking endpoint returns one numeric `displayStatus` per shipment; the
 * scan texts themselves carry no code. `0` is not in the map: it is SunYou's
 * explicit "no such shipment" and the adapter turns it into a not-found before
 * classification.
 *
 * Only the newest scan inherits this stage. Older scans are returned without
 * one, because the shipment-level status says nothing about where the parcel
 * was three days ago.
 */
import type { ClassifiedStatus } from '../../core/status';

const DISPLAY_STATUS = new Map<string, ClassifiedStatus>([
  ['1', { status: 'in_transit', stage: 'in_transit' }],
  ['2', { status: 'out_for_delivery', stage: 'ready_for_pickup' }],
  ['3', { status: 'exception', stage: 'failed_attempt' }],
  ['4', { status: 'delivered', stage: 'delivered' }],
  ['5', { status: 'exception', stage: 'failed_attempt' }],
  ['6', { status: 'exception', stage: 'failed_attempt' }],
]);

export { DISPLAY_STATUS as SUNYOU_STATUS };

/** The status and stage for one `displayStatus`, or undefined when unmapped. */
export function sunYouStatus(displayStatus: string): ClassifiedStatus | undefined {
  return DISPLAY_STATUS.get(displayStatus);
}
