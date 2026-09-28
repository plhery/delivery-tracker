import { IndeterminateError, InputRequiredError, SchemaError } from '../../core/errors';
import { normalizeTrackingNumber } from '../../core/detection';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { epochMillisTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { dtdcStatus } from './status';

const PROVIDER = 'DTDC';

export function normalizeDtdcNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^[A-Z0-9]{8,20}$/.test(number)) throw new InputRequiredError(PROVIDER, 'number', 'DTDC requires an alphanumeric shipment reference');
  return number;
}

function instant(value: unknown): string {
  // This feed supplies epoch milliseconds. Seconds must not become 1970 scans.
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1_000_000_000_000) {
    throw new SchemaError(PROVIDER, 'DTDC returned an invalid event instant');
  }
  const parsed = epochMillisTime(value);
  if (!parsed) throw new SchemaError(PROVIDER, 'DTDC returned an invalid event instant');
  return parsed.iso;
}

function event(raw: Record<string, unknown>, summary = false): CarrierEvent {
  if (!['forward', 'rto'].includes(String(raw.type))) throw new SchemaError(PROVIDER, 'DTDC returned an unknown shipment leg');
  const description = clean(summary ? raw.current_event_description : raw.event_description, 500) || clean(raw.status_external, 500);
  if (!description) throw new SchemaError(PROVIDER, 'DTDC returned an event with no description');
  const mapped = dtdcStatus(clean(raw.status_external, 200)) ?? dtdcStatus(description);
  const returning = raw.type === 'rto';
  const location = clean(raw.location, 200);
  const code = clean(raw.status_internal, 100);
  return { description, time: instant(raw.timestamp), ...(location ? { location } : {}),
    ...(mapped ? { stage: returning ? 'returned' : mapped.stage } : {}),
    ...(code ? { provider_code: code } : {}), ...(returning ? { provider_leg: 'return' } : {}) };
}

export function parseDtdc(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizeDtdcNumber(trackingNumber);
  if (!isRecord(payload)) throw new SchemaError(PROVIDER);
  if (payload.status === 'ERROR') throw new IndeterminateError(PROVIDER, 'DTDC could not return shipment details');
  if (payload.status !== 'OK' || !isRecord(payload.data)) throw new SchemaError(PROVIDER);
  const data = payload.data;
  if (!isRecord(data.consignment) || !Array.isArray(data.tracking) || data.tracking.length > 1000) throw new SchemaError(PROVIDER);
  const references = [data.consignment.AWBNo, data.consignment.referenceNumber]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeTrackingNumber);
  if (!references.includes(requested)) throw new SchemaError(PROVIDER, 'DTDC returned a different shipment');
  // A verified consignment may expose both its booking reference and original
  // waybill. Empty history waybills are common; nonempty ones must match it.
  const forwardAliases = new Set([requested, ...references]);
  const returnAliases = new Set(forwardAliases);
  if (typeof data.rto_awb_num === 'string' && data.rto_awb_num) returnAliases.add(normalizeTrackingNumber(data.rto_awb_num));
  const snapshot = event(data, true);
  const events: CarrierEvent[] = [snapshot];
  const seen = new Set([JSON.stringify(snapshot)]);
  for (const scan of data.tracking) {
    if (!isRecord(scan)) throw new SchemaError(PROVIDER, 'DTDC returned an incomplete history row');
    const waybill = clean(scan.awb_number, 64);
    const aliases = scan.type === 'rto' ? returnAliases : forwardAliases;
    if (waybill && !aliases.has(normalizeTrackingNumber(waybill))) throw new SchemaError(PROVIDER, 'DTDC returned mixed shipment history');
    const parsed = event(scan);
    const key = JSON.stringify(parsed);
    if (!seen.has(key)) { seen.add(key); events.push(parsed); }
  }
  events.sort((a, b) => Date.parse(b.time!) - Date.parse(a.time!));
  const wording = snapshot.description!;
  const mapped = dtdcStatus(clean(data.status_external, 200)) ?? dtdcStatus(wording);
  const returning = data.type === 'rto' && mapped;
  return { status: returning ? 'exception' : mapped?.status ?? 'unknown',
    ...(mapped ? { current_stage: returning ? 'returned' : mapped.stage } : {}),
    last_status_text: wording, last_update: snapshot.time, timezone: 'Asia/Kolkata',
    ...(mapped?.stage === 'delivered' && !returning ? { delivered_at: snapshot.time } : {}),
    events: events.slice(0, 100) };
}
