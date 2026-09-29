import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { HIDDEN_NINJA_EVENTS, ninjaVanStatus } from './status';

const PROVIDER = 'Ninja Van';
const MAX_SCANS = 500;
const MAX_EVENTS = 100;

/** The MY public order endpoint is the only country route with a live positive. */
export function normalizeNinjaVanNumber(raw: string): string {
  const number = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!/^NLMY[A-Z]{1,2}\d{8,10}$/.test(number)) throw new TypeError('Ninja Van direct tracking requires an NLMY parcel ID');
  return number;
}

export function parseNinjaVanNotFound(payload: unknown, number: string): never {
  const requested = normalizeNinjaVanNumber(number);
  if (isRecord(payload) && isRecord(payload.error) && payload.error.code === 150002
    && payload.error.title === 'Not Found'
    && payload.error.message === `order by tracking id ${requested} not found.`) {
    throw new NotFoundError(PROVIDER);
  }
  throw new IndeterminateError(PROVIDER, 'Ninja Van returned an inconclusive tracking error');
}

function scanClock(raw: unknown): { time?: string; provider_time_text?: string } {
  if (raw == null) return {};
  if (typeof raw !== 'string') throw new SchemaError(PROVIDER, 'Ninja Van returned an invalid scan clock');
  const label = clean(raw, 80);
  if (!label) return {};
  // All observed scan clocks carry Z. Reject impossible offsets and retain
  // malformed labels; an older valid clock must not date the current state.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-](?:(?:0\d|1[0-3]):?[0-5]\d|14:?00))$/i.test(label)) {
    const parsed = explicitOffsetTime(label);
    if (parsed) return { time: parsed.iso };
  }
  return { provider_time_text: label };
}

export function parseNinjaVan(payload: unknown, rawNumber: string): CarrierResult {
  const number = normalizeNinjaVanNumber(rawNumber);
  if (!isRecord(payload)) throw new SchemaError(PROVIDER);
  if (payload.error != null) throw new IndeterminateError(PROVIDER, 'Ninja Van returned a tracking error');
  if (payload.tracking_id !== number || typeof payload.id !== 'number' || !Number.isSafeInteger(payload.id)
    || payload.id <= 0 || !Array.isArray(payload.events) || payload.events.length > MAX_SCANS
    || typeof payload.status !== 'string' || typeof payload.granular_status !== 'string') {
    throw new SchemaError(PROVIDER, 'Ninja Van returned a different or incomplete shipment');
  }
  if (!payload.events.length) throw new IndeterminateError(PROVIDER, 'Ninja Van returned no parcel history');
  // The official client reverses this oldest-first feed and hides three
  // internal event types. That matters here: a routing row can follow a
  // completed return, but is not a new delivery transition.
  const events: CarrierEvent[] = [];
  let returning = false;
  for (const row of payload.events) {
    if (!isRecord(row) || row.order_id !== payload.id || !isRecord(row.data)
      || typeof row.type !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(row.type)) {
      throw new SchemaError(PROVIDER, 'Ninja Van returned an invalid parcel scan');
    }
    if (row.data.is_rts != null && typeof row.data.is_rts !== 'boolean') {
      throw new SchemaError(PROVIDER, 'Ninja Van returned an invalid return marker');
    }
    const clock = scanClock(row.time);
    if (row.type === 'RTS' || row.data.is_rts === true) returning = true;
    if (HIDDEN_NINJA_EVENTS.has(row.type)) continue;
    const mapped = ninjaVanStatus(row.type);
    const completedReturn = row.type === 'DELIVERY_SUCCESS' && row.data.is_rts === true;
    const ambiguousReturnDelivery = returning && row.type === 'DELIVERY_SUCCESS' && row.data.is_rts !== true;
    const stage = completedReturn ? 'returned' : ambiguousReturnDelivery ? 'exception' : mapped?.stage;
    const location = clean(row.data.hub_name, 160);
    events.push({ provider_code: row.type, description: row.type.replaceAll('_', ' ').toLowerCase(), ...clock,
      ...(location ? { location } : {}), ...(stage ? { stage } : {}), ...(returning ? { provider_leg: 'return' } : {}),
    });
  }
  events.reverse();
  if (!events.length) throw new IndeterminateError(PROVIDER, 'Ninja Van returned no visible parcel history');
  const latest = events[0]!;
  const returned = latest.stage === 'returned';
  const mapped = ninjaVanStatus(latest.provider_code ?? '');
  const currentStage = latest.stage;
  const status = returned ? 'exception' : currentStage === 'exception' ? 'exception' : mapped?.status ?? 'unknown';
  return { status, ...(currentStage ? { current_stage: currentStage } : {}),
    last_status_text: returned ? 'Returned to sender' : latest.description,
    last_update: latest.time ?? null, expected_delivery: null,
    ...(currentStage === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    events: events.slice(0, MAX_EVENTS) };
}
