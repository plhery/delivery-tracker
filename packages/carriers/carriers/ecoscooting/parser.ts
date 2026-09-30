import { normalizeTrackingNumber } from '../../core/detection';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { epochMillisTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { ecoscootingStatus } from './status';

const COLLECTED = ['PUDO Sign Success', 'Your shipment has been collected by consignee at the parcelshop'] as const;
/** Status name and description that confirm each completion code. */
const COMPLETION_LABELS = new Map<string, readonly [string, string]>([
  ['GTMS_SIGNED', ['Delivery Success', 'Parcel has been delivered successfully']],
  ['LM_SIGN_SUCCESS', ['Delivery Success', 'Your shipment has been delivered successfully']],
  ['GTMS_PUDO_SIGNED', COLLECTED],
  ['PUDO_SIGN_SUCCESS', COLLECTED],
]);
/** Scans that place the parcel at a pickup point, in either code family. */
const PICKUP_POINT_CODES = new Set(['GTMS_PUDO_INBOUND', 'GTMS_STA_SIGNED', 'GTMS_PUDO_SIGNED', 'GTMS_PUDO_OVERDUE',
  'PUDO_INBOUND', 'PUDO_DELIVERY', 'PUDO_SIGN_SUCCESS', 'PUDO_OVERDUE']);

export function normalizeEcoscootingNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^(?:\d{18}|CN(?:ESP|PRT)\d{20})$/.test(number)) throw new TypeError('Ecoscooting requires a numeric, CNESP or CNPRT parcel reference');
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
    // Either code family may come with or without completion flags. A delivery
    // or a collection needs its exact code and both affirmative labels, and
    // flags, when present, must both affirm it.
    const labels = COMPLETION_LABELS.get(code);
    const flagsAgree = (!Object.hasOwn(row, 'statusGroup') && !Object.hasOwn(row, 'status'))
      || (row.statusGroup === 'delivered' && row.status === 'finish');
    const completed = !!labels && row.statusName === labels[0] && description === labels[1] && flagsAgree;
    if (mapped?.stage === 'delivered' && !completed) throw new IndeterminateError('Ecoscooting', 'Ecoscooting returned inconsistent delivery evidence');
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
    ...(dims.weightUnit === 'g' && Number.isFinite(grams) && grams > 0 ? { weight_kg: grams / 1000 } : {}),
    ...pickupPoint(payload.popStationParam, events), events: events.slice(0, 100) };
}

// A shop's name and address, once a scan places the parcel there. It stays
// after collection so the parcel still says where it was collected. The pickup
// PIN, the shop's phone and the station id are never read.
function pickupPoint(station: unknown, events: CarrierEvent[]): { pickup_point?: string } {
  if (!isRecord(station) || !events.some(event => PICKUP_POINT_CODES.has(String(event.provider_code)))) return {};
  const lines = [...new Set([clean(station.stationName, 160), clean(station.detailAddress, 300)].filter(Boolean))];
  return lines.length ? { pickup_point: lines.join('\n') } : {};
}
