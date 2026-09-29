import { DateTime } from 'luxon';
import { isValidS10TrackingNumber } from '../../core/detection/s10';
import { ChallengeError, IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean } from '../../core/transport/text';
import { isRecord } from '../../core/types';
import { ukrposhtaReturnCue, ukrposhtaStatus } from './status';

const PROVIDER = 'ukrposhta';
const MAX_SCANS = 500;

export function normalizeUkrposhtaNumber(raw: string): string {
  const number = raw.trim().replace(/[\s-]+/g, '').toUpperCase();
  if (/^\d{13}$/.test(number) || isValidS10TrackingNumber(number)) return number;
  throw new TypeError('Ukrposhta requires a 13-digit domestic or valid S10 postal reference');
}

function text(value: unknown, field: string, required = false): string {
  if (value != null && typeof value !== 'string') throw new SchemaError(PROVIDER, `Ukrposhta returned an invalid ${field}`);
  const result = clean(value, 300);
  if (required && !result) throw new SchemaError(PROVIDER, `Ukrposhta omitted ${field}`);
  return result;
}

function envelope(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new SchemaError(PROVIDER, 'Ukrposhta returned an invalid tracking response');
  if (value.code === 'captcha_failed') throw new ChallengeError(PROVIDER, 'Ukrposhta rejected automatic browser verification');
  return value;
}

/** Validate calendar digits without assigning a timezone to the wall clock. */
export function ukrposhtaWallClock(value: string): string | null {
  const raw = value.trim();
  const format = /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/.test(raw) ? 'dd.MM.yyyy HH:mm'
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw) ? "yyyy-MM-dd'T'HH:mm:ss" : null;
  if (!format) return null;
  const date = DateTime.fromFormat(raw, format, { zone: 'UTC' });
  return date.isValid && date.toFormat(format) === raw ? date.toFormat("yyyy-MM-dd'T'HH:mm:ss") : null;
}

export interface UkrposhtaOverview {
  number: string;
  count: number;
  date: string;
  code: string;
  label: string;
  location: string;
  country: string;
}

export function parseUkrposhtaOverview(payload: unknown, requested: string): UkrposhtaOverview {
  const number = normalizeUkrposhtaNumber(requested);
  const data = envelope(payload);
  // The native unknown response has no returned barcode. It cannot prove
  // absence for this reference, even though the page calls it not found.
  if (isRecord(data.result) && data.result.message === 'Shipment not found') throw new IndeterminateError(PROVIDER);
  if (!Array.isArray(data.result)) throw new SchemaError(PROVIDER, 'Ukrposhta omitted its parcel overview');
  if (!data.result.length) throw new IndeterminateError(PROVIDER);
  if (data.result.length !== 1) throw new IndeterminateError(PROVIDER, 'Ukrposhta returned an ambiguous parcel overview');
  const row: unknown = data.result[0];
  if (!isRecord(row)) throw new SchemaError(PROVIDER, 'Ukrposhta returned an invalid parcel overview');
  if (text(row.barcode, 'overview identity', true).toUpperCase() !== number) throw new SchemaError(PROVIDER, 'Ukrposhta returned a different parcel identity');
  if (!Number.isInteger(row.step) || Number(row.step) < 1 || Number(row.step) > MAX_SCANS) throw new IndeterminateError(PROVIDER, 'Ukrposhta returned an unresolved history count');
  return { number, count: Number(row.step), date: text(row.date, 'overview clock'), code: text(row.event, 'overview event code', true),
    label: text(row.eventName, 'overview status', true), location: text(row.name, 'overview location'), country: text(row.country, 'overview country') };
}

