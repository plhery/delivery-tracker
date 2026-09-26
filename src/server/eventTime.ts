/**
 * How the host reads a carrier result's times: an offset is kept, and an
 * offset-less wall time is read in the result's declared zone, else its
 * carrier's catalog zone. Persisted events and the routing watermark share
 * this policy, so a naive local clock is never compared as if it were UTC.
 */
import { DateTime, IANAZone } from 'luxon';
import type { CarrierResult } from '@carriers/core/result';
import { carrierTimezone } from './carriers';

export function resultTimezone(carrierId: string, result: CarrierResult): string {
  const declared = typeof result.timezone === 'string' ? result.timezone : '';
  if (declared.length >= 1 && declared.length <= 64 && IANAZone.isValidZone(declared)) return declared;
  try {
    const configured = carrierTimezone(carrierId);
    return IANAZone.isValidZone(configured) ? configured : 'UTC';
  } catch {
    return 'UTC';
  }
}

const EVENT_FORMATS = [
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-MM-dd HH:mm',
  'dd.MM.yyyy HH:mm:ss',
  'dd.MM.yyyy HH:mm',
  'dd/MM/yyyy HH:mm:ss',
  'dd/MM/yyyy HH:mm',
  'yyyy-MM-dd',
  'dd.MM.yyyy',
  'dd/MM/yyyy',
];

export function eventTimestamp(raw: unknown, assumedTimezone = 'UTC'): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim();
  let parsed = DateTime.fromISO(value, { setZone: true });
  if (parsed.isValid) {
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
      parsed = DateTime.fromISO(value, { zone: assumedTimezone });
    }
    return parsed.toUTC().toISO({ suppressMilliseconds: true }) ?? null;
  }
  for (const format of EVENT_FORMATS) {
    parsed = DateTime.fromFormat(value, format, { zone: assumedTimezone });
    if (parsed.isValid) return parsed.toUTC().toISO({ suppressMilliseconds: true }) ?? null;
  }
  return null;
}

/** The newest instant of a result, under the same timezone policy as persisted events; 0 without one. */
export function latestResultTime(result: CarrierResult, carrier: string): number {
  const timezone = resultTimezone(carrier, result);
  return Math.max(0, ...[result.last_update, ...(result.events ?? []).map((event) => event.time)]
    .map((time) => Date.parse(eventTimestamp(time, timezone) ?? '') || 0));
}
