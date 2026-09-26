import { DateTime } from 'luxon';
import type { CarrierResult } from '@carriers/core/result';
import { isRecord, type JsonObject } from './types';

const CARRIERS = new Set(['japan-post', 'evri', 'sf-express']);
const eventKey = (event: JsonObject): string => JSON.stringify([
  event.local_time, event.time, event.description, event.location, event.provider_code,
]);

function instant(value: unknown): boolean {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    && DateTime.fromISO(value, { setZone: true }).isValid;
}

/** These international sources preserve unresolved clocks separately from instants. */
export function hasUnresolvedDirectHistory(carrier: string, result: CarrierResult): boolean {
  return CARRIERS.has(carrier) && Boolean(result.events?.some((event) => typeof event.local_time === 'string'))
    && Boolean(result.events?.some((event) => typeof event.local_time === 'string' && !instant(event.time)));
}

export function hasUnresolvedDirectCurrent(carrier: string, result: CarrierResult): boolean {
  return hasUnresolvedDirectHistory(carrier, result) && !instant(result.last_update);
}

export function captureDirectLocalHistory(carrier: string, number: string, result: CarrierResult): JsonObject {
  const events = (result.events ?? []).slice(0, 100).map((event) => Object.fromEntries(
    ['time', 'local_time', 'description', 'location', 'stage', 'provider_code'].flatMap((key) => {
      const value = event[key];
      return typeof value === 'string' ? [[key, value.slice(0, key === 'description' ? 500 : 200)]] : [];
    }),
  ));
  return { carrier, number, events,
    ...(typeof result.last_update_local === 'string' ? { last_update_local: result.last_update_local.slice(0, 64) } : {}) };
}

export function directHistoryNumber(parcel: JsonObject, result: CarrierResult = {}): unknown {
  const data = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
  if (result.original_carrier && result.active_tracking_carrier && typeof result.active_tracking_number === 'string') {
    return result.active_tracking_number;
  }
  return data.original_carrier && data.active_tracking_carrier && typeof data.active_tracking_number === 'string'
    ? data.active_tracking_number : parcel.tracking_number;
}

/** Recognize a shortened old snapshot without comparing clocks across countries. */
export function directLocalSnapshotIsOlder(previous: unknown, incoming: unknown): boolean {
  if (!isRecord(previous) || !Array.isArray(previous.events)
    || !isRecord(incoming) || !Array.isArray(incoming.events) || !isRecord(incoming.events[0])) return false;
  const key = eventKey(incoming.events[0]);
  return previous.events.findIndex((event) => isRecord(event) && eventKey(event) === key) > 0;
}

/** Keep bounded local evidence across provider changes without creating scan instants. */
export function directLocalHistory(parcel: JsonObject, result: CarrierResult): JsonObject | undefined {
  const data = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
  const number = directHistoryNumber(parcel, result);
  const valid = (value: unknown): value is JsonObject => isRecord(value)
    && CARRIERS.has(String(value.carrier)) && value.number === number && Array.isArray(value.events);
  const previous = valid(data.direct_local_history) ? data.direct_local_history : undefined;
  const incoming = valid(result.direct_local_history) ? result.direct_local_history : undefined;
  if (!incoming) return previous ? { ...previous, events: (previous.events as unknown[]).slice(0, 100) } : undefined;
  if (!previous || previous.carrier !== incoming.carrier) return { ...incoming, events: (incoming.events as unknown[]).slice(0, 100) };
  const unique = new Map<string, JsonObject>();
  const older = directLocalSnapshotIsOlder(previous, incoming);
  const ordered = older ? [previous, incoming] : [incoming, previous];
  // The provider's order is meaningful across locations with different clocks.
  for (const event of ordered.flatMap((archive) => archive.events as unknown[])) {
    if (!isRecord(event)) continue;
    const key = eventKey(event);
    if (!unique.has(key)) unique.set(key, event);
    if (unique.size === 100) break;
  }
  return { ...(older ? previous : incoming), events: [...unique.values()] };
}
