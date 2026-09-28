import { DateTime } from 'luxon';
import { isValidS10TrackingNumber } from '../../core/detection/s10';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyNzPostStatus } from './status';

export function normalizeNzPostNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/\s/g, '');
  if (!/^\d{20}$/.test(number) && !isValidS10TrackingNumber(number)) {
    throw new TypeError('NZ Post requires a domestic parcel barcode or valid postal tracking number');
  }
  return number;
}

function clock(value: unknown): Pick<CarrierEvent, 'time'> & Record<string, string> {
  if (value != null && typeof value !== 'string') throw new SchemaError('nz-post', 'NZ Post returned an invalid clock field');
  const raw = clean(value, 64);
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/i.test(raw)
    ? explicitOffsetTime(raw) : null;
  if (iso) return { time: iso.iso };
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(raw)) {
    const parsed = DateTime.fromISO(raw, { zone: 'UTC' });
    const local = parsed.isValid ? parsed.toISO({ includeOffset: false, suppressMilliseconds: true }) : null;
    if (local) return { local_time: local };
  }
  return raw ? { provider_time_text: raw } : {};
}

export function parseNzPost(payload: unknown, number: string): CarrierResult {
  const requested = normalizeNzPostNumber(number);
  if (!isRecord(payload) || typeof payload.success !== 'boolean' || !Number.isInteger(payload.status_code)) throw new SchemaError('nz-post');
  if (payload.success !== true) throw new IndeterminateError('nz-post', 'NZ Post did not complete the lookup');
  if (!Array.isArray(payload.results) || payload.results.length > 100 || !payload.results.every(isRecord)) throw new SchemaError('nz-post');
  if (!payload.results.length) throw new IndeterminateError('nz-post', 'NZ Post returned no parcel result');
  if (payload.results.length !== 1 || typeof payload.results[0]!.tracking_reference !== 'string'
    || payload.results[0]!.tracking_reference.trim().toUpperCase() !== requested) {
    throw new SchemaError('nz-post', 'NZ Post did not return one exact parcel reference');
  }
  const item = payload.results[0]!;
  if (item.errors !== undefined) {
    if (!Array.isArray(item.errors) || !item.errors.every(isRecord)) throw new SchemaError('nz-post');
    if (item.errors.length) {
      const error = item.errors[0]!;
      if (payload.status_code === 2 && item.errors.length === 1 && !Object.hasOwn(item, 'tracking_events')
        && error.code === 400002 && error.message === 'Invalid parameter(s)'
        && error.details === 'No data found for this Tracking Reference') throw new NotFoundError('nz-post');
      throw new IndeterminateError('nz-post', 'NZ Post returned an unrecognized tracking error');
    }
  }
  if (payload.status_code !== 1) throw new IndeterminateError('nz-post', 'NZ Post returned an incomplete lookup');
  if (!Array.isArray(item.tracking_events) || item.tracking_events.length > 500) throw new SchemaError('nz-post');
  const projected = item.tracking_events.map((raw): CarrierEvent => {
    if (!isRecord(raw)) throw new SchemaError('nz-post');
    const description = clean(raw.status, 300);
    const code = clean(raw.edifact_code, 40);
    if (!description || !code) throw new SchemaError('nz-post', 'NZ Post returned an incomplete scan');
    const location = clean(raw.depot_name, 160);
    const mapped = classifyNzPostStatus(code);
    // Long descriptions embed signatures and other recipient details. The
    // short status and depot name carry the tracking evidence independently.
    return { ...clock(raw.date_time), description, provider_code: code,
      ...(location ? { location } : {}), ...(mapped ? { stage: mapped.stage } : {}) };
  });
  if (!projected.length) throw new IndeterminateError('nz-post', 'NZ Post returned no parcel history');
  // The consumer client treats the last source row as current. Preserve that
  // order if any clock is unresolved instead of promoting an older dated row.
  projected.reverse();
  if (projected.every(event => event.time)) projected.sort((a, b) => Date.parse(b.time!) - Date.parse(a.time!));
  const seen = new Set<string>();
  const events = projected.filter(event => {
    const key = JSON.stringify(event);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const latest = events[0]!;
  const current = classifyNzPostStatus(latest.provider_code!);
  return { status: current?.status ?? 'unknown', ...(current ? { current_stage: current.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null,
    ...(latest.local_time ? { last_update_local: latest.local_time } : {}), expected_delivery: null,
    ...(current?.stage === 'delivered' && latest.time ? { delivered_at: latest.time } : {}), events: events.slice(0, 100) };
}
