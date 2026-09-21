import type { CarrierResult } from './carrierResult';
import { isRecord, type JsonObject } from './types';

/** Wall-time scans cannot enter the timestamped timeline as invented UTC instants. */
export function upuHistory(parcel: JsonObject, result: CarrierResult, observedAt: Date): JsonObject | undefined {
  const data = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
  const previous = isRecord(data.upu_history) ? data.upu_history : undefined;
  if (result.tracking_provider !== 'UPU') return previous;
  const number = data.original_carrier && data.active_tracking_carrier && typeof data.active_tracking_number === 'string'
    ? data.active_tracking_number : parcel.tracking_number;
  const saved = previous && previous.number === number && Array.isArray(previous.events) ? previous.events.filter(isRecord) : [];
  const key = (event: JsonObject) => JSON.stringify([event.local_time, event.provider_code, event.location, event.description]);
  const events = new Map(saved.map((event) => [key(event), event]));
  for (const event of result.events ?? []) {
    if (!events.has(key(event))) events.set(key(event), { ...event, first_observed_at: observedAt.toISOString() });
  }
  return { number, events: [...events.values()]
    .sort((a, b) => String(b.local_time).localeCompare(String(a.local_time))).slice(0, 1_000) };
}
