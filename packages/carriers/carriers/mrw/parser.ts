import { load } from 'cheerio';
import { IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { calendarDay } from '../../core/time';
import { clean } from '../../core/transport';
import { classifyMrwStatus } from './status';

const ORIGIN = 'https://www.mrw.es';
const SUMMARY_HEADERS = 'Número de albarán|Fecha|Hora|Estado envío|Histórico de envío';
const HISTORY_HEADERS = 'Fecha|Hora|Estado envío|Ubicación';
const NEUTRAL = 'Actualización de seguimiento';

export function normalizeMrwNumber(raw: string): string {
  if (raw.length > 48) throw new TypeError('MRW tracking number is too long');
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (/^(?:\d{12}|\d{5}[A-Z]\d{6})$/.test(number)) return number;
  throw new TypeError('MRW requires a complete 12-character tracking number');
}

export interface MrwSummary {
  number: string;
  status: string;
  date: string;
  hour: string;
  historyUrl: string;
}

export function parseMrwBootstrap(html: string): void {
  const $ = load(html);
  const form = $('form#seguimiento_envios');
  if (form.length !== 1 || form.attr('action') !== 'validar-envio.asp'
    || form.find('input[name="mrw-finder-follow-code"]').length !== 1) {
    throw new SchemaError('MRW', 'Anonymous tracking form changed');
  }
}

export function parseMrwSummary(html: string, raw: string): MrwSummary {
  const number = normalizeMrwNumber(raw);
  const $ = load(html);
  const tables = $('#seguimientoEnvio table.zebra');
  if (!tables.length) {
    // The anonymous portal echoes even synthetic unknown references and does
    // not distinguish them from shipments outside its lookup range.
    throw new IndeterminateError('MRW', 'MRW returned no identifiable shipment');
  }
  if (tables.length !== 1 || tables.find('thead th').map((_, el) => clean($(el).text(), 64)).get().join('|') !== SUMMARY_HEADERS) {
    throw new SchemaError('MRW', 'Summary table changed');
  }
  const rows = tables.find('tbody tr');
  if (rows.length !== 1) throw new IndeterminateError('MRW', 'MRW returned an ambiguous shipment group');
  const cells = rows.first().children('td');
  if (cells.length !== 5 || clean(cells.eq(0).text(), 48) !== number) {
    throw new SchemaError('MRW', 'Summary does not identify the requested shipment');
  }
  const status = clean(cells.eq(3).text(), 200);
  const date = clean(cells.eq(1).text(), 32);
  const hour = clean(cells.eq(2).text(), 16);
  if (!status || status.length > 160) throw new SchemaError('MRW', 'Summary has no bounded status');
  const button = cells.eq(4).find('button[title="Consultar histórico"]');
  const relative = /^javascript:location\.href='([^'\r\n]{1,300})'$/.exec(button.attr('onclick') ?? '')?.[1];
  let url: URL;
  try { url = new URL(relative ?? '', `${ORIGIN}/seguimiento/`); }
  catch { throw new SchemaError('MRW', 'History link is invalid'); }
  if (button.length !== 1 || !relative || url.origin !== ORIGIN || url.pathname !== '/seguimiento/envio-historico.asp'
    || url.searchParams.get('envio') !== number || url.searchParams.get('Inter') !== 'false'
    || [...url.searchParams.keys()].sort().join('|') !== 'Inter|envio') {
    throw new SchemaError('MRW', 'History link does not bind the requested shipment');
  }
  return { number, status, date, hour, historyUrl: url.toString() };
}

function buildLocalDate(rawDate: string, rawHour: string): { local_time?: string; provider_time_text?: string } {
  const date = clean(rawDate, 32);
  const hour = clean(rawHour, 16);
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date);
  const clock = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hour);
  if (match && clock) {
    const day = calendarDay(Number(match[3]), Number(match[2]), Number(match[1]));
    if (day) return { local_time: `${day}T${clock[1]}:${clock[2]}:00` };
  }
  const text = clean(`${date} ${hour}`, 64);
  return text ? { provider_time_text: text } : {};
}

