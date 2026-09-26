import 'server-only';

import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { ChallengeError, IndeterminateError, InputRequiredError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { sfExpressEventStatus, sfExpressSummaryStatus } from './status';

const PROVIDER = 'SF Express';

export function normalizeSfExpressNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^(?:SF\d{13}|\d{12})$/.test(number)) {
    throw new InputRequiredError(PROVIDER, 'number', 'SF Express requires a 12-digit number or SF followed by 13 digits');
  }
  return number;
}

function scanTime(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    throw new SchemaError(PROVIDER, 'SF Express returned an invalid scan date');
  }
  // This API supplies wall clocks without offsets. UTC here only validates
  // calendar components; the returned local_time deliberately claims no zone.
  const parsed = DateTime.fromFormat(raw, 'yyyy-MM-dd HH:mm:ss', { zone: 'UTC' });
  if (!parsed.isValid) throw new SchemaError(PROVIDER, 'SF Express returned an invalid scan date');
  return parsed.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

function remarkText(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > 10_000) throw new SchemaError(PROVIDER, 'SF Express returned an invalid scan remark');
  const $ = load(raw, null, false);
  $('script, style, iframe, img, input, button, [id="opr_phone"], .route-phone, a[href^="tel:"]').remove();
  return clean($.root().text(), 1_000);
}

/** Parse the anonymous Taiwan routes endpoint, never a logged-in waybill detail. */
export function parse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = normalizeSfExpressNumber(trackingNumber);
  if (!isRecord(payload)) throw new SchemaError(PROVIDER);
  if ((payload.code === 1 && typeof payload.detailMessage === 'string' && /captcha\s+verification failure/i.test(payload.detailMessage))
    || payload.code === 70000) throw new ChallengeError(PROVIDER);
  if (payload.code === 60000) throw new ChallengeError(PROVIDER, 'SF Express restricted the tracking query');
  if (payload.code === 500) throw new IndeterminateError(PROVIDER);
  if (payload.success !== true || payload.code !== 0 || !Array.isArray(payload.result)
    || payload.result.length > 20 || payload.result.some((entry) => !isRecord(entry))) throw new SchemaError(PROVIDER);
  const results = payload.result.filter(isRecord).filter((entry) => entry.id === number);
  if (results.length !== 1) throw new SchemaError(PROVIDER, 'SF Express returned a different or ambiguous shipment');
  const shipment = results[0];
  if (!Array.isArray(shipment.routes) || !shipment.routes.length || shipment.routes.length > 500) {
    throw new SchemaError(PROVIDER, 'SF Express returned incomplete tracking history');
  }
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const raw of shipment.routes) {
    if (!isRecord(raw)) throw new SchemaError(PROVIDER, 'SF Express returned an invalid scan');
    const text = remarkText(raw.remark);
    // The portal removes these access links from history. They are not scans,
    // and the mere existence of a proof link does not establish delivery.
    if (/(?:AWB Info & POD|运单资料&签收图|運單資料&簽收圖)/.test(text)) continue;
    if (!text) throw new SchemaError(PROVIDER, 'SF Express returned an empty scan');
    const localTime = scanTime(raw.scanDateTime);
    const code = clean(raw.opCode, 64);
    const reason = clean(raw.stayWhyCode, 64);
    if (!/^[A-Z0-9_-]{1,64}$/.test(code)) throw new SchemaError(PROVIDER, 'SF Express returned an invalid operation code');
    const status = sfExpressEventStatus(code, reason);
    const event: CarrierEvent = { local_time: localTime, provider_code: code,
      description: status?.status === 'delivered' ? 'Delivered' : text,
      ...(status ? { stage: status.stage } : {}),
    };
    const key = JSON.stringify([localTime, event.description, code, reason]);
    if (!seen.has(key)) { events.push(event); seen.add(key); }
  }
  if (!events.length) throw new SchemaError(PROVIDER, 'SF Express returned no historical scans');
  // The official frontend orders by these same wall-clock strings. Preserve
  // that display order without claiming absolute instants across countries.
  events.sort((a, b) => String(b.local_time).localeCompare(String(a.local_time)));
  const latest = events[0]!;
  const latestRaw = shipment.routes.filter(isRecord).find((raw) => raw.scanDateTime === String(latest.local_time).replace('T', ' ')
    && clean(raw.opCode, 64) === latest.provider_code);
  const state = clean(shipment.expressState, 64);
  const summaryStatus = sfExpressSummaryStatus(state, shipment.signed === true);
  const latestStatus = sfExpressEventStatus(String(latest.provider_code), clean(latestRaw?.stayWhyCode, 64));
  // State 99 is broad transit: a mapped delivery-round scan is more precise.
  const status = state === '99' ? latestStatus ?? summaryStatus : summaryStatus ?? latestStatus;
  const summaryText = new Map([['2', 'Cancelled'], ['3', 'Forwarded'], ['4', 'Returned to sender'], ['5', 'Held'], ['6', 'Lost']]).get(state);
  return { status: status?.status ?? 'unknown', ...(status ? { current_stage: status.stage } : {}),
    last_status_text: status?.status === 'delivered' ? 'Delivered' : summaryText ?? latest.description,
    last_update: null, last_update_local: latest.local_time, expected_delivery: null,
    events: events.slice(0, 100),
  };
}
