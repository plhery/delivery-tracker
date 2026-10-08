import 'server-only';

import { timeZoneCountry } from 'universal-parcel-scraper';
import { carrierTimezone } from './carriers';
import { captureOperationalError } from './observability';
import { placesForEvents, type EventPoint } from 'universal-parcel-scraper/places';
import { relayCopies } from './relayCopies';
import { isRecord, type JsonObject } from './types';

let reported = false;

/**
 * The stored point only feeds the place, and the source only tells Peek's own
 * rows and relay copies apart: the API returns neither. A relay copy names the
 * scan it repeats instead.
 */
function served(event: JsonObject, relayOf?: string): JsonObject {
  if (!('point' in event) && !('provider_event_id' in event) && !relayOf) return event;
  const rest: JsonObject = { ...event, ...(relayOf ? { relay_of: relayOf } : {}) };
  delete rest.point;
  delete rest.provider_event_id;
  return rest;
}

/** A row Peek writes itself (`app:` source), such as "Tracking added". */
function isOwnRow(event: JsonObject): boolean {
  return typeof event.provider_event_id === 'string' && event.provider_event_id.startsWith('app:');
}

/**
 * The timeline is the carrier's story. Peek's own row, "Tracking added" or a
 * new carrier still to answer, only opens it: once a carrier scan is as old
 * as that row or older, the row is left out, so it never sits among the
 * scans or above a delivery. The stored row, the stage and alerts are not
 * affected.
 */
function timeline(events: JsonObject[]): JsonObject[] {
  const time = (event: JsonObject) => Date.parse(String(event.occurred_at));
  const firstScan = Math.min(...events.filter((event) => !isOwnRow(event)).map(time).filter(Number.isFinite));
  return events.filter((event) => !isOwnRow(event) || !(firstScan <= time(event)));
}

/** A stored package row with its events' sources left out, every row kept: the account's export. */
export function withoutEventSources(row: JsonObject): JsonObject {
  if (!Array.isArray(row.tracking_events)) return row;
  return {
    ...row,
    tracking_events: row.tracking_events.map((event) => {
      if (!isRecord(event) || !('provider_event_id' in event)) return event;
      const rest = { ...event };
      delete rest.provider_event_id;
      return rest;
    }),
  };
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
 * An API package row as it is served. Every scan gets a `place`: where its
 * free text locates it, or null. Places are worked out when the package is
 * served, so improving the gazetteer improves every parcel, old ones
 * included. Peek's own opening row is left out once carrier scans reach back
 * to it (see `timeline`), and an earlier carrier's relay copy of a scan names
 * that scan (`relay_of`, see relayCopies.ts).
 */
export function withEventPlaces(row: JsonObject): JsonObject {
  if (isRecord(row.carrier_data) && 'add_recognition_pending' in row.carrier_data) {
    const data = { ...row.carrier_data };
    delete data.add_recognition_pending;
    row = { ...row, carrier_data: data };
  }
  if (!Array.isArray(row.tracking_events) || !row.tracking_events.length) return row;
  const events = timeline(row.tracking_events.filter(isRecord));
  const relays = relayCopies(row);
  const shown = (event: JsonObject) => served(event, relays.get(String(event.id)));
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
      tracking_events: events.map((event) => ({ ...shown(event), place: byEvent.get(event) ?? null })),
    };
  } catch (error) {
    // A map is a nice extra: the parcel still loads without one.
    if (!reported) captureOperationalError(error, { component: 'api', operation: 'locate_event_places' });
    reported = true;
    return { ...row, tracking_events: events.map(shown) };
  }
}
