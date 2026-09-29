import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { normalizeTrackingNumber } from '../../core/detection';
import { ChallengeError, IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean } from '../../core/transport';
import { landmarkStatus } from './status';

const ABSENT = "We couldn't find a match for this value. Please try a different value.";

export function normalizeLandmarkNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^LTN\d{8,9}(?:N1)?$/.test(number)) throw new TypeError('Landmark requires an LTN parcel reference');
  return number;
}

function clock(raw: string): Pick<CarrierEvent, 'time'> & { local_time?: string; provider_time_text?: string } {
  const validated = /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(raw)
    ? DateTime.fromFormat(raw, 'yyyy-MM-dd HH:mm:ss', { zone: 'UTC' }) : null;
  if (!validated?.isValid) return raw ? { provider_time_text: raw } : {};
  return { local_time: validated.toISO({ includeOffset: false, suppressMilliseconds: true })! };
}

export function parseLandmark(html: string, rawNumber: string): CarrierResult {
  const number = normalizeLandmarkNumber(rawNumber);
  const canonical = number.replace(/N1$/, '');
  const $ = load(html);
  if (/just a moment|verify.*human|captcha/i.test($('title').text()) || $('.g-recaptcha,.h-captcha').length) throw new ChallengeError('Landmark Global');
  $('script,style,noscript').remove();
  const identities = $('.delivery-details-col h6').filter((_, node) => clean($(node).text()) === 'Landmark Tracking Number');
  const tables = $('.event-summary .event-table table');
  const errors = $('.error-text').map((_, node) => clean($(node).text())).get().filter(Boolean);
  if (!identities.length && !tables.length && $('#search').length === 1 && $('#search').val() === number
    && errors.length && errors.every(error => error === ABSENT) && $('title').text().trim() === 'Landmark Global | Landmark Tracking') throw new NotFoundError('Landmark Global');
  if (identities.length !== 1 || clean(identities.next('div').text()) !== canonical) throw new SchemaError('Landmark Global', 'Landmark returned a different or ambiguous parcel');
  if (tables.length !== 1 || tables.find('thead th').map((_, node) => clean($(node).text())).get().join('|') !== 'Description|Date/Time|Location') throw new SchemaError('Landmark Global');
  const rows = tables.find('tbody > tr');
  if (!rows.length) throw new IndeterminateError('Landmark Global', 'Landmark returned no parcel history');
  if (rows.length > 500) throw new SchemaError('Landmark Global', 'Landmark returned excessive parcel history');
  const firstCells = rows.first().children('td');
  const summary = $('.current-status');
  if (summary.length !== 1 || clean(summary.find('h3').text()) !== clean(firstCells.eq(0).text())
    || summary.find('.time').attr('data-time') !== firstCells.eq(1).attr('data-time')) throw new IndeterminateError('Landmark Global', 'Landmark latest summary does not match its first scan');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const row of rows.toArray()) {
    const cells = $(row).children('td');
    if (cells.length !== 3 || cells.filter('[colspan]').length) throw new SchemaError('Landmark Global');
    const wording = clean(cells.eq(0).text(), 500);
    if (!wording) throw new SchemaError('Landmark Global', 'Landmark returned an empty scan');
    const mapped = landmarkStatus(wording);
    const event: CarrierEvent = { ...clock(clean(cells.eq(1).attr('data-time') ?? cells.eq(1).text(), 64)),
      description: mapped?.stage === 'delivered' ? 'Delivered' : wording, location: clean(cells.eq(2).text(), 200),
      ...(mapped ? { stage: mapped.stage } : {}) };
    const key = JSON.stringify(event);
    if (!seen.has(key)) { seen.add(key); events.push(event); }
  }
  const latest = events[0]!;
  const current = landmarkStatus(clean(firstCells.eq(0).text(), 500));
  const partner = $('.delivery-details-col h6').filter((_, node) => clean($(node).text()) === 'Delivery Partner').next('div');
  const inputs = partner.find('input[name="id"]');
  const partnerNumber = partner.length === 1 && inputs.length === 1 ? clean(inputs.val(), 64).toUpperCase() : '';
  const partnerName = clean(partner.clone().find('form').remove().end().text(), 100);
  return { status: current?.status ?? 'unknown', ...(current ? { current_stage: current.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, last_update_local: latest.local_time ?? null, expected_delivery: null,
    ...(number !== canonical ? { canonical_tracking_number: canonical } : {}),
    ...(/^[A-Z0-9]{4,40}$/.test(partnerNumber) ? { delivery_tracking_number: partnerNumber,
      ...(partnerName === 'Australia Post' ? { delivery_carrier: 'australia-post' } : {}) } : {}), events: events.slice(0, 100) };
}
