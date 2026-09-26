import 'server-only';

import { load } from 'cheerio';
import { DateTime } from 'luxon';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { isValidS10TrackingNumber, normalizeTrackingNumber } from '../../core/detection';
import { ChallengeError, InputRequiredError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean, decodeText, fetchBounded } from '../../core/transport';
import { japanPostStatus } from './status';

const PROVIDER = 'Japan Post';
const ENDPOINT = 'https://trackings.post.japanpost.jp/services/srv/search/direct';
const MAX_RESPONSE_BYTES = 1_000_000;
// The history header explicitly states that overseas scans use local time.
// Resolve only these confirmed prefecture/country labels from the row itself;
// never inherit another scan's zone or the parcel's destination.
const EVENT_ZONES: Readonly<Record<string, string>> = {
  OSAKA: 'Asia/Tokyo', KANAGAWA: 'Asia/Tokyo', JAPAN: 'Asia/Tokyo', MALTA: 'Europe/Malta',
};

export function normalizeJapanPostNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  // The official portal accepts domestic 11–13 digit items and international
  // S10 references. U-prefixed customs labels are explicitly not trackable.
  if (!/^\d{11,13}$/.test(number)
    && (!/^[A-TV-Z][A-Z]\d{9}[A-Z]{2}$/.test(number) || !isValidS10TrackingNumber(number))) {
    throw new InputRequiredError(PROVIDER, 'number', 'Japan Post requires a domestic tracking number or a valid tracked postal reference');
  }
  return number;
}