export function parseUkrposhtaHistory(payload: unknown, overview: UkrposhtaOverview): CarrierResult {
  const data = envelope(payload);
  if (!isRecord(data.from_to) || !Array.isArray(data.result)) throw new SchemaError(PROVIDER, 'Ukrposhta omitted its parcel history');
  if (![0, false, '0'].includes(data.from_to.ISSEVERALPLACES as number | boolean | string)
    || data.several_places === true) throw new IndeterminateError(PROVIDER, 'Ukrposhta returned a shipment with multiple pieces');
  // This auxiliary flag is false for both positive histories and unknown
  // references. It is not a barcode-recognition signal.
  if (data.date_by_barcode != null && typeof data.date_by_barcode !== 'boolean') throw new SchemaError(PROVIDER, 'Ukrposhta returned an invalid auxiliary date flag');
  if (!data.result.length) throw new IndeterminateError(PROVIDER);
  if (data.result.length > MAX_SCANS) throw new SchemaError(PROVIDER, 'Ukrposhta returned excessive history');
  if (data.result.length !== overview.count) throw new IndeterminateError(PROVIDER, 'Ukrposhta returned incomplete or changed history');
  const checkIdentity = (value: unknown) => {
    if (value != null && text(value, 'history identity', true).toUpperCase() !== overview.number) throw new SchemaError(PROVIDER, 'Ukrposhta returned a different history identity');
  };
  checkIdentity(data.nod_barcode);
  const rows = data.result.map((raw: unknown) => {
    if (!isRecord(raw)) throw new SchemaError(PROVIDER, 'Ukrposhta returned an invalid history row');
    checkIdentity(raw.nod_barcode);
    return { date: text(raw.gtt_date, 'scan clock'), code: text(raw.gtt_event, 'scan code', true),
      label: text(raw.gtt_event_name, 'scan status', true), location: text(raw.gtt_name, 'scan location'), country: text(raw.gtt_country, 'scan country'),
      reason: text(raw.gtt_eventreason_id, 'scan reason code') };
  });
  const latest = rows[0]!;
  const latestClock = ukrposhtaWallClock(latest.date), overviewClock = ukrposhtaWallClock(overview.date);
  // The overview carries seconds that the full native history omits. Bind
  // at the history's minute precision without promoting overview seconds.
  const sameClock = latestClock !== null && overviewClock !== null
    ? latestClock.slice(0, 16) === overviewClock.slice(0, 16) : latest.date === overview.date;
  if (!sameClock || latest.code !== overview.code || latest.label !== overview.label
    || latest.location !== overview.location || latest.country !== overview.country) throw new IndeterminateError(PROVIDER, 'Ukrposhta overview and current history disagree');

  // Both native histories are current-first. Keep that order across foreign
  // wall clocks or missing dates instead of sorting them as UTC instants.
  let returnLeg = false;
  const events: CarrierEvent[] = Array(rows.length);
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!;
    if (ukrposhtaReturnCue(row.label)) returnLeg = true;
    let classified = ukrposhtaStatus(row.code);
    if (row.reason === '65' || row.reason === '66') classified = { status: 'exception', stage: 'exception' };
    if (classified?.stage === 'delivered' && returnLeg) classified = { status: 'exception', stage: 'returned' };
    const local = ukrposhtaWallClock(row.date);
    events[index] = {
      description: row.label, provider_code: row.code,
      ...(row.location || row.country ? { location: [row.location, row.country].filter(Boolean).join(', ') } : {}),
      ...(local ? { local_time: local } : row.date ? { provider_time_text: row.date } : {}),
      ...(classified ? { stage: classified.stage } : {}), ...(returnLeg ? { provider_leg: 'return' } : {}),
    };
  }
  const current = events[0]!;
  const stage = current.stage;
  const status = stage === 'returned' || stage === 'exception' ? 'exception' : ukrposhtaStatus(latest.code)?.status ?? 'unknown';
  const seen = new Set<string>();
  const deduplicated = events.filter(event => { const key = JSON.stringify(event); if (seen.has(key)) return false; seen.add(key); return true; });
  return { status, ...(stage ? { current_stage: stage } : {}), last_status_text: latest.label, last_update: null, events: deduplicated.slice(0, 100) };
}
