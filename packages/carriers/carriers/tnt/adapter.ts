import 'server-only';

import { load } from 'cheerio';
import { recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { normalizeTrackingNumber } from '../../core/detection';
import { ChallengeError, IndeterminateError, InputRequiredError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime, zonedTime } from '../../core/time';
import { clean, decodeText, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord } from '../../core/types';
import { tntExpressStatus, tntFranceStatus } from './status';

const PROVIDER = 'TNT France';
const ENDPOINT = 'https://www.tnt.fr/public/suivi_colis/recherche/visubontransport.do';
const EXPRESS_PROVIDER = 'TNT';
// The JSON read behind tnt.com's public tracking page.
const EXPRESS_ENDPOINT = 'https://www.tnt.com/api/v3/shipment';

export function normalizeTntFranceNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^\d{16}$/.test(number)) throw new InputRequiredError(PROVIDER, 'number', 'TNT France direct tracking requires a 16-digit national consignment');
  return number;
}

export function normalizeTntExpressNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^\d{9}$/.test(number)) throw new InputRequiredError(EXPRESS_PROVIDER, 'number', 'TNT direct tracking requires a 9-digit consignment or a 16-digit TNT France consignment');
  return number;
}

async function fetchTnt(url: URL, accept: string, provider: string, context: TrackingContext, options: { fetcher?: typeof fetch; timeoutMs?: number }) {
  const budgetMs = context.budgetMs ?? options.timeoutMs ?? 15_000;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError(`${provider} timeout must be positive`);
  context.signal?.throwIfAborted();
  try {
    const fetched = await fetchBounded(url, { headers: { Accept: accept } }, {
      provider, maxBytes: 1_000_000, timeoutMs: Math.max(1, Math.floor(budgetMs)),
      fetcher: (input, init) => (options.fetcher ?? fetch)(input, {
        ...init, signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]),
      }),
    });
    context.signal?.throwIfAborted();
    return fetched;
  } catch (error) {
    if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError(provider, `${provider} tracking endpoint is unavailable`, { cause: error });
    throw error;
  }
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

function tntExpressHistory(consignment: Record<string, unknown>): Array<{ event: CarrierEvent; timestamp: number; index: number }> {
  if (!Array.isArray(consignment.events) || consignment.events.length > 500) throw new SchemaError(EXPRESS_PROVIDER, 'TNT returned invalid tracking history');
  const parsed: Array<{ event: CarrierEvent; timestamp: number; index: number }> = [];
  const seen = new Set<string>();
  consignment.events.forEach((raw, index) => {
    if (!isRecord(raw)) throw new SchemaError(EXPRESS_PROVIDER, 'TNT returned an invalid scan');
    const time = explicitOffsetTime(raw.date);
    const description = clean(raw.statusDescription, 500);
    if (!time || !description) throw new SchemaError(EXPRESS_PROVIDER, 'TNT returned an incomplete scan');
    const place = isRecord(raw.location) ? raw.location : {};
    const location = [clean(place.city, 100), clean(place.country, 100)].filter(Boolean).join(', ');
    const code = clean(raw.legacyCode, 16);
    const mapped = tntExpressStatus(code);
    const key = JSON.stringify([time.iso, code, description, location]);
    if (seen.has(key)) return;
    seen.add(key);
    parsed.push({ event: {
      time: time.iso, description, ...(location ? { location } : {}), ...(code ? { provider_code: code } : {}),
      ...(mapped ? { stage: mapped.stage } : {}),
    }, timestamp: time.timestamp, index });
  });
  // Newest first, as the page lists them.
  return parsed.sort((a, b) => b.timestamp - a.timestamp || a.index - b.index);
}

