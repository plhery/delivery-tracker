import { normalizeTrackingNumber } from '../../core/detection';
import { IndeterminateError, InputRequiredError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { zonedTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { ytoScan, ytoStatus } from './status';

const PROVIDER = 'YTO Express';
// The domestic client's /ec/apollo/checkWaybillNo rules. Keep them local so a
// lookup does not require a separate configuration request.
const NUMBER = /^(?:[68]\d{17}|(?:DD|G8|99|70|71|78|79)\d{16}|M\d{14}|YT\d{13}|YT[DG]\d{12}|(?:DD|DB|JY)\d{10}|[25678GVMBCDFHZ]\d{11}|DD\d{8}|YT[HZ]\d{12}|GD6\d{9})$/;
const ZONE = 'Asia/Shanghai';

export function normalizeYtoNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!NUMBER.test(number)) throw new InputRequiredError(PROVIDER, 'number', 'YTO requires a domestic waybill number');
  return number;
}

export function parseYto(payload: unknown, trackingNumber: string): CarrierResult {
  const number = normalizeYtoNumber(trackingNumber);
  if (!Array.isArray(payload)) throw new SchemaError(PROVIDER, 'YTO returned an invalid shipment list');
  if (!payload.length) throw new IndeterminateError(PROVIDER, 'YTO returned no shipment details');
  if (payload.length !== 1 || !isRecord(payload[0]) || normalizeTrackingNumber(clean(payload[0].waybillNo, 64)) !== number) {
    throw new SchemaError(PROVIDER, 'YTO returned missing or ambiguous shipment identity');
  }
  const item = payload[0];
  // The feed can echo any well-shaped number without returning a history.
  // This also happens for archived waybills; it proves no parcel absence.
  if (item.waybillProcessInfo === undefined) throw new IndeterminateError(PROVIDER, 'YTO returned no shipment history');
  if (!Array.isArray(item.waybillProcessInfo) || item.waybillProcessInfo.length > 1000) throw new SchemaError(PROVIDER);
  if (!item.waybillProcessInfo.length) throw new IndeterminateError(PROVIDER, 'YTO returned no shipment history');

  const events: CarrierEvent[] = [];
  let returning = false;
  // The official client uses the first row as current. Read oldest first to
  // preserve a return leg when later scans use ordinary movement/signature codes.
  for (const raw of [...item.waybillProcessInfo].reverse()) {
    if (!isRecord(raw) || normalizeTrackingNumber(clean(raw.waybillNo, 64)) !== number) {
      throw new SchemaError(PROVIDER, 'YTO returned mixed or incomplete shipment history');
    }
    const code = clean(raw.opCode, 32);
    const label = clean(raw.opName, 200);
    if (!code || !label) throw new SchemaError(PROVIDER, 'YTO returned a scan with no operation');
    const details = clean(raw.description, 1000);
    const returnType = clean(raw.ioTypeName, 32);
    if (code === '835' || /^退回(?:[一二三四五六七八九十\d]+次)?$/.test(returnType)
      || /(?:收件人|签收人)\s*[:：]\s*退回(?:[，。,]|$)/.test(details)) returning = true;
    const ext = isRecord(raw.extTrack) ? raw.extTrack : {};
    const mapped = ytoStatus(code, ext.signType);
    const stage = returning && mapped?.stage === 'delivered' ? 'returned' : mapped?.stage;
    const wording = ytoScan(label)?.wording ?? label;
    const description = returning && mapped?.stage === 'delivered' ? 'Returned to the sender'
      : returning && mapped?.stage === 'out_for_delivery' ? 'Out for delivery back to the sender'
        : returning && mapped?.stage === 'ready_for_pickup' ? 'In a parcel locker or station on its way back' : wording;
    const clock = clean(raw.opTime, 64);
    const parsed = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(clock)
      ? zonedTime(clock, 'yyyy-MM-dd HH:mm:ss', ZONE) : null;
    const location = clean(raw.opOrgName, 200);
    // opName is the short operation label. The website's expanded description
    // includes courier names/phones, collection addresses and recipient details.
    const event: CarrierEvent = { description, provider_code: code,
      ...(parsed ? { time: parsed.iso } : clock ? { provider_time_text: clock } : {}),
      ...(location ? { location } : {}), ...(stage ? { stage } : {}),
      ...(returning ? { provider_leg: 'return' } : {}) };
    events.push(event);
  }
  events.reverse();
  // Remove repeated rows from newest first so an old duplicate cannot move
  // the current scan behind a different status, especially with unresolved clocks.
  const seen = new Set<string>();
  const unique = events.filter(event => {
    const key = JSON.stringify(event);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const latest = unique[0]!;
  const rawLatest = item.waybillProcessInfo[0] as Record<string, unknown>;
  const mapped = ytoStatus(latest.provider_code!, isRecord(rawLatest.extTrack) ? rawLatest.extTrack.signType : undefined);
  const returned = latest.stage === 'returned';
  return { status: returned ? 'exception' : mapped?.status ?? 'unknown',
    ...(latest.stage ? { current_stage: latest.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, timezone: ZONE,
    ...(mapped?.stage === 'delivered' && !returned && latest.time ? { delivered_at: latest.time } : {}),
    events: unique.slice(0, 100) };
}
