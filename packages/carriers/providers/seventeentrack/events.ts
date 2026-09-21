import type { CarrierEvent } from '../../core/result';
import type { Stage } from '../../generated/catalog';
import { isRecord, type JsonObject } from '../../core/types';
import { event, text } from '../shared/result';

// Official v2 status vocabulary, plus TransportArrived/Departed observed in
// public China Post histories. Expired describes tracking age, not a scan.
const SUB_STAGES: Record<string, Stage> = {
  InfoReceived: 'registered',
  InTransit_PickedUp: 'accepted', InTransit_Other: 'in_transit',
  InTransit_Departure: 'in_transit', InTransit_Arrival: 'in_transit',
  InTransit_TransportArrived: 'in_transit', InTransit_TransportDeparted: 'in_transit',
  InTransit_CustomsProcessing: 'customs', InTransit_CustomsReleased: 'in_transit',
  InTransit_CustomsRequiringInformation: 'customs',
  AvailableForPickup_Other: 'ready_for_pickup', OutForDelivery_Other: 'out_for_delivery',
  DeliveryFailure_Other: 'failed_attempt', DeliveryFailure_NoBody: 'failed_attempt',
  DeliveryFailure_Security: 'failed_attempt', DeliveryFailure_Rejected: 'failed_attempt',
  DeliveryFailure_InvalidAddress: 'failed_attempt', Delivered_Other: 'delivered',
  Exception_Other: 'exception', Exception_Returning: 'exception', Exception_Returned: 'returned',
  Exception_NoBody: 'exception', Exception_Security: 'exception', Exception_Damage: 'exception',
  Exception_Rejected: 'exception', Exception_Delayed: 'exception', Exception_Lost: 'exception',
  Exception_Destroyed: 'exception', Exception_Cancel: 'exception',
};

/** Keep scan codes/operator and the origin of 17TRACK's converted timestamp. */
export function seventeenTrackEvent(raw: JsonObject, operator: JsonObject): CarrierEvent | null {
  // Some completed responses contain undated explanatory rows alongside real
  // scans. Skip only absent dates; malformed nonempty timestamps still fail.
  const time = raw.time_utc ?? raw.time_iso;
  if (time === null || time === undefined) return null;
  const code = text(raw.sub_status);
  const mapped = Object.hasOwn(SUB_STAGES, code) ? SUB_STAGES[code] : undefined;
  const parsed = event(time, raw.description, raw.stage ?? (mapped ? code.split('_')[0] : undefined));
  if (!parsed) return null;
  // Preserve the shared delivered/negation/handoff safeguards. The specific
  // code otherwise supplies semantics that Chinese wording cannot provide.
  const genericTransit = code === 'InTransit_Other' && parsed.stage !== 'pending';
  if (mapped && !genericTransit && (mapped !== 'delivered' || parsed.stage === 'delivered')) parsed.stage = mapped;
  if (parsed.stage === 'delivered') parsed.description = 'Delivered';
  const timeRaw = isRecord(raw.time_raw) ? raw.time_raw : null;
  return {
    ...parsed,
    ...(code && /^[A-Za-z_]{1,80}$/.test(code) ? { provider_code: code } : {}),
    ...operator,
    ...(typeof raw.time_iso === 'string' ? { provider_time_iso: raw.time_iso } : {}),
    // An inferred offset remains provider-converted time, not independent
    // evidence that China Post knows the destination's local timezone.
    time_provenance: timeRaw?.timezone === null ? 'provider_inferred'
      : typeof timeRaw?.timezone === 'string' ? 'carrier_reported' : 'unspecified',
  };
}
