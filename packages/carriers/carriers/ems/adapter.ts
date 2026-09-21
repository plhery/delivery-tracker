import 'server-only';

import { load } from 'cheerio';
import { DateTime } from 'luxon';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { isValidS10TrackingNumber, normalizeTrackingNumber } from '../../core/detection';
import { ChallengeError, InputRequiredError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean, decodeText, fetchBounded } from '../../core/transport';
import { emsStatus } from './status';

const ENDPOINT = 'https://items.ems.post/api/publicTracking/track';
const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
// A fresh request with this ordinary browser header works without session state.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

export function normalizeEmsTrackingNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^E[A-Z]\d{9}[A-Z]{2}$/.test(number) || !isValidS10TrackingNumber(number)) {
    throw new InputRequiredError('EMS', 'number', 'EMS requires a valid E-prefixed postal tracking number');
  }
  return number;
}

function wallTime(raw: string): string {
  // UTC is used only to validate calendar fields. The portal supplies no zone;
  // never emit a fabricated offset or reorder cross-border scans by wall time.
  const parsed = DateTime.fromFormat(raw, 'LLL d, yyyy, h:mm a', { locale: 'en-US', zone: 'UTC' });
  if (!parsed.isValid) throw new SchemaError('EMS', 'EMS returned an invalid event date');
  return parsed.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

/** Project only the requested result table; form inputs and other items prove nothing. */
export function parse(html: string, trackingNumber: string): CarrierResult {
  const number = normalizeEmsTrackingNumber(trackingNumber);
  const $ = load(html);
  if (/just a moment|verify.*human|captcha/i.test($('title').text())
    || $('.g-recaptcha, .h-captcha, input[name="captcha"]').length) throw new ChallengeError('EMS');
  $('script, style, noscript').remove();
  const result = $('.result-table').filter((_, element) => $(element).attr('id') === `table-${number}`);
  if (result.length !== 1) throw new SchemaError('EMS', 'EMS returned a different or ambiguous shipment');
  if (result.find('.error').length) {
    if (/does not denote an EMS item\./.test(result.find('.error').text())) {
      throw new InputRequiredError('EMS', 'number', 'EMS does not support this postal service');
    }
    throw new SchemaError('EMS', 'EMS could not complete the tracking query');
  }
  const table = result.children('table');
  const headers = table.find('thead th').map((_, cell) => clean($(cell).text())).get();
  if (table.length !== 1 || headers.join('|') !== 'Date and time|Status of Item|Location') {
    throw new SchemaError('EMS', 'EMS returned an invalid tracking table');
  }
  const rows = table.find('tbody > tr');
  const noResults = rows.find('td.no-results-found');
  if (rows.length === 1 && rows.children('td').length === 1 && noResults.length === 1
    && clean(noResults.text()) === 'There were no results found.') throw new NotFoundError('EMS');
  if (rows.length === 0 || rows.length > 500 || noResults.length) throw new SchemaError('EMS', 'EMS returned incomplete tracking history');

  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  // EMS presents oldest first. Reversal preserves its sequence for equal times
  // and for international legs whose local clocks cannot be compared safely.
  for (const row of rows.toArray().reverse()) {
    const cells = $(row).children('td');
    if (cells.length !== 3 || cells.filter('[colspan]').length) throw new SchemaError('EMS');
    const description = clean(cells.eq(1).text(), 500);
    if (!description) throw new SchemaError('EMS', 'EMS returned an empty event');
    const time = wallTime(clean(cells.eq(0).text(), 64));
    const location = clean(cells.eq(2).text(), 200);
    const key = JSON.stringify([time, description, location]);
    if (seen.has(key)) continue;
    seen.add(key);
    const status = emsStatus(description);
    events.push({ time, description, location, ...(status ? { stage: status.stage } : {}) });
  }
  const latest = events[0]!;
  const status = emsStatus(latest.description!);
  return {
    status: status?.status ?? 'unknown',
    ...(status ? { current_stage: status.stage } : {}),
    last_status_text: latest.description,
    last_update: latest.time,
    expected_delivery: null,
    events: events.slice(0, 100),
  };
}

export class EmsTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeEmsTrackingNumber(raw);
    const budgetMs = context.budgetMs ?? this.options.timeoutMs ?? TIMEOUT_MS;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('EMS timeout must be positive');
    context.signal?.throwIfAborted();
    const url = `${ENDPOINT}?${new URLSearchParams({ language: 'EN', itemId: number })}`;
    try {
      const { bytes } = await fetchBounded(url, { headers: { 'User-Agent': USER_AGENT } }, {
        provider: 'EMS', maxBytes: MAX_RESPONSE_BYTES, timeoutMs: Math.max(1, Math.floor(budgetMs)),
        fetcher: (input, init) => (this.options.fetcher ?? fetch)(input, {
          ...init,
          signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]),
        }),
      });
      context.signal?.throwIfAborted();
      return parse(decodeText(bytes), number);
    } catch (error) {
      // Unknown items use HTTP 200 + a specific table row. A missing endpoint
      // must not make routing conclude that the parcel does not exist.
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
        throw new TransportError('EMS', 'EMS tracking endpoint is unavailable', { cause: error });
      }
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new EmsTracker({ fetcher: environment.fetcher });
  return { id: 'ems', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
