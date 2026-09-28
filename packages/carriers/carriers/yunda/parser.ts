import { normalizeTrackingNumber } from '../../core/detection';
import { ChallengeError, IndeterminateError, InputRequiredError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { zonedTime } from '../../core/time';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { yundaStatus } from './status';

const PROVIDER = 'Yunda Express';
const ZONE = 'Asia/Shanghai';

export function normalizeYundaNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  // The domestic client's documented lengths. It routes 76/77 international
  // identifiers to the international website instead of this consumer feed.
  if (!/^\d{13}(?:\d{2})?$/.test(number) || /^(?:76|77)/.test(number)) {
    throw new InputRequiredError(PROVIDER, 'number', 'Yunda direct tracking requires a domestic waybill number');
  }
  return number;
}

export function yundaEnvelope(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || !Number.isInteger(payload.code)) throw new SchemaError(PROVIDER, 'Yunda returned an invalid response envelope');
  if (payload.code !== 200) {
    const message = clean(payload.msg, 200);
    if (payload.code === 401 || /验证码|验证失败|校验失败|滑块|captcha/i.test(message)) throw new ChallengeError(PROVIDER);
    // Even a body code of 404 can mean a generic API error or empty old history.
    throw new IndeterminateError(PROVIDER, 'Yunda returned an inconclusive API error');
  }
  return payload;
}

function identityMap(value: unknown): Record<string, unknown> {
  // PHP encodes its empty associative maps as [] rather than {}.
  if (Array.isArray(value) && value.length === 0) return {};
  if (!isRecord(value)) throw new SchemaError(PROVIDER, 'Yunda returned an invalid identity map');
  return value;
}

export function parseYunda(payload: unknown, trackingNumber: string): CarrierResult {
  const number = normalizeYundaNumber(trackingNumber);
  const envelope = yundaEnvelope(payload);
  if (!isRecord(envelope.data)) throw new SchemaError(PROVIDER);
  const orders = identityMap(envelope.data.order);
  const histories = identityMap(envelope.data.logistic);
  if ([...Object.keys(orders), ...Object.keys(histories)].some(identity => identity !== number)) {
    throw new SchemaError(PROVIDER, 'Yunda returned a different or ambiguous shipment identity');
  }
  const history = histories[number];
  if (history === undefined) throw new IndeterminateError(PROVIDER, 'Yunda returned no domestic history');
  if (!isRecord(history) || !Array.isArray(history.gn) || !Array.isArray(history.gj) || history.gn.length > 1000) throw new SchemaError(PROVIDER);
  if (!history.gn.length) throw new IndeterminateError(PROVIDER, 'Yunda returned no domestic scans');

  // The official client reverses this oldest-first domestic list for display.
  // Keep its order when a clock is absent or malformed rather than sorting it
  // among dated events or borrowing another event's time.
  const events: CarrierEvent[] = [];
  let returning = false;
  for (const raw of history.gn) {
    if (!isRecord(raw) || normalizeTrackingNumber(clean(raw.mailNo, 64)) !== number) {
      throw new SchemaError(PROVIDER, 'Yunda returned mixed or incomplete scan identities');
    }
    const label = clean(raw.status, 100);
    if (!label) throw new SchemaError(PROVIDER, 'Yunda returned a scan with no status');
    const detail = clean(raw.trackRecord, 1500);
    // An explicit return scan or sender signature establishes the leg.
    // Instructions such as "contact us if you need to return it" do not.
    if (/签收人(?:是|为|[:：])\s*(?:寄件人|发件人|退回)|已(?:退回|返回)(?:寄件人|发件人|寄件网点)|退回件扫描/.test(detail)) returning = true;
    const mapped = yundaStatus(label);
    const stage = returning && mapped?.stage === 'delivered' ? 'returned' : mapped?.stage;
    const description = returning && mapped?.stage === 'delivered' ? 'Returned to the sender'
      : returning && mapped?.stage === 'out_for_delivery' ? 'Out for delivery back to the sender'
        : returning && mapped?.stage === 'ready_for_pickup' ? 'Ready for pickup on its way back'
          : mapped?.wording ?? label;
    const clock = clean(raw.scanTm, 64);
    const time = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(clock)
      ? zonedTime(clock, 'yyyy-MM-dd HH:mm:ss', ZONE)?.iso : null;
    // The bracketed city is a separate coarse location. The remaining prose
    // includes courier phones, names and pickup/recipient addresses.
    const location = /^【([\p{Script=Han}]{1,30}(?:市|县|区))】/u.exec(detail)?.[1];
    events.push({ description, provider_code: label,
      ...(time ? { time } : clock ? { provider_time_text: clock } : {}),
      ...(location ? { location } : {}), ...(stage ? { stage } : {}),
      ...(returning ? { provider_leg: 'return' } : {}) });
  }
  const seen = new Set<string>();
  const unique = events.reverse().filter(event => {
    const key = JSON.stringify(event);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const latest = unique[0]!;
  const mapped = yundaStatus(latest.provider_code!);
  const returned = latest.stage === 'returned';
  return { status: returned ? 'exception' : mapped?.status ?? 'unknown',
    ...(latest.stage ? { current_stage: latest.stage } : {}),
    timezone: ZONE, last_status_text: latest.description, last_update: latest.time ?? null,
    ...(mapped?.stage === 'delivered' && !returned && latest.time ? { delivered_at: latest.time } : {}),
    events: unique.slice(0, 100) };
}
