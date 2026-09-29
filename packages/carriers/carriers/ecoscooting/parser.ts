import { normalizeTrackingNumber } from '../../core/detection';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { epochMillisTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { ecoscootingStatus } from './status';

export function normalizeEcoscootingNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^(?:\d{18}|CNPRT\d{20})$/.test(number)) throw new TypeError('Ecoscooting requires a numeric or CNPRT parcel reference');
  return number;
}

export function parseEcoscooting(payload: unknown, rawNumber: string): CarrierResult {
  const number = normalizeEcoscootingNumber(rawNumber);
  if (!isRecord(payload)) throw new SchemaError('Ecoscooting');
  // The same query error is returned for absent and unavailable orders. It
  // neither identifies a parcel nor proves that Ecoscooting does not know it.
  if (payload.success !== 'true') throw new IndeterminateError('Ecoscooting', 'Ecoscooting could not complete the tracking query');
  if (!isRecord(payload.packageParam) || payload.packageParam.trackingNumber !== number) throw new SchemaError('Ecoscooting', 'Ecoscooting returned a different parcel');
  if (!Array.isArray(payload.statuses) || payload.statuses.length > 500 || !payload.statuses.every(isRecord)) throw new SchemaError('Ecoscooting');
  if (!payload.statuses.length) throw new IndeterminateError('Ecoscooting', 'Ecoscooting returned no parcel history');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const row of payload.statuses) {
    const code = clean(row.actionCode, 64);
    const description = clean(row.description, 500) || clean(row.statusName, 500);
    if (!code || !description) throw new SchemaError('Ecoscooting', 'Ecoscooting returned an incomplete scan');
    if (['trackingNumber', 'mailNo'].some(key => row[key] != null && row[key] !== number)) throw new SchemaError('Ecoscooting', 'Ecoscooting returned a scan for a different parcel');
    if (row.opTimestamp != null && (typeof row.opTimestamp !== 'string' || !/^\d{13}$/.test(row.opTimestamp))) throw new SchemaError('Ecoscooting', 'Ecoscooting returned an invalid millisecond timestamp');
    const time = row.opTimestamp == null ? null : epochMillisTime(row.opTimestamp);
    if (row.opTimestamp != null && !time) throw new SchemaError('Ecoscooting', 'Ecoscooting returned an invalid scan timestamp');
    const display = clean(row.datetime, 64);
    const mapped = ecoscootingStatus(code);
    // The Portuguese gateway schema omits the Spanish completion flags. Its
    // own exact success code and two affirmative labels confirm completion.
    const spanishCompletion = code === 'GTMS_SIGNED' && row.statusGroup === 'delivered' && row.status === 'finish'
      && description === 'Parcel has been delivered successfully';
    const portugueseCompletion = number.startsWith('CNPRT') && code === 'LM_SIGN_SUCCESS'
      && row.statusName === 'Delivery Success' && description === 'Your shipment has been delivered successfully'
      && !Object.hasOwn(row, 'statusGroup') && !Object.hasOwn(row, 'status');
    if (mapped?.stage === 'delivered' && !spanishCompletion && !portugueseCompletion) throw new IndeterminateError('Ecoscooting', 'Ecoscooting returned inconsistent delivery evidence');
    const event: CarrierEvent = { ...(time ? { time: time.iso } : display ? { provider_time_text: display } : {}), description, provider_code: code, ...(mapped ? { stage: mapped.stage } : {}) };
    const key = JSON.stringify(event);
    if (!seen.has(key)) { seen.add(key); events.push(event); }
  }
  const latest = events[0]!;
  const current = ecoscootingStatus(String(latest.provider_code));
  const dims = isRecord(payload.packageParam.dimWeight) ? payload.packageParam.dimWeight : {};
  const grams = typeof dims.weight === 'string' && /^\d+(?:\.\d+)?$/.test(dims.weight) ? Number(dims.weight) : Number.NaN;
  return { status: current?.status ?? 'unknown', ...(current ? { current_stage: current.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, expected_delivery: null,
    ...(current?.stage === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    ...(dims.weightUnit === 'g' && Number.isFinite(grams) && grams > 0 ? { weight_kg: grams / 1000 } : {}), events: events.slice(0, 100) };
}
