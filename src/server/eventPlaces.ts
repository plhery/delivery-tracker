import 'server-only';

import { timeZoneCountry } from 'universal-parcel-scraper';
import { carrierTimezone } from './carriers';
import { captureOperationalError } from './observability';
import { placesForEvents, type EventPoint } from 'universal-parcel-scraper/places';
import { isRecord, type JsonObject } from './types';

let reported = false;

/** The stored point only feeds the place; the API does not return it. */
function withoutPoint(event: JsonObject): JsonObject {
  if (!('point' in event)) return event;
  const rest = { ...event };
  delete rest.point;
  return rest;
}

function eventPoint(value: unknown): EventPoint | null {
  if (!isRecord(value)) return null;
  const { latitude, longitude } = value;
  return typeof latitude === 'number' && typeof longitude === 'number' ? { latitude, longitude } : null;
}

function carrierCountry(carrier: unknown): string | null {
  if (typeof carrier !== 'string') return null;
  try {
    return timeZoneCountry(carrierTimezone(carrier));
  } catch {
    return null;
  }
}

/**
 * Adds a `place` to every scan of an API package row: where the scan's free
 * text locates it, or null. Places are worked out when the package is served,
 * so improving the gazetteer improves every parcel, old ones included.
 */
export function withEventPlaces(row: JsonObject): JsonObject {
  if (!Array.isArray(row.tracking_events) || !row.tracking_events.length) return row;
  const events = row.tracking_events.filter(isRecord);
  const carrierData = isRecord(row.carrier_data) ? row.carrier_data : {};
  try {
    const ordered = [...events].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    const places = placesForEvents(ordered.map((event) => typeof event.location === 'string' ? event.location : null), {
      destinationCountry: typeof carrierData.destination_country === 'string' ? carrierData.destination_country : null,
      // The carrier delivering now says more than the one the parcel was added with.
      carrierCountries: [carrierData.active_tracking_carrier, row.carrier].map(carrierCountry).filter((code): code is string => Boolean(code)),
      points: ordered.map((event) => eventPoint(event.point)),
    });
    const byEvent = new Map(ordered.map((event, index) => [event, places[index]]));
    return {
      ...row,
      tracking_events: events.map((event) => ({ ...withoutPoint(event), place: byEvent.get(event) ?? null })),
    };
  } catch (error) {
    // A map is a nice extra: the parcel still loads without one.
    if (!reported) captureOperationalError(error, { component: 'api', operation: 'locate_event_places' });
    reported = true;
    return { ...row, tracking_events: events.map(withoutPoint) };
  }
}
