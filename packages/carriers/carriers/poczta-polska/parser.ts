import { DateTime } from 'luxon';
import { isValidS10TrackingNumber } from '../../core/detection/s10';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyPocztaPolskaStatus } from './status';

export function normalizePocztaPolskaNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/\s/g, '');
  if (!/^(?:\d{19,20}|PX\d{10})$/.test(number) && !isValidS10TrackingNumber(number)) {
    throw new TypeError('Poczta Polska requires a parcel barcode or valid postal tracking number');
  }
  if (number.length !== 19) return number;
  // The official widget appends the GS1 check digit to a 19-digit reference
  // before submitting it. The JSON service itself does not resolve that alias.
  const sum = [...number].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 1 : 3), 0);
  return `${number}${(10 - sum % 10) % 10}`;
}

function eventClock(value: unknown): Record<string, string> {
  if (value != null && typeof value !== 'string') throw new SchemaError('poczta-polska', 'Poczta Polska returned an invalid clock field');
  const raw = clean(value, 64);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/i.test(raw)) {
    const parsed = explicitOffsetTime(raw);
    if (parsed) return { time: parsed.iso };
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(raw)) {
    // UTC validates the calendar only. It is never attached to local digits.
    const parsed = DateTime.fromISO(raw, { zone: 'UTC' });
    const local = parsed.isValid ? parsed.toISO({ includeOffset: false, suppressMilliseconds: true }) : null;
    if (local) return { local_time: local };
  }
  return raw ? { provider_time_text: raw } : {};
}

export function parsePocztaPolska(payload: unknown, number: string): CarrierResult {
  const requested = normalizePocztaPolskaNumber(number);
  if (!isRecord(payload) || !Number.isInteger(payload.mailStatus) || typeof payload.number !== 'string'
    || payload.number.trim().toUpperCase() !== requested) throw new SchemaError('poczta-polska', 'Poczta Polska returned an invalid parcel envelope');
  if (payload.mailStatus === -1 && !Object.hasOwn(payload, 'mailInfo')) throw new NotFoundError('poczta-polska');
  if (payload.mailStatus !== 0) throw new IndeterminateError('poczta-polska', 'Poczta Polska returned an ambiguous or incomplete parcel result');
  const item = payload.mailInfo;
  if (!isRecord(item) || typeof item.number !== 'string' || item.number.trim().toUpperCase() !== requested
    || !Array.isArray(item.events) || item.events.length > 500) throw new SchemaError('poczta-polska');
  if (item.components != null && (!Array.isArray(item.components) || item.components.length > 100
    || !item.components.every(component => typeof component === 'string' && component.trim().length > 0 && component.length <= 80))) {
    throw new SchemaError('poczta-polska', 'Poczta Polska returned an invalid component list');
  }
  if (item.typeOfMailCode === 'PPL' || (Array.isArray(item.components) && item.components.length > 0)) {
    throw new IndeterminateError('poczta-polska', 'Poczta Polska grouped consignments require parcel-level history');
  }
  const projected = item.events.map((raw): CarrierEvent => {
    if (!isRecord(raw)) throw new SchemaError('poczta-polska');
    if (raw.canceled === true) throw new IndeterminateError('poczta-polska', 'Poczta Polska returned an invalidated scan');
    const description = clean(raw.name, 500);
    const code = clean(raw.code, 40);
    if (!description || !code) throw new SchemaError('poczta-polska', 'Poczta Polska returned an incomplete scan');
    const location = isRecord(raw.postOffice) ? clean(raw.postOffice.name, 160) : '';
    const mapped = classifyPocztaPolskaStatus(code);
    return { ...eventClock(raw.time), description, provider_code: code,
      ...(location ? { location } : {}), ...(mapped ? { stage: mapped.stage } : {}) };
  });
  if (!projected.length) throw new IndeterminateError('poczta-polska', 'Poczta Polska returned no parcel history');
  // The widget's last source row is current. Do not compare offsetless wall
  // clocks from different countries or move malformed clocks behind old scans.
  projected.reverse();
  if (projected.every(event => event.time)) projected.sort((a, b) => Date.parse(b.time!) - Date.parse(a.time!));
  const seen = new Set<string>();
  const events = projected.filter(event => {
    const key = JSON.stringify(event);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const latest = events[0]!;
  const current = classifyPocztaPolskaStatus(latest.provider_code!);
  const weight = item.weight;
  return { status: current?.status ?? 'unknown', ...(current ? { current_stage: current.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null,
    ...(latest.local_time ? { last_update_local: latest.local_time } : {}), expected_delivery: null,
    ...(typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? { weight_kg: weight } : {}),
    ...(number.toUpperCase().replace(/\s/g, '') !== requested ? { canonical_tracking_number: requested } : {}),
    events: events.slice(0, 100) };
}
