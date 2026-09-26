import 'server-only';

import { load } from 'cheerio';
import { DateTime } from 'luxon';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { ChallengeError, InputRequiredError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean, decodeText, fetchBounded } from '../../core/transport';
import { evriStatus } from './status';

const PROVIDER = 'Evri International';
// The international tracker linked by https://www.evri.com/track-a-parcel.
// It is separate from the domestic UK customer-tracking API.
const ENDPOINT = 'https://globaleco.app/track';
const MAX_RESPONSE_BYTES = 1_000_000;

export function normalizeEvriNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^[A-Z0-9]{16}$/.test(number)) {
    throw new InputRequiredError(PROVIDER, 'number', 'Evri requires a 16-character tracking number');
  }
  return number;
}

function wallTime(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) throw new SchemaError(PROVIDER, 'Evri returned an invalid event date');
  // Validate calendar values without claiming that the provider's international
  // wall clocks are UTC, or assigning one country's timezone to another leg.
  const date = DateTime.fromFormat(raw, 'yyyy-MM-dd HH:mm:ss', { zone: 'UTC' });
  if (!date.isValid) throw new SchemaError(PROVIDER, 'Evri returned an invalid event date');
  return date.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

/** Parse only the response to this reference's POST; empty results carry no identifier. */
export function parse(html: string, trackingNumber: string): CarrierResult {
  const number = normalizeEvriNumber(trackingNumber);
  const $ = load(html);
  if (/just a moment|verify.*human|captcha/i.test($('title').text())
    || $('.g-recaptcha, .h-captcha, input[name="captcha"]').length) throw new ChallengeError(PROVIDER);
  $('script, style, noscript').remove();
  const form = $('main form[action="/track"][method="POST"]');
  const headings = $('main h2');
  const detailsHeading = headings.filter((_, heading) => clean($(heading).text()).startsWith('Shipment Details #'));
  const historyHeading = headings.filter((_, heading) => clean($(heading).text()) === 'Shipment History');
  const input = form.find('input[name="tracking_number"]');
  // GlobalEco clears the form input for not-found. The exact POST scopes this
  // negative outcome; reject a nonempty input that names a different parcel.
  if (!detailsHeading.length && !historyHeading.length && form.length === 1
    && input.length === 1 && ['', number].includes(input.attr('value') ?? '!')
    && headings.filter((_, heading) => clean($(heading).text()) === 'Parcel not found').length === 1) {
    throw new NotFoundError(PROVIDER);
  }
  if (detailsHeading.length !== 1 || historyHeading.length !== 1) {
    throw new SchemaError(PROVIDER, 'Evri returned missing or ambiguous shipment details');
  }
  const details = detailsHeading.closest('.card');
  const fields = new Map<string, string>();
  details.find('.form-group').each((_, field) => {
    const label = $(field).children('strong');
    if (label.length !== 1) throw new SchemaError(PROVIDER, 'Evri returned invalid shipment details');
    const key = clean(label.text());
    if (fields.has(key)) throw new SchemaError(PROVIDER, 'Evri returned ambiguous shipment details');
    fields.set(key, clean($(field).clone().children('strong').remove().end().text(), 250));
  });
  // The form input can contain a partner alias instead of the submitted barcode.
  // Bind to both independent result fields, never the echoed search input.
  if (clean(detailsHeading.text()) !== `Shipment Details #${number}` || fields.get('System Tracking:') !== number) {
    throw new SchemaError(PROVIDER, 'Evri returned a different shipment');
  }
  const history = historyHeading.closest('.card');
  const table = history.find('table');
  if (details[0] === history[0] || table.length !== 1
    || table.find('thead th').map((_, cell) => clean($(cell).text())).get().join('|') !== 'Date/Time|Event|Location|Comments') {
    throw new SchemaError(PROVIDER, 'Evri returned an invalid history table');
  }
  const rows = table.find('tbody > tr');
  if (!rows.length || rows.length > 500) throw new SchemaError(PROVIDER, 'Evri returned incomplete tracking history');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const row of rows.toArray()) {
    const cells = $(row).children('td');
    if (cells.length !== 4 || cells.filter('[colspan], [rowspan]').length) throw new SchemaError(PROVIDER, 'Evri returned an invalid event row');
    const time = wallTime(clean(cells.eq(0).text(), 64));
    const description = clean(cells.eq(1).text(), 500);
    const location = clean(cells.eq(2).text(), 200);
    if (!description) throw new SchemaError(PROVIDER, 'Evri returned an empty event');
    const key = JSON.stringify([time, description, location]);
    if (seen.has(key)) continue;
    seen.add(key);
    const status = evriStatus(description);
    events.push({ local_time: time, description, ...(location ? { location } : {}), ...(status ? { stage: status.stage } : {}) });
  }
  // Already newest-first on the portal. Do not sort local clocks across legs.
  const latest = events[0]!;
  const description = fields.get('Current Status:');
  if (!description) throw new SchemaError(PROVIDER, 'Evri returned no current status');
  const status = evriStatus(description);
  const weight = /^(\d+(?:\.\d+)?)\s*kg$/.exec(fields.get('Weight:') ?? '');
  const weightKg = weight ? Number(weight[1]) : NaN;
  return {
    status: status?.status ?? 'unknown', ...(status ? { current_stage: status.stage } : {}),
    last_status_text: description, last_update: null, last_update_local: latest.local_time, expected_delivery: null,
    ...(Number.isFinite(weightKg) && weightKg > 0 ? { weight_kg: weightKg } : {}),
    events: events.slice(0, 100),
  };
}

export class EvriTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeEvriNumber(raw);
    const budgetMs = context.budgetMs ?? this.options.timeoutMs ?? 15_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('Evri timeout must be positive');
    context.signal?.throwIfAborted();
    try {
      const { bytes } = await fetchBounded(ENDPOINT, {
        method: 'POST', headers: { Accept: 'text/html', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tracking_number: number }).toString(),
      }, {
        provider: PROVIDER, maxBytes: MAX_RESPONSE_BYTES, timeoutMs: Math.max(1, Math.floor(budgetMs)),
        fetcher: (input, init) => (this.options.fetcher ?? fetch)(input, {
          ...init,
          signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]),
        }),
      });
      context.signal?.throwIfAborted();
      return parse(decodeText(bytes), number);
    } catch (error) {
      // Missing parcels use HTTP 200 with the exact result heading above.
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
        throw new TransportError(PROVIDER, 'Evri International tracking endpoint is unavailable', { cause: error });
      }
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new EvriTracker({ fetcher: environment.fetcher });
  return { id: 'evri', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context) };
};
