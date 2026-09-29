import { load } from 'cheerio';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { calendarDay } from '../../core/time';
import { clean } from '../../core/transport';
import { classifyBrtStatus } from './status';

export function normalizeBrtNumber(raw: string): string {
  const number = raw.replace(/\s/g, '');
  if (!/^\d{14}$/.test(number)) throw new TypeError('BRT requires a fourteen-digit BRTcode');
  return number;
}

function scanClock(date: string, clock: string): { local_time?: string; provider_time_text?: string } {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(date);
  const day = match && calendarDay(Number(match[3]), Number(match[2]), Number(match[1]));
  const time = /^(\d{2})\.(\d{2})$/.exec(clock);
  if (day && time && Number(time[1]) < 24 && Number(time[2]) < 60) {
    return { local_time: `${day}T${time[1]}:${time[2]}:00` };
  }
  const raw = clean(`${date} ${clock}`, 64);
  return raw ? { provider_time_text: raw } : {};
}

export function parseBrt(html: string, raw: string): CarrierResult {
  const number = normalizeBrtNumber(raw);
  const $ = load(html);
  const metadata = $('table.table_dati_spedizione');
  const history = $('table.table_stato_dati');
  if (!metadata.length && !history.length) {
    const scope = $('#box_tool_content');
    const heading = scope.children('h3.separatore');
    const errors = scope.children('#box_contenuti').clone();
    errors.find('script, style').remove();
    if (scope.length === 1 && errors.length === 1 && heading.length === 1 && clean(heading.text(), 80) === 'Errori riscontrati'
      && clean(errors.text(), 300) === `TIS0868 Parcel Label number ${number} not found`) {
      throw new NotFoundError('BRT');
    }
    throw new IndeterminateError('BRT', 'BRT did not return shipment history');
  }
  if (metadata.length !== 1 || history.length > 1) throw new SchemaError('BRT', 'BRT returned ambiguous shipment details');
  const identityRows = metadata.find('tr').filter((_, node) => clean($(node).children('td').first().text(), 40) === 'BRTcode');
  const identity = identityRows.children('td');
  if (identityRows.length !== 1 || identity.length !== 2 || clean(identity.last().text(), 40) !== number) {
    throw new SchemaError('BRT', 'BRT returned a different or incomplete shipment');
  }
  if (!history.length) throw new IndeterminateError('BRT', 'BRT returned no tracking scans');
  const rows = history.find('tr');
  if (rows.length > 501) throw new SchemaError('BRT', 'BRT returned too many tracking scans');
  const header = rows.first().children('td, th').map((_, node) => clean($(node).text(), 40)).get();
  if (header.join('|') !== 'Data|Ora|Filiale|Evento') throw new SchemaError('BRT', 'BRT tracking columns changed');
  const events: CarrierEvent[] = [];
  for (const row of rows.slice(1).toArray()) {
    const cells = $(row).children('td');
    if (cells.length !== 4) throw new SchemaError('BRT', 'BRT returned an incomplete scan');
    const date = clean(cells.eq(0).text(), 40);
    const clock = clean(cells.eq(1).text(), 24);
    const location = clean(cells.eq(2).text(), 120);
    const label = clean(cells.eq(3).text(), 160);
    if (!label || !/^[\p{L}][\p{L}\p{N}\s().,'/-]{1,159}$/u.test(label)) throw new SchemaError('BRT', 'BRT returned an invalid scan label');
    const mapped = classifyBrtStatus(label);
    events.push({ description: mapped?.status === 'delivered' ? 'Delivered' : label, provider_status: label,
      ...(mapped ? { stage: mapped.stage } : {}), ...(location ? { location } : {}), ...scanClock(date, clock) });
  }
  if (!events.length) throw new IndeterminateError('BRT', 'BRT returned empty tracking history');
  // BRT includes cross-border depots without identifying each scan's zone.
  // Source order also carries undated scans, so local clocks are never sorted.
  const latest = events[0]!;
  const mapped = classifyBrtStatus(String(latest.provider_status));
  const goodsRows = metadata.find('tr').filter((_, node) => clean($(node).children('td').first().text(), 40) === 'Natura merce');
  const weightText = goodsRows.length === 1 ? clean(goodsRows.children('td').last().text(), 300) : '';
  const weightLabels = weightText.match(/\bPeso \(kg\):/g) ?? [];
  const weightMatch = /\bPeso \(kg\):\s*(\d+(?:[,.]\d{1,4})?)(?=\s+Volume\b|$)/.exec(weightText);
  const weight = weightLabels.length === 1 && weightMatch ? Number(weightMatch[1]!.replace(',', '.')) : NaN;
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: null,
    ...(latest.local_time ? { last_update_local: latest.local_time } : {}),
    ...(Number.isFinite(weight) && weight > 0 && weight <= 100_000 ? { weight_kg: weight } : {}),
    events: events.slice(0, 100) };
}
