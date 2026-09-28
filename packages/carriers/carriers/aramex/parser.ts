import { load } from 'cheerio';
import { DateTime } from 'luxon';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean } from '../../core/transport';
import { classifyAramexStatus } from './status';

export function normalizeAramexNumber(raw: string): string {
  const number = raw.replace(/[\s.-]/g, '');
  if (!/^\d{11,12}$/.test(number)) throw new TypeError('Aramex requires an eleven- or twelve-digit shipment number');
  return number;
}

export function aramexDetailUrl(html: string, number: string): string {
  const requested = normalizeAramexNumber(number);
  const $ = load(html);
  const matches = $('a.shipment-card').filter((_, card) => clean($(card).find('.shipment-num h5').text(), 64) === requested);
  if (!matches.length) {
    if ($('.track-shipment-list h5').toArray().some(e => clean($(e).text(), 300) === 'No results found with current selection, please enter a different tracking number.')) {
      throw new NotFoundError('Aramex');
    }
    throw new SchemaError('Aramex', 'Aramex did not return the requested shipment card');
  }
  if (matches.length !== 1) throw new SchemaError('Aramex', 'Aramex returned ambiguous shipment cards');
  const url = new URL(matches.attr('href') ?? '', 'https://www.aramex.com');
  if (url.origin !== 'https://www.aramex.com' || url.pathname !== '/track/details' || !url.searchParams.get('q') || url.username || url.password || url.hash) {
    throw new SchemaError('Aramex', 'Aramex returned an invalid detail link');
  }
  return url.href;
}

export function aramexDetailRedirect(location: string, original: string): string {
  const bound = new URL(original);
  const url = new URL(location, bound);
  if (url.origin !== bound.origin || !/^\/[a-z]{2}\/en\/track\/details$/.test(url.pathname)
    || url.search !== bound.search || url.username || url.password || url.hash) {
    throw new SchemaError('Aramex', 'Aramex returned an invalid detail redirect');
  }
  return url.href;
}

export function parseAramex(html: string, number: string): CarrierResult {
  const requested = normalizeAramexNumber(number);
  const $ = load(html);
  const identifiers = $('.shipment-info .shipment-num h5');
  if (identifiers.length !== 1 || clean(identifiers.text(), 64) !== requested) throw new SchemaError('Aramex', 'Aramex returned a different shipment detail');
  const tables = $('table.collected');
  if (tables.length !== 1 || !tables.find('th.col-activity').length) throw new SchemaError('Aramex');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  tables.find('tr').slice(0, 500).each((_, row) => {
    const description = clean($(row).find('td.activity').text(), 500);
    if (!description) return;
    const day = clean($(row).find('.date-time .date').text(), 32);
    const clock = clean($(row).find('.date-time .time').text(), 16);
    // Parsing in UTC validates the calendar digits only. The resulting wall
    // time carries no offset because this cross-border portal does not give one.
    const parsed = DateTime.fromFormat(`${day} ${clock}`, 'dd MMM yy HH:mm', { locale: 'en', zone: 'UTC' });
    const local = parsed.isValid ? parsed.toISO({ includeOffset: false, suppressMilliseconds: true }) : null;
    const location = [clean($(row).find('.addr .city').text(), 120), clean($(row).find('.addr .country').text(), 80)].filter(Boolean).join(', ');
    const key = `${local ?? ''}\u0000${description}\u0000${location}`;
    if (seen.has(key)) return;
    seen.add(key);
    const mapped = classifyAramexStatus(description);
    events.push({ description, ...(location ? { location } : {}), ...(local ? { local_time: local } : {}), ...(mapped ? { stage: mapped.stage } : {}) });
  });
  if (!events.length) throw new IndeterminateError('Aramex', 'Aramex returned no shipment history');
  const latest = events[0]!;
  const mapped = classifyAramexStatus(latest.description ?? '');
  return { status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: latest.description, last_update: null, last_update_local: latest.local_time ?? null,
    expected_delivery: null, events: events.slice(0, 100) };
}