export function parseTntExpressResponse(payload: unknown, rawNumber: string): CarrierResult {
  const number = normalizeTntExpressNumber(rawNumber);
  const output = isRecord(payload) ? payload['tracker.output'] : undefined;
  if (!isRecord(output)) throw new SchemaError(EXPRESS_PROVIDER);
  const consignments = Array.isArray(output.consignment) ? output.consignment : [];
  if (!consignments.length) {
    if (Array.isArray(output.notFound) && output.notFound.some((entry) => isRecord(entry) && clean(entry.input, 32) === number)) {
      throw new NotFoundError(EXPRESS_PROVIDER);
    }
    throw new SchemaError(EXPRESS_PROVIDER);
  }
  if (consignments.length > 50) throw new SchemaError(EXPRESS_PROVIDER, 'TNT returned excessive shipments');
  // Numbers are reused: every consignment that carried this one is listed.
  // Its most recent scan picks the parcel; another number is never read.
  const shipments = consignments.map((consignment) => {
    if (!isRecord(consignment)) throw new SchemaError(EXPRESS_PROVIDER, 'TNT returned an invalid shipment');
    return consignment;
  }).filter((consignment) => clean(consignment.consignmentNumber, 32) === number)
    .map((consignment) => ({ consignment, history: tntExpressHistory(consignment) }));
  if (!shipments.length) throw new SchemaError(EXPRESS_PROVIDER, 'TNT returned a different shipment');
  const newest = ({ history }: { history: Array<{ timestamp: number }> }) => history[0]?.timestamp ?? -Infinity;
  const { consignment, history } = shipments.reduce((best, shipment) => newest(shipment) > newest(best) ? shipment : best);
  if (!history.length) throw new IndeterminateError(EXPRESS_PROVIDER, 'TNT returned a shipment without tracking history');
  const events = history.slice(0, 100).map(({ event }) => event);
  const mapped = tntExpressStatus(String(events[0]!.provider_code ?? ''));
  // `destinationDate` is the estimate until delivery; its day matches the page.
  const sources = isRecord(consignment.analytics) && isRecord(consignment.analytics.destinationDateSources)
    ? consignment.analytics.destinationDateSources : {};
  const estimate = clean(consignment.destinationDate, 64);
  const expected = ['originalEta', 'revisedEta', 'outForDeliveryEta'].includes(clean(sources.usedDate, 32))
    && !['delivered', 'returned'].includes(mapped?.stage ?? '') && /^\d{4}-\d{2}-\d{2}T/.test(estimate) ? estimate.slice(0, 10) : null;
  return {
    status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: events[0]!.description!, last_update: events[0]!.time!, expected_delivery: expected, events,
  };
}

export class TntFranceTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {}

  async fetch(rawNumber: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeTntFranceNumber(rawNumber);
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ bonTransport: number, radiochoixrecherche: 'BT' }).toString();
    const { response, bytes } = await fetchTnt(url, 'text/html', PROVIDER, context, this.options);
    const encoding = /charset\s*=\s*ISO-8859-1/i.test(response.headers.get('content-type') ?? '') ? 'iso-8859-1' : 'utf-8';
    return parseTntFranceResponse(decodeText(bytes, encoding), number);
  }
}

export class TntExpressTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {}

  async fetch(rawNumber: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeTntExpressNumber(rawNumber);
    const url = new URL(EXPRESS_ENDPOINT);
    url.search = new URLSearchParams({ con: number, searchType: 'CON', locale: 'en_GB', channel: 'OPENTRACK' }).toString();
    const { bytes } = await fetchTnt(url, 'application/json', EXPRESS_PROVIDER, context, this.options);
    return parseTntExpressResponse(parseJsonBytes(bytes, EXPRESS_PROVIDER), number);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const france = new TntFranceTracker({ fetcher: environment.fetcher });
  const express = new TntExpressTracker({ fetcher: environment.fetcher });
  // TNT France consignments have 16 digits; tnt.com rejects them.
  const lookup = (number: string, context?: TrackingContext) => /^\d{16}$/.test(normalizeTrackingNumber(number))
    ? france.fetch(number, context) : express.fetch(number, context);
  return {
    id: 'tnt', steps: ['direct'], track: (input, context) => lookup(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => lookup(number, context),
      () => /^(?:\d{9}|\d{16})$/.test(normalizeTrackingNumber(number))),
  };
};
