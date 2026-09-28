import 'server-only';

import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import { DateTime } from 'luxon';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { IndeterminateError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { clean, decodeText, fetchBounded } from '../../core/transport';
import { yanwenStatus } from './status';

// This constant is shipped in the public browser script; it is part of the
// anonymous form protocol, not a customer or account credential.
const PUBLIC_FORM_SALT = '00#78a13&ba6c;73LOL';

export function normalizeYanwenNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^[A-Z0-9]{8,40}$/.test(number)) throw new TypeError('Yanwen requires an alphanumeric parcel reference');
  return number;
}

export function yanwenTrackingUrl(raw: string): string {
  const number = normalizeYanwenNumber(raw);
  const signature = createHash('md5').update(number + PUBLIC_FORM_SALT).digest('hex');
  return `https://track.yw56.com.cn/en/querydel?${new URLSearchParams({ nums: number, cyp: signature })}`;
}

function eventTime(day: string, raw: string): string {
  const match = /^(\d{2}:\d{2}:\d{2}) \[GMT([+-]\d{2})(?::(\d{2}))?\]$/.exec(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !match) throw new SchemaError('Yanwen', 'Yanwen returned an invalid scan time');
  const parsed = DateTime.fromISO(`${day}T${match[1]}${match[2]}:${match[3] ?? '00'}`, { setZone: true });
  if (!parsed.isValid) throw new SchemaError('Yanwen', 'Yanwen returned an invalid scan time');
  return parsed.toISO({ suppressMilliseconds: true })!;
}

export function parse(html: string, trackingNumber: string): CarrierResult {
  const number = normalizeYanwenNumber(trackingNumber);
  const $ = load(html);
  $('script, style, noscript').remove();
  const identities = $('.ny_cxjg > input[name="wcdhA"]').filter((_, element) => $(element).attr('value') === number);
  if (identities.length !== 1) throw new SchemaError('Yanwen', 'Yanwen returned a different or ambiguous shipment');
  const resultBlocks = $('.cx_lb').filter((_, element) => clean($(element).find('.cx_bt_xx > h5').text()) === number);
  if (resultBlocks.length < 1 || resultBlocks.length > 2) throw new SchemaError('Yanwen', 'Yanwen returned a different or ambiguous shipment');
  const results: CarrierResult[] = [];
  for (const element of resultBlocks.toArray()) {
    const block = $(element);
    const timeline = block.find('.czhaodl');
    const summary = clean(block.find('.cx_bt_xx > p').text(), 200);
    if (timeline.length === 0 && summary === 'No information was found' && identities.attr('status') === '查询不到') {
      results.push({ missing: true });
      continue;
    }
    if (timeline.length !== 1) throw new IndeterminateError('Yanwen', 'Yanwen returned no parcel timeline');
    const scans = timeline.find('dl > dd');
    if (!scans.length || scans.length > 500) throw new SchemaError('Yanwen', 'Yanwen returned incomplete tracking history');
    const events: CarrierEvent[] = [];
    const seen = new Set<string>();
    for (const scan of scans.toArray()) {
      const row = $(scan);
      const day = clean(row.prevAll('dt').first().text(), 32);
      const time = eventTime(day, clean(row.find('.timePoint').text(), 64));
      const words = row.find('.cz_r h6');
      if (words.length < 1 || words.length > 2) throw new SchemaError('Yanwen');
      const description = clean(words.last().text(), 500);
      if (!description) throw new SchemaError('Yanwen', 'Yanwen returned an empty scan');
      const location = words.length === 2 ? clean(words.first().text(), 200).replace(/^\[|\]$/g, '') : '';
      const code = /\/([A-Z]{2}\d{2})\.png$/.exec(row.find('.cz_c img').attr('src') ?? '')?.[1];
      const key = JSON.stringify([time, description, location]);
      if (seen.has(key)) continue;
      seen.add(key);
      const classified = yanwenStatus(description);
      events.push({ time, description, location, ...(code ? { provider_code: code } : {}), ...(classified ? { stage: classified.stage } : {}) });
    }
    const latest = events[0]!;
    const classified = yanwenStatus(latest.description!);
    const columns = block.children('.cx_top_nr').children('.colFlex');
    if (columns.length !== 5) throw new SchemaError('Yanwen', 'Yanwen returned an invalid parcel summary');
    columns.find('a').remove();
    const deliveryNumber = clean(columns.eq(1).text(), 64).toUpperCase();
    const country = clean(columns.eq(3).text(), 8).toUpperCase();
    results.push({ status: classified?.status ?? 'unknown', ...(classified ? { current_stage: classified.stage } : {}),
      last_status_text: latest.description, last_update: latest.time,
      ...(classified?.stage === 'delivered' ? { delivered_at: latest.time } : {}),
      ...(deliveryNumber !== number && /^[A-Z0-9]{4,40}$/.test(deliveryNumber) ? { delivery_tracking_number: deliveryNumber } : {}),
      ...(/^[A-Z]{2}$/.test(country) ? { destination_country: country } : {}), events: events.slice(0, 100) });
  }
  // The server renders desktop and mobile copies. Require them to agree so
  // responsive duplicates cannot silently hide a different result.
  if (results.some((result) => JSON.stringify(result) !== JSON.stringify(results[0]))) throw new SchemaError('Yanwen', 'Yanwen returned inconsistent parcel histories');
  if (results[0]!.missing) throw new NotFoundError('Yanwen');
  return results[0]!;
}

export class YanwenTracker {
  constructor(private readonly options: { fetcher?: typeof fetch } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeYanwenNumber(raw);
    const budgetMs = context.budgetMs ?? 15_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('Yanwen timeout must be positive');
    context.signal?.throwIfAborted();
    try {
      const { bytes } = await fetchBounded(yanwenTrackingUrl(number), { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/html' }, body: 'timeZone=1',
      }, { provider: 'Yanwen', timeoutMs: Math.max(1, Math.floor(budgetMs)), maxBytes: 1_000_000,
        fetcher: (input, init) => (this.options.fetcher ?? fetch)(input, { ...init,
          signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]) }),
      });
      context.signal?.throwIfAborted();
      return parse(decodeText(bytes), number);
    } catch (error) {
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError('Yanwen', 'Yanwen tracking endpoint is unavailable', { cause: error });
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new YanwenTracker({ fetcher: environment.fetcher });
  return { id: 'yanwen', steps: ['direct'], track: (input, context = {}) => runSteps({ carrier: 'yanwen', budgetMs: context.budgetMs ?? 15_000,
    signal: context.signal, recorder: environment.recorder }, [{ id: 'direct', run: ({ signal, remainingMs }) => tracker.fetch(input.number, { signal, budgetMs: remainingMs }) }]) };
};
