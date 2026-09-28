import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { isoTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyDelhiveryStatus } from './status';

function scanTime(value: unknown) {
  const raw = clean(value, 64);
  // A calendar day is not a midnight scan. Require the supplied civil clock
  // before applying the feed's India timezone to an offset-less timestamp.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(raw)
    ? isoTime(raw, 'Asia/Kolkata') : null;
}

export function normalizeDelhiveryNumber(raw: string): string {
  const number = raw.replace(/[\s.-]/g, '');
  if (!/^\d{13,14}$/.test(number)) throw new TypeError('Delhivery requires a thirteen- or fourteen-digit waybill');
  return number;
}

export function parseDelhivery(payload: unknown, number: string): CarrierResult {
  const requested = normalizeDelhiveryNumber(number);
  if (!isRecord(payload) || payload.statusCode !== 200 || !Array.isArray(payload.data) || payload.data.length > 100) throw new SchemaError('Delhivery');
  if (!payload.data.length && payload.message === 'invalid AWB or very old package') throw new NotFoundError('Delhivery');
  const matches = payload.data.filter(isRecord).filter(item => clean(item.awb, 64) === requested);
  if (matches.length !== 1) throw new SchemaError('Delhivery', 'Delhivery did not return one matching shipment');
  const item = matches[0]!;
  if (!isRecord(item.status) || !Array.isArray(item.trackingStates)) throw new SchemaError('Delhivery');
  const description = clean(item.status.status, 200);
  if (!description) throw new IndeterminateError('Delhivery', 'Delhivery returned no current status');
  const mapped = classifyDelhiveryStatus(description);
  const updated = scanTime(item.status.statusDateTime);
  const currentTimeText = clean(item.status.statusDateTime, 64);
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  // Only completed scans become events. State labels without scans are the
  // website's future progress rail and must never claim movement.
  for (const state of item.trackingStates.slice(0, 100)) {
    if (!isRecord(state)) throw new SchemaError('Delhivery', 'Delhivery returned an incomplete tracking state');
    if (state.scans === undefined) continue;
    if (!Array.isArray(state.scans)) throw new SchemaError('Delhivery', 'Delhivery returned invalid scan history');
    for (const scan of state.scans.slice(0, 100)) {
      if (!isRecord(scan)) throw new SchemaError('Delhivery', 'Delhivery returned an incomplete scan row');
      if (events.length >= 500) continue;
      const label = clean(scan.scan, 200);
      if (!label) throw new SchemaError('Delhivery', 'Delhivery returned a scan with no description');
      const time = scanTime(scan.scanDateTime);
      const timeText = clean(scan.scanDateTime, 64);
      const location = clean(scan.cityLocation, 160);
      const key = `${time?.timestamp ?? timeText}\u0000${label}\u0000${location}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const classified = classifyDelhiveryStatus(label);
      events.push({ description: label, ...(time ? { time: time.iso } : timeText ? { provider_time_text: timeText } : {}), ...(location ? { location } : {}),
        ...(classified ? { stage: classified.stage } : {}) });
    }
  }
  // Repeated scan labels cannot bind a summary timestamp to a particular
  // historical location. Keep the dated status snapshot separate.
  if (!updated || !events.some(event => event.time && Date.parse(event.time) === updated.timestamp
    && event.description?.toUpperCase() === description.toUpperCase())) {
    events.unshift({ description, ...(updated ? { time: updated.iso } : currentTimeText ? { provider_time_text: currentTimeText } : {}),
      ...(mapped ? { stage: mapped.stage } : {}), summary_snapshot: true });
  }
  const dated = events.filter(event => event.time).sort((a, b) => Date.parse(b.time!) - Date.parse(a.time!));
  const undated = events.filter(event => !event.time);
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: description, last_update: updated?.iso ?? null, expected_delivery: null,
    ...(mapped?.status === 'delivered' && updated ? { delivered_at: updated.iso } : {}),
    timezone: 'Asia/Kolkata', events: [...dated, ...undated].slice(0, 100) };
}
