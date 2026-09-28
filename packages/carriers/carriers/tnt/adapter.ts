import 'server-only';

import { load } from 'cheerio';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { normalizeTrackingNumber } from '../../core/detection';
import { ChallengeError, IndeterminateError, InputRequiredError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { zonedTime } from '../../core/time';
import { clean, decodeText, fetchBounded } from '../../core/transport';
import { tntFranceStatus } from './status';

const PROVIDER = 'TNT France';
const ENDPOINT = 'https://www.tnt.fr/public/suivi_colis/recherche/visubontransport.do';

export function normalizeTntFranceNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^\d{16}$/.test(number)) throw new InputRequiredError(PROVIDER, 'number', 'TNT France direct tracking requires a 16-digit national consignment');
  return number;
}

export function parseTntFranceResponse(html: string, rawNumber: string): CarrierResult {
  const number = normalizeTntFranceNumber(rawNumber);
  const $ = load(html);
  $('script, style, noscript').remove();
  if (/captcha|access denied|verify you are human/i.test(clean($('title').text(), 200))) throw new ChallengeError(PROVIDER);
  const negative = $('#saisieBTMsg');
  if (negative.length === 1 && !/display\s*:\s*none/i.test(negative.attr('style') ?? '')
    && /Nous n'avons pas trouvé de colis associé à votre recherche|Les données suivantes ne correspondent pas à des bons de transport/i.test(clean(negative.text(), 500))) {
    throw new NotFoundError(PROVIDER);
  }
  // The returned details identity is separate from the search form's echo.
  const identity = $('#ancestor');
  const titles = $('.layout__item').filter((_, element) => /^Bon de transport n[º°]\s*\d{16}$/.test(clean($(element).text(), 100)));
  if (identity.length !== 1 || clean(identity.text(), 32) !== number || titles.length !== 1
    || !clean(titles.text(), 100).endsWith(number)) throw new SchemaError(PROVIDER, 'TNT France returned no matching shipment details');
  const sections = $('.result__item').filter((_, element) => clean($(element).children('.result__row').text(), 100) === 'Etapes de votre expédition');
  if (sections.length !== 1) throw new SchemaError(PROVIDER, 'TNT France returned no unique tracking history');
  const rows = sections.children('.result__content').children('.roster');
  if (!rows.length) throw new IndeterminateError(PROVIDER, 'TNT France returned empty tracking history');
  if (rows.length > 500) throw new SchemaError(PROVIDER, 'TNT France returned excessive tracking history');
  const parsed: Array<{ event: CarrierEvent; timestamp: number; index: number }> = [];
  const seen = new Set<string>();
  rows.toArray().forEach((row, index) => {
    const cells = $(row).children('.roster__item');
    if (cells.length !== 3) throw new SchemaError(PROVIDER, 'TNT France changed its tracking row');
    const description = clean(cells.eq(0).text(), 500);
    const date = clean(cells.eq(1).text(), 64);
    const time = zonedTime(date, 'dd/MM/yyyy HH:mm', 'Europe/Paris');
    const location = clean(cells.eq(2).text(), 200);
    if (!description || !time) throw new SchemaError(PROVIDER, 'TNT France returned an incomplete tracking row');
    const mapped = tntFranceStatus(description);
    const key = JSON.stringify([time.iso, description, location]);
    if (seen.has(key)) return;
    seen.add(key);
    parsed.push({ event: { time: time.iso, description, ...(location ? { location } : {}), ...(mapped ? { stage: mapped.stage } : {}) }, timestamp: time.timestamp, index });
  });
  parsed.sort((a, b) => b.timestamp - a.timestamp || a.index - b.index);
  const events = parsed.slice(0, 100).map(({ event }) => event);
  // Desktop and mobile repeat the selected milestone. Future rail labels are
  // not events, and an unselected "Livré" never proves delivery.
  const selected = [...new Set($('.suivi-title-selected').toArray().map((element) => clean($(element).text(), 200)).filter(Boolean))];
  if (selected.length !== 1) throw new SchemaError(PROVIDER, 'TNT France returned an ambiguous current milestone');
  const mapped = tntFranceStatus(selected[0]!);
  return {
    status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: selected[0]!, last_update: events[0]!.time!, expected_delivery: null, events,
  };
}

export class TntFranceTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {}

  async fetch(rawNumber: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeTntFranceNumber(rawNumber);
    const budgetMs = context.budgetMs ?? this.options.timeoutMs ?? 15_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('TNT France timeout must be positive');
    context.signal?.throwIfAborted();
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ bonTransport: number, radiochoixrecherche: 'BT' }).toString();
    try {
      const { response, bytes } = await fetchBounded(url, { headers: { Accept: 'text/html' } }, {
        provider: PROVIDER, maxBytes: 1_000_000, timeoutMs: Math.max(1, Math.floor(budgetMs)),
        fetcher: (input, init) => (this.options.fetcher ?? fetch)(input, {
          ...init, signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]),
        }),
      });
      context.signal?.throwIfAborted();
      const encoding = /charset\s*=\s*ISO-8859-1/i.test(response.headers.get('content-type') ?? '') ? 'iso-8859-1' : 'utf-8';
      return parseTntFranceResponse(decodeText(bytes, encoding), number);
    } catch (error) {
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError(PROVIDER, 'TNT France tracking endpoint is unavailable', { cause: error });
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new TntFranceTracker({ fetcher: environment.fetcher });
  return {
    id: 'tnt', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => {
      if (!/^\d{16}$/.test(normalizeTrackingNumber(number))) throw new TypeError('Unsupported TNT France number');
    })),
  };
};