function wallTime(raw: string): string {
  const format = /^\d{2}\/\d{2}\/\d{4}$/.test(raw) ? 'MM/dd/yyyy' : 'MM/dd/yyyy HH:mm';
  // The table explicitly labels overseas scans as local time. Validate the
  // calendar in UTC without assigning that zone to an international event.
  const date = DateTime.fromFormat(raw, format, { zone: 'UTC' });
  if (!date.isValid) throw new SchemaError(PROVIDER, 'Japan Post returned an invalid event date');
  return date.toFormat(format === 'MM/dd/yyyy' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss");
}

function eventInstant(localTime: string, region: string): string | null {
  const zone = EVENT_ZONES[region.toUpperCase()];
  if (!zone || !localTime.includes('T')) return null;
  const date = DateTime.fromISO(localTime, { zone });
  // Luxon can shift a nonexistent spring clock forward or pick one side of
  // an autumn fold. Neither supplies an unambiguous carrier scan instant.
  if (!date.isValid || date.toFormat("yyyy-MM-dd'T'HH:mm:ss") !== localTime
    || date.getPossibleOffsets().length !== 1) return null;
  return date.toUTC().toISO({ suppressMilliseconds: true });
}

export function parse(html: string, trackingNumber: string): CarrierResult {
  const number = normalizeJapanPostNumber(trackingNumber);
  const $ = load(html);
  if (/just a moment|verify.*human|captcha/i.test($('title').text())
    || $('.g-recaptcha, .h-captcha, input[name="captcha"]').length) throw new ChallengeError(PROVIDER);
  $('script, style, noscript').remove();

  const result = $('table[summary="照会結果"]');
  const details = $('table[summary="配達状況詳細"]');
  const history = $('table[summary="履歴情報"]');
  if (details.length !== 1 || history.length !== 1) {
    const rows = result.find('tr').filter((_, row) => $(row).children('td').length > 0);
    const cells = rows.children('td');
    if (!details.length && !history.length && result.length === 1 && rows.length === 1 && cells.length === 2
      && normalizeTrackingNumber(clean(cells.eq(0).text())) === number
      && clean(cells.eq(1).text()) === '** Your item was not found. Confirm your item number and ask at your local office.') {
      throw new NotFoundError(PROVIDER);
    }
    throw new SchemaError(PROVIDER, 'Japan Post returned missing or ambiguous shipment tables');
  }
  if (result.length) throw new SchemaError(PROVIDER, 'Japan Post returned ambiguous shipment tables');

  const headings = details.find('th').map((_, cell) => clean($(cell).text())).get();
  const detailRows = details.find('tr').filter((_, row) => $(row).children('td').length > 0);
  const numberColumn = headings.indexOf('Item number');
  if (numberColumn < 0 || headings.filter((text) => text === 'Item number').length !== 1 || detailRows.length !== 1
    || normalizeTrackingNumber(clean(detailRows.children('td').eq(numberColumn).text())) !== number) {
    throw new SchemaError(PROVIDER, 'Japan Post returned a different or ambiguous shipment');
  }
  const headers = history.find('th').map((_, cell) => clean($(cell).text())).get();
  if (!headers[0]?.startsWith('State occurrence date')
    || headers[1] !== 'Shipping track record' || headers[2] !== 'Details' || headers[3] !== 'Office'
    || !['Prefecture / Country', 'Prefecture'].includes(headers[4])
    || headers[5] !== 'ZIP code（Postal code number）' || headers.length !== 6) {
    throw new SchemaError(PROVIDER, 'Japan Post returned an invalid history table');
  }
  const rows = history.find('tr').filter((_, row) => $(row).children('td').length > 0);
  if (!rows.length || rows.length % 2 !== 0 || rows.length > 1_000) {
    throw new SchemaError(PROVIDER, 'Japan Post returned incomplete tracking history');
  }

  const events: CarrierEvent[] = [];
  for (let index = 0; index < rows.length; index += 2) {
    const cells = rows.eq(index).children('td');
    const postalCode = rows.eq(index + 1).children('td');
    if (cells.length !== 5 || [0, 1, 2, 4].some((column) => cells.eq(column).attr('rowspan') !== '2')
      || cells.eq(3).is('[rowspan]') || cells.filter('[colspan]').length
      || postalCode.length !== 1 || postalCode.is('[rowspan], [colspan]')) {
      throw new SchemaError(PROVIDER, 'Japan Post returned an invalid event row');
    }
    const localTime = wallTime(clean(cells.eq(0).text(), 64));
    const description = clean(cells.eq(1).text(), 500);
    if (!description) throw new SchemaError(PROVIDER, 'Japan Post returned an empty event');
    const region = clean(cells.eq(4).text(), 100);
    const location = [clean(cells.eq(3).text(), 150), region].filter(Boolean).join(', ');
    const time = eventInstant(localTime, region);
    const status = japanPostStatus(description);
    // The host treats `time` as an instant and applies the catalog's timezone
    // when no offset is present. Keep unresolved wall clocks in local_time.
    events.push({ ...(time ? { time } : {}), local_time: localTime, description,
      ...(location ? { location } : {}), ...(status ? { stage: status.stage } : {}) });
  }
  // The carrier presents oldest first. Preserve its sequence when some scans
  // have unresolved zones, rather than mixing UTC and local-clock sorting.
  const seen = new Set<string>();
  const latestFirst = events.reverse().filter((event) => {
    const key = JSON.stringify(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const latest = latestFirst[0]!;
  const status = japanPostStatus(latest.description!);
  return { status: status?.status ?? 'unknown', ...(status ? { current_stage: status.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null, last_update_local: latest.local_time, expected_delivery: null,
    events: latestFirst.slice(0, 100) };
}

export class JapanPostTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeJapanPostNumber(raw);
    const budgetMs = context.budgetMs ?? this.options.timeoutMs ?? 15_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('Japan Post timeout must be positive');
    context.signal?.throwIfAborted();
    const url = `${ENDPOINT}?${new URLSearchParams({ reqCodeNo1: number, locale: 'en' })}`;
    try {
      const { bytes } = await fetchBounded(url, {}, {
        provider: PROVIDER, maxBytes: MAX_RESPONSE_BYTES, timeoutMs: Math.max(1, Math.floor(budgetMs)),
        fetcher: (input, init) => (this.options.fetcher ?? fetch)(input, {
          ...init,
          signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]),
        }),
      });
      context.signal?.throwIfAborted();
      return parse(decodeText(bytes), number);
    } catch (error) {
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
        throw new TransportError(PROVIDER, 'Japan Post tracking endpoint is unavailable', { cause: error });
      }
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new JapanPostTracker({ fetcher: environment.fetcher });
  return { id: 'japan-post', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
