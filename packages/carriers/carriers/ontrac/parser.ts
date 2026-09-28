import { DateTime } from 'luxon';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyOntracStatus } from './status';

export function normalizeOntracNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^(?:[CD]\d{14}|L[AIEHNX]\d{8}|1LS[A-Z0-9]{12,14})$/.test(number)) {
    throw new TypeError('OnTrac requires an OnTrac or LaserShip tracking number');
  }
  return number;
}

function unresolvedWallTime(value: unknown): string | null {
  const raw = clean(value, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(raw)) return null;
  // UTC validates the digits only; no timezone is assigned to this wall clock.
  const parsed = DateTime.fromISO(raw, { zone: 'UTC' });
  return parsed.isValid ? parsed.toISO({ includeOffset: false, suppressMilliseconds: true }) : null;
}

export function parseOntrac(payload: unknown, number: string): CarrierResult {
  const requested = normalizeOntracNumber(number);
  if (!isRecord(payload) || !Array.isArray(payload.Packages) || payload.Packages.length > 100) {
    throw new SchemaError('OnTrac');
  }
  const matches = payload.Packages.filter(isRecord).filter((item) => clean(item.Tracking, 64).toUpperCase() === requested);
  if (matches.length !== 1) throw new SchemaError('OnTrac', 'OnTrac did not return one matching shipment');
  const item = matches[0]!;
  if (!Array.isArray(item.Events)) throw new SchemaError('OnTrac');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  item.Events.slice(0, 500).forEach((raw) => {
    if (!isRecord(raw)) return;
    const code = clean(raw.EventCode, 32);
    const description = clean(raw.EventShortDescription, 500);
    if (!description) return;
    const time = explicitOffsetTime(raw.ZonedEventDateTime) ?? explicitOffsetTime(raw.UtcEventDateTime);
    const local = time ? null : unresolvedWallTime(raw.ZonedEventDateTime) ?? unresolvedWallTime(raw.UtcEventDateTime);
    const location = [clean(raw.City, 100), clean(raw.State, 80)].filter(Boolean).join(', ');
    const clock = time?.iso ?? local ?? (clean(raw.ZonedEventDateTime, 64) || clean(raw.UtcEventDateTime, 64));
    const key = `${clock}\u0000${code}\u0000${description}\u0000${location}`;
    if (seen.has(key)) return;
    seen.add(key);
    const mapped = classifyOntracStatus(code);
    events.push({ description, ...(time ? { time: time.iso } : {}), ...(local ? { local_time: local } : {}),
      ...(location ? { location } : {}), ...(code ? { provider_code: code } : {}), ...(mapped ? { stage: mapped.stage } : {}) });
  });
  if (!events.length) throw new IndeterminateError('OnTrac', 'OnTrac returned no tracking scans');
  // The endpoint sends newest first, including scans whose clocks lack offsets.
  const latest = events[0]!;
  const mapped = classifyOntracStatus(latest.provider_code ?? '');
  const estimate = explicitOffsetTime(item.UtcExpectedDeliveryDateTime);
  const weight = typeof item.Weight === 'number' && Number.isFinite(item.Weight) && item.Weight > 0 ? item.Weight : null;
  const units = clean(item.WeightUnits, 16).toLowerCase();
  const weightKg = weight !== null ? (units === 'lbs' || units === 'lb' ? weight * 0.45359237 : units === 'kg' ? weight : null) : null;
  return {
    status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, last_update_local: latest.local_time ?? null,
    expected_delivery: mapped?.status === 'delivered' ? null : estimate?.iso ?? null,
    ...(mapped?.status === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    ...(weightKg !== null ? { weight_kg: weightKg } : {}), events: events.slice(0, 100),
  };
}
