import { DateTime } from 'luxon';
import { normalizeTrackingNumber } from '../../core/detection';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { epochSecondsTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { uniuniStatus } from './status';

const PROVIDER = 'UniUni';

export function normalizeUniuniNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^[A-Z0-9]{8,35}$/.test(number)) throw new TypeError('UniUni requires an alphanumeric tracking reference');
  return number;
}

/** Discovery only probes formats confirmed for individual parcels. */
export function normalizeUniuniRecognitionNumber(raw: string): string {
  const number = normalizeUniuniNumber(raw);
  if (!/^(?:UUS[A-Z0-9]{16}|UUSC\d{12}|4C\d{9}US)$/.test(number)) throw new TypeError('UniUni recognition requires a supported parcel format');
  return number;
}

function clock(raw: unknown): Pick<CarrierEvent, 'time'> & { local_time?: string; provider_time_text?: string } {
  if (raw == null) return {};
  if (!isRecord(raw)) throw new SchemaError(PROVIDER, 'UniUni returned an invalid scan clock');
  // dateTime.ts is corrected epoch seconds. pathTime encodes local wall-clock
  // digits as UTC seconds and is not an instant, despite its numeric shape.
  if (raw.ts != null) {
    if (typeof raw.ts !== 'number' || !Number.isSafeInteger(raw.ts) || raw.ts < 1_000_000_000 || raw.ts >= 10_000_000_000) {
      throw new SchemaError(PROVIDER, 'UniUni returned invalid corrected scan seconds');
    }
    const time = epochSecondsTime(raw.ts);
    if (!time) throw new SchemaError(PROVIDER, 'UniUni returned an invalid corrected scan time');
    return { time: time.iso };
  }
  if (raw.localTime != null && typeof raw.localTime !== 'string') throw new SchemaError(PROVIDER, 'UniUni returned an invalid local scan clock');
  const text = clean(raw.localTime, 64);
  if (!text) return {};
  const parsed = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? DateTime.fromFormat(text, 'yyyy-MM-dd HH:mm:ss', { zone: 'UTC' }) : null;
  // UTC validates calendar digits only. Without corrected seconds, preserve
  // the provider's clock instead of choosing an offset or borrowing a scan.
  return parsed?.isValid && parsed.toFormat('yyyy-MM-dd HH:mm:ss') === text
    ? { local_time: parsed.toISO({ includeOffset: false, suppressMilliseconds: true })! }
    : { provider_time_text: text };
}

export function parseUniuni(payload: unknown, rawNumber: string): CarrierResult {
  const number = normalizeUniuniNumber(rawNumber);
  if (!isRecord(payload) || typeof payload.status !== 'string') throw new SchemaError(PROVIDER);
  if (payload.status !== 'SUCCESS') throw new IndeterminateError(PROVIDER, 'UniUni returned an inconclusive lookup response');
  if (!isRecord(payload.data) || !Array.isArray(payload.data.valid_tno) || payload.data.valid_tno.length > 25
    || !payload.data.valid_tno.every(isRecord) || typeof payload.data.invalid_tno !== 'string' || payload.data.invalid_tno.length > 1000) {
    throw new SchemaError(PROVIDER);
  }
  const valid = payload.data.valid_tno;
  const invalid = payload.data.invalid_tno.split(',').map(value => value.trim()).filter(Boolean);
  if (invalid.length === 1 && invalid[0] === number && !valid.length) throw new NotFoundError(PROVIDER);
  if (!valid.length && !invalid.length) throw new IndeterminateError(PROVIDER, 'UniUni returned no tracking result');
  if (invalid.length || valid.length !== 1 || valid[0].tno !== number) {
    throw new SchemaError(PROVIDER, 'UniUni did not return one unambiguous matching parcel');
  }
  const item = valid[0]!;
  if (item.is_master != null && item.is_master !== true && item.is_master !== false
    && item.is_master !== 0 && item.is_master !== 1 && item.is_master !== '0' && item.is_master !== '1') {
    throw new SchemaError(PROVIDER, 'UniUni returned an unrecognized parcel type');
  }
  // A master reference can include unfinished pieces alongside a delivered
  // one. Only an independently identified single parcel is supported here.
  if (item.is_master === true || item.is_master === 1 || item.is_master === '1' || item.master_tno
    || (item.orders_list !== undefined && (!Array.isArray(item.orders_list) || item.orders_list.length))) {
    throw new IndeterminateError(PROVIDER, 'UniUni returned a multi-piece shipment');
  }
  if (!Array.isArray(item.spath_list) || item.spath_list.length > 500) throw new SchemaError(PROVIDER);
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  // The public client displays this oldest-first list in reverse. Keep that
  // sequence when the newest clock is incomplete, including equal-time scans.
  for (const scan of [...item.spath_list].reverse()) {
    if (!isRecord(scan)) throw new SchemaError(PROVIDER, 'UniUni returned an incomplete scan');
    const description = clean(scan.description_en, 500);
    if (!description || typeof scan.state !== 'number' || !Number.isSafeInteger(scan.state) || scan.state < 0) {
      throw new SchemaError(PROVIDER, 'UniUni returned a scan without status or public wording');
    }
    const mapped = uniuniStatus(scan.state);
    const location = [clean(scan.city, 100), clean(scan.province, 20)].filter(Boolean).join(', ');
    // Detailed pathInfo, addresses, coordinates, operators and POD data can
    // contain recipient or courier information; retain the English summary.
    const event: CarrierEvent = { description, provider_code: String(scan.state), ...clock(scan.dateTime),
      ...(location ? { location } : {}), ...(mapped ? { stage: mapped.stage } : {}) };
    const key = JSON.stringify(event);
    if (!seen.has(key)) { seen.add(key); events.push(event); }
  }
  if (!events.length) throw new IndeterminateError(PROVIDER, 'UniUni returned no parcel history');
  const latest = events[0]!;
  const mapped = uniuniStatus(Number(latest.provider_code));
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, last_update_local: latest.local_time ?? null,
    expected_delivery: null, ...(mapped?.stage === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    events: events.slice(0, 100) };
}