function officeLabel(value: string): string {
  const text = clean(value, 80);
  return /^(?:\d{5}|\d{4}-\d{3})\s+[\p{L} .'-]{2,70}$/u.test(text) ? text : '';
}

function summaryOnly(summary: MrwSummary): CarrierResult {
  const mapped = classifyMrwStatus(summary.status);
  if (!mapped) throw new IndeterminateError('MRW', 'MRW returned only an unrecognized summary');
  return { status: mapped.status, current_stage: mapped.stage, last_status_text: clean(summary.status, 160),
    last_update: null, expected_delivery: null, summary_only: true, events: [] };
}

export function parseMrwHistory(html: string, raw: string, summary: MrwSummary): CarrierResult {
  const number = normalizeMrwNumber(raw);
  if (summary.number !== number) throw new SchemaError('MRW', 'Summary reference changed');
  const $ = load(html);
  const tables = $('#seguimientoEnvio table#grdHistorico');
  if (!tables.length) {
    const text = clean($('#seguimientoEnvio').text(), 200);
    if (/^Histórico de envío nacional ?VOLVER$/.test(text)) return summaryOnly(summary);
    throw new IndeterminateError('MRW', 'MRW returned no usable history page');
  }
  const subtitle = clean($('#seguimientoEnvio h2.page-subtitle').text(), 120);
  if (tables.length !== 1 || subtitle !== `Seguimiento del número de envío ${number}`
    || tables.find('thead th').map((_, el) => clean($(el).text(), 64)).get().join('|') !== HISTORY_HEADERS) {
    throw new SchemaError('MRW', 'History does not identify the requested shipment');
  }
  const rows = tables.find('tbody tr');
  if (!rows.length) throw new IndeterminateError('MRW', 'Shipment history is empty');
  if (rows.length > 500) throw new SchemaError('MRW', 'Shipment history is unexpectedly large');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  // MRW renders the current row first. Do not promote an older dated row when
  // the current scan has an unresolved clock or unrecognized status.
  for (const row of rows.toArray()) {
    const cells = $(row).children('td');
    if (cells.length !== 4) throw new SchemaError('MRW', 'Incomplete history row');
    const date = clean(cells.eq(0).text(), 32);
    const hour = clean(cells.eq(1).text(), 16);
    const rawStatus = clean(cells.eq(2).text(), 500);
    if (!rawStatus || rawStatus.length > 160) throw new SchemaError('MRW', 'History row lacks a bounded status');
    const clock = buildLocalDate(date, hour);
    // Read visible text only. The PointCorner link embeds a full store address
    // and map arguments in onclick; they must never enter the result.
    const location = officeLabel(cells.eq(3).text());
    const key = JSON.stringify([date, hour, rawStatus, location]);
    if (seen.has(key)) continue;
    seen.add(key);
    const mapped = classifyMrwStatus(rawStatus);
    events.push({ description: mapped ? rawStatus : NEUTRAL,
      ...(mapped ? { provider_status: rawStatus, stage: mapped.stage } : {}),
      ...clock, ...(location ? { location } : {}) });
  }
  const latest = events[0]!;
  const firstRawStatus = clean(rows.first().children('td').eq(2).text(), 500);
  const firstDate = clean(rows.first().children('td').eq(0).text(), 32);
  const firstHour = clean(rows.first().children('td').eq(1).text(), 16);
  if (summary.status !== firstRawStatus || summary.date !== firstDate || summary.hour !== firstHour) {
    throw new IndeterminateError('MRW', 'Current summary and history disagree');
  }
  const mapped = classifyMrwStatus(firstRawStatus);
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: null, last_update_local: latest.local_time ?? null,
    expected_delivery: null, events: events.slice(0, 100) };
}
