import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { normalizeTrackingNumber } from '../../core/detection';
import { ChallengeError, IndeterminateError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean } from '../../core/transport';
import { estafetaStatus } from './status';

export interface EstafetaLookup {
  number: string;
  guide: string;
  latestDate: string;
  latestClock: string;
  state: string;
}

export function normalizeEstafetaNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^(?:\d{10}|[A-Z0-9]{22})$/.test(number)) throw new TypeError('Estafeta requires a tracking code or full guide');
  return number;
}

function page(html: string) {
  const $ = load(html);
  if (/just a moment|verify.*human|captcha/i.test($('title').text()) || $('.g-recaptcha,.h-captcha,#challenge-form').length) throw new ChallengeError('Estafeta');
  $('script,style,noscript').remove();
  return $;
}

export function parseEstafetaLookup(html: string, rawNumber: string): EstafetaLookup {
  const number = normalizeEstafetaNumber(rawNumber);
  const $ = page(html);
  const cards = $('.shipmentByOne');
  if ($('[data-tracking-code],.clsnTrackingCode,.multiplesWaybillList,.MultipleLink').length || cards.length > 1) {
    throw new IndeterminateError('Estafeta', 'Estafeta requires a specific single-piece guide');
  }
  if (!cards.length && $('.TimeLineErrorRow h4').length === 1
    && clean($('.TimeLineErrorRow h4').text()) === 'Lo sentimos, no se encontró información') {
    // The observed error omits the requested reference and also describes
    // unavailable information; it does not prove parcel absence.
    throw new IndeterminateError('Estafeta', 'Estafeta returned no bound parcel information');
  }
  if (cards.length !== 1 || cards.find('.shipmentInfoDiv').length !== 1 || $('title').text().trim() !== 'Resultado') throw new SchemaError('Estafeta');
  const field = (label: string) => {
    const nodes = cards.find('.shipmentInfoSeparator').filter((_, node) => clean($(node).children('.fontRoman').text()) === label);
    if (nodes.length !== 1 || nodes.children('.fontBold').length !== 1) throw new SchemaError('Estafeta', 'Estafeta returned incomplete parcel identity');
    return clean(nodes.children('.fontBold').text(), 64);
  };
  const guide = field('Número de guía:');
  const code = field('Código de rastreo:');
  if (!/^[A-Z0-9]{22}$/.test(guide) || !/^\d{10}$/.test(code) || (number.length === 10 ? code !== number : guide !== number)) {
    throw new SchemaError('Estafeta', 'Estafeta returned a different parcel');
  }
  const controls = cards.find('.showHistory');
  if (controls.length !== 1 || controls.attr('data-shipment-index') !== guide) throw new SchemaError('Estafeta', 'Estafeta returned a different history target');
  const state = cards.find('.stateDescription.fontColorCurrentProcess');
  const messages = cards.find('.fontColorCurrentProcessMessage');
  const parts = messages.contents().filter((_, node) => node.type === 'text').map((_, node) => clean($(node).text(), 100)).get().filter(Boolean);
  if (state.length !== 1 || messages.length !== 1 || parts.length < 2) throw new SchemaError('Estafeta', 'Estafeta returned incomplete latest activity');
  return { number, guide, state: clean(state.text(), 200), latestClock: parts[0]!, latestDate: parts[1]! };
}

function clockText(raw: string): string { return raw.replace(/\s+hrs\.$/i, '').trim(); }

function clock(day: string, time: string): { local_time?: string; provider_time_text?: string } {
  const rawClock = clockText(time);
  const validated = /^\d{2}\/\d{2}\/\d{4}$/.test(day) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(rawClock)
    ? DateTime.fromFormat(`${day} ${rawClock}`, 'dd/MM/yyyy HH:mm', { zone: 'UTC' }) : null;
  return validated?.isValid ? { local_time: validated.toISO({ includeOffset: false, suppressMilliseconds: true })! }
    : { provider_time_text: clean(`${day} ${time}`, 100) };
}

export function parseEstafetaHistory(html: string, lookup: EstafetaLookup): CarrierResult {
  const $ = page(html);
  const groups = $('.historyEventRow');
  if (!groups.length) throw new IndeterminateError('Estafeta', 'Estafeta returned no parcel history');
  if (groups.length > 500 || $('.eventInfo').length > 500) throw new SchemaError('Estafeta', 'Estafeta returned excessive history');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  let scanCount = 0;
  let firstDate = '';
  let firstClock = '';
  for (const group of groups.toArray()) {
    const root = $(group);
    const bindings = root.find('.remainingHistoryEvents[data-shipmentindex]');
    const dayCell = root.children('.col-xs-2');
    const eventBox = root.children('.col-xs-9');
    if (bindings.length !== 1 || bindings.attr('data-shipmentindex') !== lookup.guide || dayCell.length !== 1 || eventBox.length !== 1
      || root.find('.historyEventRow').length) throw new SchemaError('Estafeta', 'Estafeta returned a different or ambiguous history group');
    const day = clean(dayCell.text(), 64);
    const rows = eventBox.find('.eventInfo');
    if (!rows.length) throw new SchemaError('Estafeta', 'Estafeta returned an empty history group');
    for (const row of rows.toArray()) {
      const cells = $(row).children('div');
      if (cells.length !== 3 || cells.eq(0).is('.col-sm-2') === false || cells.eq(1).is('.col-sm-3') === false || cells.eq(2).is('.col-sm-7') === false) throw new SchemaError('Estafeta');
      const time = clean(cells.eq(0).text(), 64);
      const description = clean(cells.eq(2).text(), 500);
      if (!description) throw new SchemaError('Estafeta', 'Estafeta returned an empty scan');
      if (scanCount++ === 0) { firstDate = day; firstClock = clockText(time); }
      const mapped = estafetaStatus(description);
      const event: CarrierEvent = { ...clock(day, time), description, location: clean(cells.eq(1).text(), 200), ...(mapped ? { stage: mapped.stage } : {}) };
      const key = JSON.stringify(event);
      if (!seen.has(key)) { seen.add(key); events.push(event); }
    }
  }
  if (scanCount !== $('.eventInfo').length) throw new SchemaError('Estafeta', 'Estafeta returned scans outside its parcel groups');
  if (firstDate !== lookup.latestDate || firstClock !== clockText(lookup.latestClock)) throw new IndeterminateError('Estafeta', 'Estafeta latest summary does not match its first scan');
  const latest = events[0]!;
  const current = estafetaStatus(String(latest.description));
  const summary = estafetaStatus(lookup.state);
  if ((current?.stage === 'delivered' || summary?.stage === 'delivered') && current?.stage !== summary?.stage) throw new IndeterminateError('Estafeta', 'Estafeta returned inconsistent delivery evidence');
  return { status: current?.status ?? 'unknown', ...(current ? { current_stage: current.stage } : {}),
    last_status_text: latest.description, last_update: null, last_update_local: latest.local_time ?? null, expected_delivery: null,
    ...(lookup.number !== lookup.guide ? { canonical_tracking_number: lookup.guide } : {}), events: events.slice(0, 100) };
}
