import { DateTime } from 'luxon';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { courierGuyStatus, courierGuyWording, HIDDEN_COURIER_GUY_CODES } from './status';
import { normalizeCourierGuyNumber } from './number';

export { normalizeCourierGuyNumber, normalizeCourierGuyRecognitionNumber } from './number';

function clock(value: unknown): Pick<CarrierEvent, 'time'> & { local_time?: string; provider_time_text?: string } {
  if (value != null && typeof value !== 'string') throw new SchemaError('The Courier Guy', 'Invalid scan clock');
  const raw = clean(value, 64);
  const base = '^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?';
  if (new RegExp(`${base}(?:Z|[+-](?:0\\d|1[0-3]):?[0-5]\\d|[+-]14:?00)$`).test(raw)) {
    const instant = explicitOffsetTime(raw);
    if (instant) return { time: instant.iso };
  }
  if (new RegExp(`${base}$`).test(raw)) {
    const wall = DateTime.fromISO(raw, { zone: 'UTC' });
    if (wall.isValid) return { local_time: wall.toISO({ includeOffset: false })! };
  }
  return raw ? { provider_time_text: raw } : {};
}

export function parseCourierGuy(payload: unknown, rawNumber: string): CarrierResult {
  const number = normalizeCourierGuyNumber(rawNumber);
  if (!isRecord(payload) || !Array.isArray(payload.shipments)) throw new SchemaError('The Courier Guy');
  if (!payload.shipments.length) throw new IndeterminateError('The Courier Guy', 'No identity-bound shipment history');
  if (payload.shipments.length !== 1) throw new IndeterminateError('The Courier Guy', 'Ambiguous shipment match');
  const shipment = payload.shipments[0];
  if (!isRecord(shipment) || shipment.provider_id !== 7
    || typeof shipment.short_tracking_reference !== 'string' || !/^[A-Z0-9]{5,40}$/.test(shipment.short_tracking_reference)
    || (shipment.short_tracking_reference !== number
      && (!/^(?:DD|LD)-[A-Z0-9]{6}$/.test(number) || shipment.custom_tracking_reference !== number))) {
    throw new SchemaError('The Courier Guy', 'Different carrier or shipment reference');
  }
  if (typeof shipment.status !== 'string' || !/^[a-z0-9-]{1,64}$/.test(shipment.status)
    || !Array.isArray(shipment.tracking_events) || shipment.tracking_events.length > 500) throw new SchemaError('The Courier Guy');
  // Cancelled, never-collected DD bookings omit their count. This bounded
  // precollection timeline cannot complete a delivered or moving shipment.
  const cancelledCollection = shipment.parcel_count == null && shipment.status === 'cancelled'
    && typeof shipment.custom_tracking_reference === 'string' && /^DD-[A-Z0-9]{6}$/.test(shipment.custom_tracking_reference)
    && Array.isArray(shipment.parcel_tracking_references)
    && shipment.parcel_tracking_references.length === 1
    && shipment.tracking_events.every(row => isRecord(row) && row.parcel_id === 0
      && ['submitted', 'collection-assigned', 'collection-failed-attempt', 'cancelled'].includes(String(row.status)));
  if (!Array.isArray(shipment.parcel_tracking_references)
    || !shipment.parcel_tracking_references.length
    || shipment.parcel_tracking_references.length > 500
    || shipment.parcel_tracking_references.some(ref => typeof ref !== 'string'
      || (!/^[A-Z0-9]{5,40}$/.test(ref) && !(cancelledCollection && ref === `${shipment.custom_tracking_reference}/1`)))
    || new Set(shipment.parcel_tracking_references).size !== shipment.parcel_tracking_references.length) throw new SchemaError('The Courier Guy', 'Invalid shipment pieces');
  if (!cancelledCollection && (!Number.isSafeInteger(shipment.parcel_count) || (shipment.parcel_count as number) < 1
    || shipment.parcel_tracking_references.length !== shipment.parcel_count)) throw new SchemaError('The Courier Guy', 'Invalid shipment pieces');
  const events: CarrierEvent[] = [];
  for (const row of shipment.tracking_events) {
    if (!isRecord(row) || !Number.isSafeInteger(row.parcel_id) || (row.parcel_id as number) < 0
      || typeof row.status !== 'string' || !/^[a-z0-9-]{1,64}$/.test(row.status)
      || (row.location != null && typeof row.location !== 'string')) throw new SchemaError('The Courier Guy', 'Invalid shipment scan');
    // parcel_id=0 is the shipment timeline used by the official consumer page.
    // A delivered individual piece cannot complete the whole shipment.
    if (row.parcel_id !== 0 || HIDDEN_COURIER_GUY_CODES.has(row.status)) continue;
    const mapped = courierGuyStatus(row.status);
    events.push({ ...clock(row.date), provider_code: row.status, description: courierGuyWording(row.status),
      location: clean(row.location, 200), ...(mapped ? { stage: mapped.stage } : {}) });
  }
  if (!events.length) throw new IndeterminateError('The Courier Guy', 'No public shipment scans');
  const latest = events[0]!;
  const hiddenSummary = HIDDEN_COURIER_GUY_CODES.has(shipment.status);
  if (!hiddenSummary && shipment.status !== latest.provider_code) {
    throw new IndeterminateError('The Courier Guy', 'Shipment summary does not match the latest scan');
  }
  // For hidden summaries the consumer chooses its public current scan by date.
  // Preserve backend order only when it cannot contradict that selection.
  if (hiddenSummary && events.some(event => !event.time)) {
    throw new IndeterminateError('The Courier Guy', 'No dated public current scan');
  }
  if (latest.time) {
    const currentMillis = DateTime.fromISO(latest.time).toMillis();
    if (events.some(event => event.time && (DateTime.fromISO(event.time).toMillis() > currentMillis
      || (hiddenSummary && DateTime.fromISO(event.time).toMillis() === currentMillis && event.provider_code !== latest.provider_code)))) {
      throw new IndeterminateError('The Courier Guy', 'Ambiguous public current scan order');
    }
  }
  const mapped = courierGuyStatus(latest.provider_code!);
  const seen = new Set<string>();
  const unique = events.filter(event => { const key = JSON.stringify(event); if (seen.has(key)) return false; seen.add(key); return true; });
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    ...(shipment.short_tracking_reference !== number ? { canonical_tracking_number: shipment.short_tracking_reference } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, last_update_local: latest.local_time ?? null,
    expected_delivery: null, ...(mapped?.status === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    events: unique.slice(0, 100) };
}
