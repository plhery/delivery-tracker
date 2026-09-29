import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { calendarDay } from '../../core/time';
import { clean } from '../../core/transport';
import { classifyCorreosExpressStatus } from './status';

const MONTHS: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
const NO_HISTORY = 'Lo sentimos, no se ha encontrado ningún envío con el número indicado.';

export function normalizeCorreosExpressNumber(raw: string): string {
  const number = raw.replace(/[\s.-]/g, '');
  if (!/^\d{16}$/.test(number)) throw new TypeError('Correos Express requires a 16-digit shipment number');
  return number;
}

function scanClock(raw: string): { local_time?: string; provider_time_text?: string } {
  const text = clean(raw, 64);
  const digits = /^(?:[\p{L}]{3},?\s+)?(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}(?::\d{2})?)$/u.exec(text)?.[1];
  if (digits) {
    // UTC only validates the calendar digits; no instant or offset is emitted.
    const date = DateTime.fromFormat(digits, digits.length === 19 ? 'dd/MM/yyyy HH:mm:ss' : 'dd/MM/yyyy HH:mm', { zone: 'UTC' });
    if (date.isValid) return { local_time: date.toISO({ includeOffset: false, suppressMilliseconds: true })! };
  }
  return text ? { provider_time_text: text } : {};
}

export function parseCorreosExpress(html: string, raw: string): CarrierResult {
  const number = normalizeCorreosExpressNumber(raw);
  const $ = load(html);
  const tables = $('table.miyazaki');
  if (!tables.length) {
    const forms = $('#desktopHomeForm, #mobileHomeForm');
    const inputs = forms.find('input[name="shippingNumber"]').map((_, node) => String($(node).val())).get();
    const errors = forms.find('input[name="errorCode"]').map((_, node) => String($(node).val())).get();
    // All error messages exist in the initial page. Only the selected server
    // code and the matching request echo establish the observed negative.
    if (inputs.length && inputs.some((value) => value !== number)) throw new SchemaError('Correos Express', 'Correos Express returned a different lookup');
    if (inputs.length === forms.length && errors.length === forms.length && forms.length >= 1 && forms.length <= 2
      && errors.every((code) => code === '2')
      && $('.errorMessage2 .errorMessage').toArray().some((node) => clean($(node).text(), 300) === NO_HISTORY)) {
      throw new NotFoundError('Correos Express');
    }
    throw new IndeterminateError('Correos Express', 'Correos Express did not return shipment history');
  }
  const heading = $('h3.status');
  const identities = heading.find('.shipping > span').map((_, node) => clean($(node).text(), 40)).get();
  if (tables.length !== 1 || heading.length !== 1 || heading.find('.shipping').length !== 1 || identities.length !== 1 || identities[0] !== number
    || $('#shippingNumber').length !== 1 || $('#shippingNumber').val() !== number) {
    throw new SchemaError('Correos Express', 'Correos Express returned a different or ambiguous shipment');
  }
  const headers = tables.find('thead th').map((_, node) => clean($(node).text(), 64)).get();
  if (headers.join('|') !== 'Fechas/hora|Población|Estado') throw new SchemaError('Correos Express', 'Correos Express history columns changed');
  const rows = tables.find('tbody tr');
  if (!rows.length) throw new IndeterminateError('Correos Express', 'Correos Express returned an empty history');
  if (rows.length > 500) throw new SchemaError('Correos Express', 'Correos Express returned too many scans');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  // The carrier renders newest first. Preserve its order when a newest clock
  // is unresolved; never promote an older dated delivery over that row.
  for (const row of rows.toArray()) {
    const cells = $(row).children('td');
    if (cells.length !== 3) throw new SchemaError('Correos Express', 'Correos Express returned an incomplete scan');
    const rawStatus = clean(cells.eq(2).text(), 500);
    if (!rawStatus) throw new SchemaError('Correos Express', 'Correos Express returned an empty scan');
    const label = rawStatus.split('.')[0]!.trim();
    // The carrier sometimes leaves the label blank and puts a free-form
    // incident note after the first period. Only known labels are retained.
    const clock = scanClock(cells.eq(0).text());
    const location = clean(cells.eq(1).text(), 200);
    const mapped = classifyCorreosExpressStatus(label);
    const description = mapped ? (mapped.status === 'delivered' ? 'Delivered' : label) : 'Tracking update';
    const key = `${clock.local_time ?? clock.provider_time_text ?? ''}\u0000${rawStatus}\u0000${location}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ description, ...(mapped ? { provider_status: label, stage: mapped.stage } : {}),
      ...clock, ...(location ? { location } : {}) });
  }
  const latest = events[0]!;
  const mapped = classifyCorreosExpressStatus(String(latest.provider_status));
  const estimate = /Entrega prevista:\s*[\p{L}]+,?\s+(\d{1,2})\s+([\p{L}]{3})\s+(\d{4})/iu.exec(heading.text());
  const month = estimate && MONTHS[estimate[2]!.toLowerCase()];
  const day = estimate && month ? calendarDay(Number(estimate[3]), month, Number(estimate[1])) : null;
  const latestDay = typeof latest.local_time === 'string' ? latest.local_time.slice(0, 10) : null;
  const active = mapped && ['pending', 'in_transit', 'out_for_delivery'].includes(mapped.status);
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: null, last_update_local: latest.local_time ?? null,
    expected_delivery: active && day && latestDay && day >= latestDay ? day : null, events: events.slice(0, 100) };
}
