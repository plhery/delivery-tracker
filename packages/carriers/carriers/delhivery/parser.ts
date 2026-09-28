import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { isoTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyDelhiveryStatus } from './status';

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
  const updated = isoTime(item.status.statusDateTime, 'Asia/Kolkata');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  // Only completed scans become events. State labels without scans are the
  // website's future progress rail and must never claim movement.
  for (const state of item.trackingStates.slice(0, 100)) {
    if (!isRecord(state) || !Array.isArray(state.scans)) continue;
    for (const scan of state.scans.slice(0, 100)) {
      if (!isRecord(scan) || events.length >= 500) continue;
      const label = clean(scan.scan, 200);
      if (!label) continue;
      const time = isoTime(scan.scanDateTime, 'Asia/Kolkata');
      const location = clean(scan.cityLocation, 160);
      const key = `${time?.iso ?? ''}\u0000${label}\u0000${location}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const classified = classifyDelhiveryStatus(label);
      events.push({ description: label, ...(time ? { time: time.iso } : {}), ...(location ? { location } : {}),
        ...(classified ? { stage: classified.stage } : {}) });
    }
  }
  // Repeated scan labels cannot bind a summary timestamp to a particular
  // historical location. Keep the dated status snapshot separate.
  if (updated && !events.some(event => event.time === updated.iso && event.description?.toUpperCase() === description.toUpperCase())) {
    events.unshift({ description, time: updated.iso, ...(mapped ? { stage: mapped.stage } : {}), summary_snapshot: true });
  }
  const dated = events.filter(event => event.time).sort((a, b) => Date.parse(b.time!) - Date.parse(a.time!));
  const undated = events.filter(event => !event.time);
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: description, last_update: updated?.iso ?? null, expected_delivery: null,
    ...(mapped?.status === 'delivered' && updated ? { delivered_at: updated.iso } : {}),
    timezone: 'Asia/Kolkata', events: [...dated, ...undated].slice(0, 100) };
}
