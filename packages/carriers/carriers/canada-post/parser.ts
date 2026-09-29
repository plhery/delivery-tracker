import { DateTime } from 'luxon';
import { isValidS10TrackingNumber } from '../../core/detection/s10';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { Stage } from '../../core/status';
import { explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { canadaPostPackageStage, canadaPostScanStage, canadaPostStage, statusForStage } from './status';

export function normalizeCanadaPostNumber(raw: string): string {
  const value = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^\d{11,24}$/.test(value) && !(value.endsWith('CA') && isValidS10TrackingNumber(value))) {
    throw new TypeError('Canada Post requires a parcel PIN, numeric reference or valid Canadian postal tracking number');
  }
  return value;
}

export function canadaPostLookupKind(number: string): 'pin' | 'dnc' | 'reference' {
  if (/^(?:\d{11,12}|\d{16}|[A-Z]{2}\d{9}CA)$/.test(number)) return 'pin';
  return /^\d{15}$/.test(number) ? 'dnc' : 'reference';
}

function sameNumber(value: unknown, requested: string): boolean {
  return typeof value === 'string' && value.trim().toUpperCase() === requested;
}

function checkError(item: JsonObject): void {
  if (!Object.hasOwn(item, 'error')) return;
  if (!isRecord(item.error) || typeof item.error.cd !== 'string' || !item.error.cd.trim()) throw new SchemaError('canada-post');
  // The same 004 envelope is used for unknown and expired public parcels.
  // It cannot distinguish a new reference from history that has been removed.
  throw new IndeterminateError('canada-post', 'Canada Post returned no usable parcel history');
}

export function resolveCanadaPostPin(payload: unknown, requested: string, kind: 'dnc' | 'reference'): string {
  if (!Array.isArray(payload) || payload.length > 100 || !payload.every(isRecord)) throw new SchemaError('canada-post', 'Canada Post returned invalid alias results');
  if (!payload.length || payload.length > 1) throw new IndeterminateError('canada-post', 'Canada Post did not resolve one parcel for this reference');
  const item = payload[0]!;
  const bound = kind === 'dnc' ? sameNumber(item.dnc, requested)
    : sameNumber(item.refNbr1, requested) || sameNumber(item.refNbr2, requested);
  if (!bound) throw new SchemaError('canada-post', 'Canada Post returned another reference');
  checkError(item);
  if (typeof item.pin !== 'string') throw new SchemaError('canada-post', 'Canada Post omitted the parcel PIN');
  let pin: string;
  try { pin = normalizeCanadaPostNumber(item.pin.trim()); }
  catch (cause) { throw new SchemaError('canada-post', 'Canada Post returned an invalid parcel PIN', { cause }); }
  // Returned identities may trim/case-fold, but never gain stripped separators.
  if (!sameNumber(item.pin, pin) || canadaPostLookupKind(pin) !== 'pin') throw new SchemaError('canada-post', 'Canada Post returned an invalid parcel PIN');
  return pin;
}

function textField(item: JsonObject, key: string, limit: number): string {
  if (item[key] != null && typeof item[key] !== 'string') throw new SchemaError('canada-post', 'Canada Post returned an invalid text field');
  return clean(item[key], limit);
}

