import { DateTime } from 'luxon';
import { isValidS10TrackingNumber, normalizeTrackingNumber } from '../../core/detection';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { bringStatus, bringWording } from './status';

export function normalizeBringNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^\d{17,18}$/.test(number) && !(/^[A-Z]{2}\d{9}NO$/.test(number) && isValidS10TrackingNumber(number))) {
    throw new TypeError('Bring requires a parcel or consignment tracking number');
  }
  return number;
}

function clock(value: unknown): Pick<CarrierEvent, 'time'> & { local_time?: string; provider_time_text?: string } {
  if (value != null && typeof value !== 'string') throw new SchemaError('Bring', 'Invalid event clock');
  const raw = clean(value, 64);
  const base = '^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?';
  if (new RegExp(`${base}(?:Z|[+-](?:0\\d|1[0-3]):?[0-5]\\d|[+-]14:?00)$`).test(raw)) {
    const time = explicitOffsetTime(raw);
    if (time) return { time: time.iso };
  }
  if (new RegExp(`${base}$`).test(raw)) {
    const wall = DateTime.fromISO(raw, { zone: 'UTC' });
    if (wall.isValid) return { local_time: wall.toISO({ includeOffset: false })! };
  }
  return raw ? { provider_time_text: raw } : {};
}

export function parseBring(payload: unknown, rawNumber: string): CarrierResult {
  const number = normalizeBringNumber(rawNumber);
  if (!isRecord(payload)) throw new SchemaError('Bring');
  if (payload.error != null || payload.errorState != null) throw new IndeterminateError('Bring', 'Consumer tracking returned no bound history');
  const consignment = payload.consignmentWithDomainAsync;
  if (!isRecord(consignment) || !Array.isArray(consignment.packageSet)) throw new SchemaError('Bring');
  if (consignment.numberOfConsignmentItems !== 1 || consignment.packageSet.length !== 1
    || !isRecord(consignment.domain) || consignment.domain.isMultiParcel !== false) throw new IndeterminateError('Bring', 'No complete single-piece consignment');
  const parcel = consignment.packageSet[0];
  if (!isRecord(parcel) || typeof parcel.brand !== 'string' || !['POSTEN', 'BRING'].includes(parcel.brand)
    || typeof consignment.consignmentId !== 'string' || typeof parcel.packageNumber !== 'string'
    || (consignment.consignmentId !== number && parcel.packageNumber !== number)) throw new SchemaError('Bring', 'Different consignment or parcel');
  if (!isRecord(parcel.domain) || !isRecord(parcel.domain.latestSignificantEvent)
    || !Array.isArray(parcel.eventSet) || parcel.eventSet.length > 500) throw new SchemaError('Bring');
  const summary = parcel.domain.latestSignificantEvent;
  const significant = parcel.eventSet.find(row => isRecord(row) && row.insignificant === false);
  if (!isRecord(significant) || summary.insignificant !== false
    || ['status', 'dateIso', 'lmEventCode', 'city'].some(key => summary[key] !== significant[key])) {
    throw new IndeterminateError('Bring', 'Latest significant scan does not match the public summary');
  }
  // The website's simplified EN_ROUTE also covers dispatches and exceptions.
  // A terminal summary must still agree with the exact terminal event code.
  const simple = parcel.domain.currentStatus;
  const terminal = summary.status === 'DELIVERED' ? 'DELIVERED' : summary.status === 'DELIVERED_SENDER' ? 'DELIVERED_RETURN' : null;
  if (typeof simple !== 'string' || (terminal && simple !== terminal)
    || (!terminal && ['DELIVERED', 'DELIVERED_RETURN'].includes(simple))) throw new IndeterminateError('Bring', 'Inconsistent terminal summary');
  const events: CarrierEvent[] = [];
  for (const row of parcel.eventSet) {
    if (!isRecord(row) || typeof row.status !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(row.status)
      || typeof row.insignificant !== 'boolean' || (row.city != null && typeof row.city !== 'string')) throw new SchemaError('Bring', 'Invalid parcel scan');
    const mapped = bringStatus(row.status);
    events.push({ ...clock(row.dateIso), provider_code: row.status, description: bringWording(row.status),
      location: clean(row.city, 200), ...(mapped ? { stage: mapped.stage } : {}) });
  }
  const current = bringStatus(String(summary.status));
  const currentClock = clock(summary.dateIso);
  let returning = false;
  for (const event of [...events].reverse()) {
    if (event.provider_code === 'RETURN' || event.provider_code === 'DELIVERED_SENDER') returning = true;
    if (returning) event.provider_leg = 'return';
  }
  const seen = new Set<string>();
  const unique = events.filter(event => { const key = JSON.stringify(event); if (seen.has(key)) return false; seen.add(key); return true; });
  const weight = parcel.weightInKgs;
  const dimensions = [parcel.lengthInCm, parcel.widthInCm, parcel.heightInCm];
  return { status: current?.status ?? 'unknown', ...(current ? { current_stage: current.stage } : {}),
    last_status_text: bringWording(String(summary.status)), last_update: currentClock.time ?? null,
    last_update_local: currentClock.local_time ?? null, expected_delivery: null,
    ...(current?.status === 'delivered' && currentClock.time ? { delivered_at: currentClock.time } : {}),
    ...(typeof weight === 'number' && Number.isFinite(weight) && weight > 0 && weight <= 100_000 ? { weight_kg: weight } : {}),
    ...(dimensions.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100_000)
      ? { dimensions_text: `${dimensions.join(' × ')} cm` } : {}), events: unique.slice(0, 100) };
}
