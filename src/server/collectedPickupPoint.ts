import { collectedFromPickupPoint } from '../lib/stages';
import type { Stage } from '../types';
import { isRecord, type JsonObject } from './types';

const named = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * The carrier delivering the parcel a saved result tells of: the partner a
 * handoff reached (`active_tracking_carrier`), else the carrier its routing
 * asked, else the parcel's own. Changing a parcel's carrier drops the partner
 * and leaves the routing, so a result saved before still names its carrier.
 */
function deliveringCarrier(data: JsonObject, carrier: string): string {
  if (named(data.active_tracking_carrier)) return data.active_tracking_carrier;
  const routed = isRecord(data.routing) ? data.routing.configured_carrier : undefined;
  return named(routed) ? routed : carrier;
}

/**
 * The pickup point a delivered parcel was collected from, kept from the saved
 * result when the new one names none: most carriers name the point only while
 * the parcel waits there. It is kept when
 *
 * - the parcel is delivered and was collected there: its last movement before
 *   the delivery, in the saved scans and the new ones, made it ready for
 *   pickup, or, when no scan moved it, the saved stage was ready for pickup.
 *   Taken back out for delivery after it waited, it was brought to the door;
 * - the same carrier delivers it: the parcel's own, or the partner a handoff
 *   reached, even through a universal provider. A partner reached since, or a
 *   carrier the owner or a correction chose instead, never takes the point.
 *
 * `data` is the carrier data about to be saved, `stage` the stage saved with
 * it and `carrier` the parcel's carrier after this check. A point the new
 * result names itself always wins, so the answer is then undefined, as it is
 * whenever the point is not kept.
 */
export function collectedPickupPoint(
  parcel: JsonObject,
  data: JsonObject,
  stage: string,
  carrier: string,
  scans: readonly JsonObject[],
): string | undefined {
  const saved = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
  const point = saved.pickup_point;
  if (stage !== 'delivered' || named(data.pickup_point) || !named(point)) return undefined;
  if (deliveringCarrier(saved, String(parcel.carrier ?? '')) !== deliveringCarrier(data, carrier)) return undefined;
  const collected = collectedFromPickupPoint(scans.map((scan) => ({
    id: String(scan.provider_event_id ?? ''), stage: String(scan.stage ?? '') as Stage, occurredAt: String(scan.occurred_at ?? ''),
  })));
  return (collected ?? parcel.current_stage === 'ready_for_pickup') ? point : undefined;
}
