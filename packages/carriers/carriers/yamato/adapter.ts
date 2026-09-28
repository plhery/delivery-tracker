import 'server-only';

import { load } from 'cheerio';
import { DateTime } from 'luxon';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { normalizeTrackingNumber } from '../../core/detection';
import { ChallengeError, InputRequiredError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean, decodeText, fetchBounded } from '../../core/transport';
import { yamatoStatus } from './status';

const PROVIDER = 'Yamato Transport';
const ENDPOINT = 'https://toi.kuronekoyamato.co.jp/cgi-bin/tneko';
const ZONE = 'Asia/Tokyo';

export function normalizeYamatoNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^\d{12}$/.test(number)) {
    throw new InputRequiredError(PROVIDER, 'number', 'Yamato requires a 12-digit tracking number');
  }
  return number;
}

function eventDate(raw: string): Pick<CarrierEvent, 'time'> & { provider_time_text: string } {
  const match = /^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日 (\d{2}):(\d{2})$/.exec(raw);
  if (!match) throw new SchemaError(PROVIDER, 'Yamato returned an invalid event date');
  const [, year, month, day, hour, minute] = match;
  // A leap year validates month/day even when the carrier leaves the year out.
  // It is never used as an event year or as a freshness watermark.
  const date = DateTime.fromObject({ year: year ? Number(year) : 2000,
    month: Number(month), day: Number(day), hour: Number(hour), minute: Number(minute) }, { zone: ZONE });
  if (!date.isValid) throw new SchemaError(PROVIDER, 'Yamato returned an invalid event date');
  return { provider_time_text: raw, ...(year ? { time: date.toUTC().toISO({ suppressMilliseconds: true })! } : {}) };
}

export function parse(html: string, trackingNumber: string): CarrierResult {
  const number = normalizeYamatoNumber(trackingNumber);
  const $ = load(html);
  if (/captcha|verify.*human|just a moment/i.test($('title').text())
    || $('.g-recaptcha, .h-captcha, input[name="captcha"]').length) throw new ChallengeError(PROVIDER);
  $('script, style, noscript').remove();
  const blocks = $('.parts-tracking-invoice-block');
  if (blocks.length !== 1) throw new SchemaError(PROVIDER, 'Yamato returned missing or ambiguous shipment details');
  const block = blocks.first();
  const headings = block.find('.tracking-invoice-block-title');
  const heading = /^1件目：([\d-]+)$/.exec(clean(headings.text()));
  if (headings.length !== 1 || !heading || normalizeTrackingNumber(heading[1]) !== number) {
    throw new SchemaError(PROVIDER, 'Yamato returned a different shipment');
  }
  const summary = block.find('.tracking-invoice-block-state-title');
  const wording = clean(summary.text());
  if (summary.length !== 1 || !wording) throw new SchemaError(PROVIDER, 'Yamato returned no current shipment state');
  const history = block.find('.tracking-invoice-block-detail > ol');
  const rows = history.children('li');
  if (['伝票番号未登録', '伝票番号誤り'].includes(wording) && !rows.length) throw new NotFoundError(PROVIDER);
  if (history.length !== 1 || !rows.length || rows.length > 1000) {
    throw new SchemaError(PROVIDER, 'Yamato returned missing or excessive shipment history');
  }
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  let returning = false;
  rows.each((_, row) => {
    const item = $(row);
    const labels = item.children('.item');
    const dates = item.children('.date');
    const places = item.children('.name');
    const description = clean(labels.text());
    if (labels.length !== 1 || dates.length !== 1 || places.length !== 1 || !description) {
      throw new SchemaError(PROVIDER, 'Yamato returned an incomplete history row');
    }
    const location = clean(places.text());
    const mapped = yamatoStatus(description);
    if (mapped?.stage === 'returned') returning = true;
    const stage = returning && mapped && ['accepted', 'in_transit', 'out_for_delivery', 'ready_for_pickup', 'delivered'].includes(mapped.stage)
      ? 'returned' : mapped?.stage;
    const event: CarrierEvent = { description, ...eventDate(clean(dates.text())),
      ...(location ? { location } : {}), ...(stage ? { stage } : {}) };
    const key = JSON.stringify(event);
    if (!seen.has(key)) { seen.add(key); events.push(event); }
  });
  // The official detail list is chronological, including request-only records.
  // Sorting yearless dates could incorrectly reorder a New Year crossing.
  events.reverse();
  const mappedCurrent = yamatoStatus(wording);
  const current = returning && mappedCurrent && ['accepted', 'in_transit', 'out_for_delivery', 'ready_for_pickup', 'delivered'].includes(mappedCurrent.stage)
    ? { status: 'exception' as const, stage: 'returned' } : mappedCurrent;
  return { status: current?.status ?? 'unknown', ...(current ? { current_stage: current.stage } : {}),
    last_status_text: wording, last_update: events[0]?.time ?? null,
    ...(current?.stage === 'delivered' && events[0]?.stage === 'delivered' && events[0].time ? { delivered_at: events[0].time } : {}),
    timezone: ZONE, events: events.slice(0, 100) };
}

export class YamatoTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeYamatoNumber(raw);
    const budgetMs = context.budgetMs ?? this.options.timeoutMs ?? 15_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('Yamato timeout must be positive');
    context.signal?.throwIfAborted();
    try {
      const { bytes } = await fetchBounded(ENDPOINT, { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ number00: '1', number01: number }) }, {
        provider: PROVIDER, timeoutMs: Math.max(1, Math.floor(budgetMs)), maxBytes: 1_000_000,
        fetcher: (input, init) => (this.options.fetcher ?? fetch)(input, { ...init,
          signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]) }),
      });
      context.signal?.throwIfAborted();
      return parse(decodeText(bytes), number);
    } catch (error) {
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
        throw new TransportError(PROVIDER, 'Yamato tracking endpoint is unavailable', { cause: error });
      }
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new YamatoTracker({ fetcher: environment.fetcher });
  return { id: 'yamato', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
