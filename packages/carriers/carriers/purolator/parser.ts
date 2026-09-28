import { DateTime } from 'luxon';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyPurolatorStatus } from './status';

export function normalizePurolatorNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^(?:[0-5]\d{11}|(?!BYS)[A-Z]{3}\d{9})$/.test(number)) throw new TypeError('Purolator requires a Purolator tracking PIN');
  return number;
}

export function parsePurolator(payload: unknown, number: string): CarrierResult {
  const requested = normalizePurolatorNumber(number);
  if (!isRecord(payload) || !Array.isArray(payload.searchResult) || payload.searchResult.length !== 1 || !isRecord(payload.searchResult[0])
    || !Array.isArray(payload.shipment) || payload.shipment.length > 100) throw new SchemaError('Purolator');
  const search = payload.searchResult[0];
  if (search.trackingId !== requested || search.sequenceId !== 1) throw new SchemaError('Purolator', 'Purolator returned a different search');
  // CONFLICT also occurs for an unknown-looking PIN. It is never a clean negative.
  if (search.status !== 'FOUND') throw new IndeterminateError('Purolator', 'Purolator did not return a unique matching shipment');
  if (search.type !== 'PIN' || !Number.isInteger(search.shipmentIndex) || !Number.isInteger(search.packageIndex)
    || (search.shipmentIndex as number) < 0 || (search.packageIndex as number) < 0) throw new SchemaError('Purolator');
  const shipment = payload.shipment[search.shipmentIndex as number];
  if (!isRecord(shipment) || !Array.isArray(shipment.package) || shipment.package.length > 100 || !shipment.package.every(isRecord)) throw new SchemaError('Purolator');
  const item = shipment.package[search.packageIndex as number];
  if (!item || item.pin !== requested || shipment.package.filter((candidate) => candidate.pin === requested).length !== 1) {
    throw new SchemaError('Purolator', 'Purolator did not return one matching package');
  }
  if (!Array.isArray(item.events) || item.events.length > 500) throw new SchemaError('Purolator');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const raw of item.events) {
    if (!isRecord(raw)) throw new SchemaError('Purolator', 'Purolator returned an incomplete scan row');
    const description = clean(raw.description, 500);
    const code = clean(raw.code, 64);
    if (!description || !code) throw new SchemaError('Purolator', 'Purolator returned a scan without wording or code');
    const rawTime = clean(raw.dateTime, 64);
    const instant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.test(rawTime)
      ? explicitOffsetTime(rawTime) : null;
    // The cross-country endpoint sends local wall clocks with no zone. UTC
    // validates the digits only; it is not assigned to the event.
    const wall = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawTime)
      ? DateTime.fromFormat(rawTime, 'yyyy-MM-dd HH:mm:ss', { zone: 'UTC' }) : null;
    const local = wall?.isValid ? wall.toISO({ includeOffset: false, suppressMilliseconds: true }) : null;
    const location = isRecord(raw.location) ? [clean(raw.location.city, 100), clean(raw.location.provinceState, 32), clean(raw.location.countryCode, 2)].filter(Boolean).join(', ') : '';
    const key = `${instant?.iso ?? local ?? rawTime}\u0000${code}\u0000${description}\u0000${location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const mapped = classifyPurolatorStatus(code);
    events.push({ description, provider_code: code, ...(location ? { location } : {}),
      ...(instant ? { time: instant.iso } : local ? { local_time: local } : rawTime ? { provider_time_text: rawTime } : {}),
      ...(mapped ? { stage: mapped.stage } : {}) });
  }
  if (!events.length) throw new IndeterminateError('Purolator', 'Purolator returned no tracking scans');
  // Request eventSortOrder=d and preserve that order, including unresolved clocks.
  const latest = events[0]!;
  const mapped = classifyPurolatorStatus(latest.provider_code ?? '');
  // Shipment weight describes the entire shipment; do not attach it to one
  // piece of a multi-package shipment.
  const measured = shipment.pieceTotalCount === 1 && shipment.package.length === 1 && isRecord(shipment.details) && isRecord(shipment.details.weight)
    ? shipment.details.weight : null;
  const weight = measured && typeof measured.value === 'number' && Number.isFinite(measured.value) && measured.value > 0 ? measured.value : null;
  const unit = measured ? clean(measured.unit, 8).toUpperCase() : '';
  const weightKg = weight !== null ? unit === 'LB' ? weight * 0.45359237 : unit === 'KG' ? weight : null : null;
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, last_update_local: latest.local_time ?? null,
    expected_delivery: null, ...(mapped?.status === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    ...(weightKg !== null ? { weight_kg: weightKg } : {}), events: events.slice(0, 100) };
}
