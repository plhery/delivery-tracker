import 'server-only';

import { load } from 'cheerio';
import { DateTime } from 'luxon';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { IndeterminateError, InputRequiredError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { clean, decodeText, fetchBounded } from '../../core/transport';
import { koreaPostStatus } from './status';

const ENDPOINT = 'https://trace.epost.go.kr/xtts/servlet/kpl.tts.common.svl.SttSVL';

export function normalizeKoreaPostNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(number)) throw new InputRequiredError('Korea Post', 'number', 'Korea Post direct tracking supports international postal identifiers');
  return number;
}

function eventTime(raw: string): string {
  const parsed = DateTime.fromFormat(raw, 'HH:mm dd-LLL-yyyy', { zone: 'UTC', locale: 'en-US' });
  if (!parsed.isValid) throw new SchemaError('Korea Post', 'Korea Post returned an invalid scan time');
  // The portal explicitly uses destination-local time after handover. Preserve
  // its sequence and wall clocks; a Korea-wide timezone would corrupt these.
  return parsed.toISO({ suppressMilliseconds: true, includeOffset: false })!;
}

export function parse(html: string, trackingNumber: string): CarrierResult {
  const number = normalizeKoreaPostNumber(trackingNumber);
  const $ = load(html);
  $('script, style, noscript').remove();
  $('br').replaceWith(' ');
  const basic = $('table').filter((_, element) => $(element).attr('summary') === 'Basic Information');
  const basicRows = basic.find('tbody > tr');
  if (basic.length !== 1 || basicRows.length !== 1 || clean(basicRows.children('td').first().text()) !== number) throw new SchemaError('Korea Post', 'Korea Post returned a different or ambiguous shipment');
  const history = $('table').filter((_, element) => clean($(element).find('thead th').map((__, cell) => clean($(cell).text())).get().join('|')) === 'Date|Status|Post office/Airport|Details');
  if (history.length !== 1) throw new SchemaError('Korea Post', 'Korea Post returned an invalid tracking table');
  const rows = history.find('tbody > tr');
  if (rows.length === 1 && rows.children('td').length === 1 && rows.children('td').attr('colspan') === '4'
    && clean(rows.text()) === `Your item number ${number} is not found. Confirm your item number.`) throw new NotFoundError('Korea Post');
  if (!rows.length) throw new IndeterminateError('Korea Post', 'Korea Post returned no parcel scans');
  if (rows.length > 500) throw new SchemaError('Korea Post');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const row of rows.toArray().reverse()) {
    const cells = $(row).children('td');
    if (cells.length !== 4 || cells.filter('[colspan]').length) throw new SchemaError('Korea Post');
    const time = eventTime(clean(cells.eq(0).text(), 64));
    const description = clean(cells.eq(1).text(), 500);
    if (!description) throw new SchemaError('Korea Post', 'Korea Post returned an empty scan');
    const location = clean(cells.eq(2).text(), 200);
    const key = JSON.stringify([time, description, location]);
    if (seen.has(key)) continue;
    seen.add(key);
    const classified = koreaPostStatus(description);
    // The fourth cell mixes routing notes with recipient names and results;
    // project only the dedicated timestamp, status and facility columns.
    events.push({ local_time: time, description, location, ...(classified ? { stage: classified.stage } : {}) });
  }
  const latest = events[0]!;
  const classified = koreaPostStatus(latest.description!);
  return { status: classified?.status ?? 'unknown', ...(classified ? { current_stage: classified.stage } : {}),
    last_status_text: latest.description, last_update: null, events: events.slice(0, 100) };
}

export class KoreaPostTracker {
  constructor(private readonly options: { fetcher?: typeof fetch } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeKoreaPostNumber(raw);
    const budgetMs = context.budgetMs ?? 15_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('Korea Post timeout must be positive');
    context.signal?.throwIfAborted();
    try {
      const { bytes } = await fetchBounded(ENDPOINT, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html,*/*;q=0.8' },
        body: new URLSearchParams({ target_command: 'kpl.tts.tt.epost.cmd.RetrieveEmsTraceEngCmd',
          JspURI: '/xtts/tt/epost/ems/EmsSearchResultEng.jsp', POST_CODE: number }).toString(),
      }, { provider: 'Korea Post', timeoutMs: Math.max(1, Math.floor(budgetMs)), maxBytes: 1_000_000,
        fetcher: (input, init) => (this.options.fetcher ?? fetch)(input, { ...init,
          signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]) }),
      });
      context.signal?.throwIfAborted();
      return parse(decodeText(bytes), number);
    } catch (error) {
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError('Korea Post', 'Korea Post tracking endpoint is unavailable', { cause: error });
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new KoreaPostTracker({ fetcher: environment.fetcher });
  return { id: 'korea-post', steps: ['direct'], track: (input, context = {}) => runSteps({ carrier: 'korea-post', budgetMs: context.budgetMs ?? 15_000,
    signal: context.signal, recorder: environment.recorder }, [{ id: 'direct', run: ({ signal, remainingMs }) => tracker.fetch(input.number, { signal, budgetMs: remainingMs }) }]) };
};