function calendarDate(value: unknown): string | null {
  if (value != null && typeof value !== 'string') throw new SchemaError('canada-post', 'Canada Post returned an invalid date field');
  const raw = clean(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = DateTime.fromISO(raw, { zone: 'UTC' });
  return parsed.isValid ? parsed.toISODate() : null;
}

function eventClock(value: unknown): Record<string, string> {
  if (value == null) return {};
  if (!isRecord(value)) throw new SchemaError('canada-post', 'Canada Post returned an invalid scan clock');
  const date = textField(value, 'date', 32);
  const time = textField(value, 'time', 32);
  const offset = textField(value, 'zoneOffset', 16);
  const raw = [date, time, offset].filter(Boolean).join(' ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) {
    const local = `${date}T${time.length === 5 ? `${time}:00` : time}`;
    if (/^(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/i.test(offset)) {
      const parsed = explicitOffsetTime(`${local}${offset}`);
      if (parsed) return { time: parsed.iso };
    } else if (!offset) {
      // UTC validates the calendar only; no timezone is attached to local digits.
      const parsed = DateTime.fromISO(local, { zone: 'UTC' });
      const valid = parsed.isValid ? parsed.toISO({ includeOffset: false, suppressMilliseconds: true }) : null;
      if (valid) return { local_time: valid };
    }
  }
  return raw ? { provider_time_text: raw } : {};
}

function returnStarted(text: string): boolean {
  if (/\b(?:will|may|might|would)\b.*\breturn(?:ed)?\b/i.test(text)) return false;
  return /\b(?:being returned|returning|en\s?route|in transit)\b.*\bsender\b|\breturned to (?:the )?sender\b/i.test(text);
}

export function parseCanadaPostTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = normalizeCanadaPostNumber(trackingNumber);
  if (!isRecord(payload) || !sameNumber(payload.pin, number)) throw new SchemaError('canada-post', 'Canada Post returned another parcel or an invalid detail response');
  checkError(payload);
  const summary = textField(payload, 'status', 64);
  for (const flag of ['returnedToSender', 'returnPinIndicator', 'delivered']) {
    if (payload[flag] != null && typeof payload[flag] !== 'boolean') throw new SchemaError('canada-post', 'Canada Post returned an invalid parcel flag');
  }
  if (!Array.isArray(payload.events) || payload.events.length > 500) throw new SchemaError('canada-post', 'Canada Post returned invalid parcel history');
  if (!payload.events.length) throw new IndeterminateError('canada-post', 'Canada Post returned empty parcel history');
  const rows = payload.events.map(raw => {
    if (!isRecord(raw)) throw new SchemaError('canada-post', 'Canada Post returned an invalid scan');
    const code = textField(raw, 'cd', 40);
    const description = textField(raw, 'descEn', 500);
    const type = textField(raw, 'type', 64);
    if (!code || !/^[A-Za-z0-9_-]+$/.test(code) || !description) throw new SchemaError('canada-post', 'Canada Post returned an incomplete scan');
    if (raw.locationAddr != null && !isRecord(raw.locationAddr)) throw new SchemaError('canada-post', 'Canada Post returned an invalid scan location');
    const location = isRecord(raw.locationAddr)
      ? [textField(raw.locationAddr, 'city', 160), textField(raw.locationAddr, 'regionCd', 40)].filter(Boolean).join(', ') : '';
    const stage = type === 'Signature' || code === '20' ? null : canadaPostScanStage(code) ?? canadaPostStage(description);
    const event: CarrierEvent = { ...eventClock(raw.datetime), description: stage === 'delivered' ? 'Delivered' : description,
      provider_code: code, ...(stage ? { stage } : {}), ...(location ? { location } : {}) };
    return { event, type, sourceDate: isRecord(raw.datetime) ? calendarDate(raw.datetime.date) : null,
      returnCue: returnStarted(description) || type === 'RtsLabelProc' };
  });
  // Native detail history is newest first. Compare instants only when every
  // row resolves; an unresolved latest row must not fall behind old scans.
  if (rows.every(row => row.event.time)) rows.sort((a, b) => Date.parse(b.event.time!) - Date.parse(a.event.time!));
  let returning = false;
  for (const row of [...rows].reverse()) {
    if (row.returnCue) returning = true;
    if (returning) {
      row.event.provider_leg = 'return';
      if (row.event.stage === 'delivered') { row.event.stage = 'returned'; row.event.description = 'Returned to sender'; }
    }
  }
  const latest = rows[0]!;
  const explicitReturn = latest.event.provider_leg === 'return';
  const currentReturn = explicitReturn || payload.returnedToSender === true;
  const summaryStage = canadaPostPackageStage(summary);
  const delivery = rows.find(row => row.event.stage === (currentReturn ? 'returned' : 'delivered'));
  const matchingDelivery = delivery?.event.time && latest.event.time === delivery.event.time
    && (latest === delivery || latest.type === 'Signature') ? delivery : undefined;
  let current: Stage | null = (latest.event.stage as Stage | undefined) ?? summaryStage;
  let snapshot: 'delivery' | 'return' | null = null;
  if (currentReturn && !explicitReturn) {
    // A summary flag can announce a return before a return scan exists. Its
    // timing cannot relabel an old outbound delivery as sender completion.
    current = 'exception';
    snapshot = 'return';
  } else if (summaryStage === 'delivered' && !currentReturn) {
    current = 'delivered';
    snapshot = matchingDelivery ? null : 'delivery';
  } else if (currentReturn && !latest.event.stage) {
    current = matchingDelivery ? 'returned' : summaryStage === 'delivered' ? null : summaryStage;
  }
  const seen = new Set<string>();
  const events = rows.map(row => row.event).filter(event => {
    const key = JSON.stringify(event);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  if (snapshot === 'delivery') events.unshift({ description: 'Delivered', stage: 'delivered', summary_snapshot: true });
  if (snapshot === 'return') events.unshift({ description: 'Return to sender', stage: 'exception', provider_leg: 'return', summary_snapshot: true });
  const estimate = payload.expectedDlvryDateTime;
  if (estimate != null && !isRecord(estimate)) throw new SchemaError('canada-post', 'Canada Post returned an invalid delivery estimate');
  const revised = isRecord(estimate) ? calendarDate(estimate.revisedDate) : null;
  const standard = isRecord(estimate) ? calendarDate(estimate.dlvryDate) : null;
  const actualDay = calendarDate(payload.actualDlvryDate);
  const actualEventDay = delivery?.event.time?.slice(0, 10);
  const deliveredAt = current === 'delivered' && matchingDelivery && (!actualDay || actualDay === actualEventDay) ? matchingDelivery.event.time : null;
  const candidate = isRecord(estimate) && clean(estimate.revisedDate, 64) ? revised : standard;
  const expected = !currentReturn && current !== 'delivered' && current !== 'returned' && current !== 'exception' && current !== 'failed_attempt'
    && summary !== 'FullProgressAlert' && summary !== 'InTransitAlert' && canadaPostScanStage(latest.event.provider_code!)
    && candidate && latest.sourceDate && candidate >= latest.sourceDate ? candidate : null;
  return { status: current ? statusForStage(current) : 'unknown', ...(current ? { current_stage: current } : {}),
    last_status_text: snapshot === 'return' ? 'Return to sender' : current === 'delivered' ? 'Delivered'
      : current === 'returned' ? 'Returned to sender' : latest.event.description,
    last_update: snapshot ? null : latest.event.time ?? null,
    ...(!snapshot && latest.event.local_time ? { last_update_local: latest.event.local_time } : {}),
    expected_delivery: expected, ...(deliveredAt ? { delivered_at: deliveredAt } : {}), events: events.slice(0, 100) };
}
