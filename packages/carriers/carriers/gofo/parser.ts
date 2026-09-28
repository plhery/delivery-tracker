import { DateTime } from 'luxon';
import { normalizeTrackingNumber } from '../../core/detection';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { gofoStatus } from './status';

export function normalizeGofoNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^GFUS\d{14}$/.test(number)) throw new TypeError('GOFO US requires a GFUS parcel reference');
  return number;
}

function scanClock(value: unknown): Pick<CarrierEvent, 'time'> & { local_time?: string; provider_time_text?: string } {
  const raw = clean(value, 64);
  const match = /^(\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?)(Z|[+-](?:0\d|1[0-4]):?[0-5]\d)?$/.exec(raw);
  if (!match) {
    // Offset-looking values must not exploit a permissive ISO parser.
    if (raw.includes('T') && /(?:Z|[+-][\d:]+)$/i.test(raw)) throw new SchemaError('GOFO', 'GOFO returned an invalid scan timestamp');
    return raw ? { provider_time_text: raw } : {};
  }
  const local = DateTime.fromISO(match[1]!, { zone: 'UTC' });
  if (!local.isValid) throw new SchemaError('GOFO', 'GOFO returned an invalid scan date');
  if (!match[2]) return { local_time: local.toISO({ includeOffset: false, suppressMilliseconds: true })! };
  const offset = match[2].replace(':', '');
  if (offset !== 'Z' && Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3)) > 840) throw new SchemaError('GOFO', 'GOFO returned an invalid scan offset');
  const time = explicitOffsetTime(raw);
  if (!time) throw new SchemaError('GOFO', 'GOFO returned an invalid scan timestamp');
  return { time: time.iso };
}

export function parseGofo(payload: unknown, rawNumber: string): CarrierResult {
  const number = normalizeGofoNumber(rawNumber);
  if (!isRecord(payload)) throw new SchemaError('GOFO');
  if (payload.code !== 200 || payload.success !== 1) throw new IndeterminateError('GOFO', 'GOFO returned an inconclusive lookup');
  if (!isRecord(payload.data) || !Array.isArray(payload.data.success) || payload.data.success.length > 25
    || !payload.data.success.every(isRecord) || !isRecord(payload.data.error)) throw new SchemaError('GOFO');
  const entries = payload.data.success;
  const error = payload.data.error;
  if (!entries.length && error.errorCount === 1 && Array.isArray(error.us) && error.us.length === 1 && error.us[0] === number
    && Object.keys(error).every(key => ['errorCount', 'us'].includes(key))) throw new NotFoundError('GOFO');
  if (!entries.length) throw new IndeterminateError('GOFO', 'GOFO returned no matching history');
  if (entries.length !== 1 || entries[0].waybillNo !== number || entries[0].trackingNumber !== number || error.errorCount !== 0) {
    throw new SchemaError('GOFO', 'GOFO returned a different or ambiguous parcel');
  }
  const item = entries[0]!;
  if (!Array.isArray(item.trackEventList) || item.trackEventList.length > 500 || !item.trackEventList.every(isRecord)) throw new SchemaError('GOFO');
  if (!item.trackEventList.length) throw new IndeterminateError('GOFO', 'GOFO returned no parcel scans');
  if (typeof item.trackEventCount !== 'number' || item.trackEventCount !== item.trackEventList.length) {
    throw new IndeterminateError('GOFO', 'GOFO returned incomplete parcel history');
  }
  const first = item.trackEventList[0]!;
  const summary = item.lastTrackEvent;
  if (!isRecord(summary) || ['processDate', 'processCode', 'processContent', 'processCity', 'processProvince', 'processLocation', 'processDeptId', 'processSecondCode', 'processTimeZone', 'processTimeZoneMapping'].some(key => summary[key] !== first[key])) {
    throw new IndeterminateError('GOFO', 'GOFO latest summary does not match its first scan');
  }
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const row of item.trackEventList) {
    const code = clean(row.processCode, 32);
    const rawDescription = clean(row.processContent, 500);
    if (!code || !rawDescription) throw new SchemaError('GOFO', 'GOFO returned an incomplete scan');
    const mapped = gofoStatus(code);
    if (mapped?.stage === 'delivered' && !/^Delivered(?:,|$)/.test(rawDescription)) throw new IndeterminateError('GOFO', 'GOFO returned inconsistent delivery evidence');
    if (['trackingNumber', 'waybillNo'].some(key => row[key] != null && row[key] !== number)) throw new SchemaError('GOFO', 'GOFO returned a scan for a different parcel');
    const timestamp = scanClock(row.processDate);
    const location = [clean(row.processCity, 100), clean(row.processProvince, 20)].filter(Boolean).join(', ');
    const description = mapped?.stage === 'delivered' ? 'Delivered' : rawDescription;
    const event: CarrierEvent = { ...timestamp, description, provider_code: code,
      ...(location ? { location } : {}), ...(mapped ? { stage: mapped.stage } : {}) };
    const key = JSON.stringify(event);
    if (!seen.has(key)) { seen.add(key); events.push(event); }
  }
  const latest = events[0]!;
  const current = gofoStatus(String(latest.provider_code));
  return { status: current?.status ?? 'unknown', ...(current ? { current_stage: current.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, last_update_local: latest.local_time ?? null,
    expected_delivery: null,
    ...(current?.stage === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    ...(item.toCountry === 'USA' ? { destination_country: 'US' } : {}), events: events.slice(0, 100) };
}
