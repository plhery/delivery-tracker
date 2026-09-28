import { DateTime } from 'luxon';
import { normalizeTrackingNumber } from '../../core/detection';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { canparStatus } from './status';

export function normalizeCanparNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^[CDKLSUXZ]\d{21}$/.test(number)) throw new TypeError('Canpar requires a full parcel barcode');
  return number;
}

function clock(raw: unknown): { local_time?: string; provider_time_text?: string } {
  if (raw != null && typeof raw !== 'string') throw new SchemaError('Canpar', 'Canpar returned an invalid scan clock field');
  const text = clean(raw, 64);
  const parsed = /^\d{8} (?:[01]\d|2[0-3])[0-5]\d[0-5]\d$/.test(text)
    ? DateTime.fromFormat(text, 'yyyyMMdd HHmmss', { zone: 'UTC' }) : null;
  // The public client displays these digits as local clocks and ignores
  // time_shift. That field does not consistently describe a UTC offset.
  return parsed?.isValid ? { local_time: parsed.toISO({ includeOffset: false, suppressMilliseconds: true })! }
    : text ? { provider_time_text: text } : {};
}

export function parseCanpar(payload: unknown, rawNumber: string): CarrierResult {
  const number = normalizeCanparNumber(rawNumber);
  if (!isRecord(payload)) throw new SchemaError('Canpar');
  if (payload.error != null) throw new IndeterminateError('Canpar', 'Canpar returned an inconclusive tracking response');
  const packages = Array.isArray(payload.result) ? payload.result
    : isRecord(payload.result) ? payload.result.packages : null;
  if (!Array.isArray(packages) || packages.length > 25 || !packages.every(isRecord)) throw new SchemaError('Canpar');
  if (!packages.length) throw new IndeterminateError('Canpar', 'Canpar returned no parcel history');
  if (packages.length !== 1 || packages[0].barcode !== number) {
    throw new SchemaError('Canpar', 'Canpar did not identify one matching parcel');
  }
  const item = packages[0];
  if (!Array.isArray(item.events) || item.events.length > 500) throw new SchemaError('Canpar');
  // Unknown barcodes can return an identity-shaped empty package. Its status
  // and delivered flag establish neither a registered parcel nor absence.
  if (!item.events.length) throw new IndeterminateError('Canpar', 'Canpar returned no parcel history');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  // The official widget displays this newest-first sequence without sorting.
  // Preserve equal-clock positions and cross-region local clocks.
  for (const row of item.events) {
    if (!isRecord(row)) throw new SchemaError('Canpar', 'Canpar returned an incomplete scan');
    const code = clean(row.code, 16);
    const description = clean(row.code_description_en, 500);
    if (!code || !description) throw new SchemaError('Canpar', 'Canpar returned a scan without status or wording');
    const mapped = canparStatus(code);
    const address = isRecord(row.address) ? row.address : null;
    const location = address ? [clean(address.city, 100), clean(address.province, 20)].filter(Boolean).join(', ') : '';
    const event: CarrierEvent = { description, provider_code: code, ...clock(row.local_date_time),
      ...(location ? { location } : {}), ...(mapped ? { stage: mapped.stage } : {}) };
    const key = JSON.stringify(event);
    if (!seen.has(key)) { seen.add(key); events.push(event); }
  }
  const latest = events[0]!;
  const mapped = canparStatus(latest.provider_code!);
  // RTN describes a completed return scan, not an instruction to relabel
  // every later scan. Native histories can resume movement and delivery.
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: null, last_update_local: latest.local_time ?? null,
    expected_delivery: null, events: events.slice(0, 100) };
}
