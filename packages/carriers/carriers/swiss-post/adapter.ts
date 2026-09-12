import { load } from 'cheerio';
import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import type { AdapterFactory } from '../../core/adapter';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult, CarrierStatus } from '../../core/result';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { FALLBACK_EVENT_LABELS, STAGE_STATUS, STATUS_MAP, swissPostEventStage } from './status';

// The public tracker signs an anonymous visitor in before it will search: it
// creates a throwaway user, echoes a CSRF token, and keys the search result on
// a hash. Every call in that sequence shares one cookie jar.
const API_BASE = 'https://service.post.ch/ekp-web/api';
const TRANSLATIONS_URL = 'https://service.post.ch/ekp-web/core/rest/translations/en/shipment-text-messages';
const PROVIDER = 'Swiss Post';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-CH,en;q=0.9',
  Referer: 'https://service.post.ch/ekp-web/ui/',
};

export interface SwissPostOptions {
  /** Test seam; production uses the global fetch. The cookie jar wraps it. */
  fetcher?: typeof fetch;
}

/**
 * Trim and cap without collapsing inner whitespace: Swiss Post's translated
 * wording is shown as the carrier writes it, so `core/transport`'s `clean` is
 * deliberately not used here.
 */
function text(value: unknown, limit = 500): string {
  return String(value ?? '').trim().slice(0, limit);
}

function comparableShipmentNumber(value: unknown): string {
  return String(value ?? '').replace(/[\s.-]/g, '').toUpperCase();
}

function datePart(value: unknown): string | null {
  return /(?<!\d)(\d{4}-\d{2}-\d{2})(?!\d)/.exec(text(value))?.[1] ?? null;
}

function clockParts(value: unknown): string[] {
  if (isRecord(value)) {
    return ['start', 'end', 'from', 'to'].flatMap((key) => clockParts(value[key]));
  }
  if (Array.isArray(value)) return value.flatMap(clockParts);
  const stringValue = text(value);
  const timestampClock = /T((?:[01]\d|2[0-3]):[0-5]\d)/.exec(stringValue)?.[1];
  if (timestampClock) return [timestampClock];
  const clocks = stringValue.match(/(?<!\d)(?:[01]\d|2[0-3]):[0-5]\d/g) ?? [];
  if (clocks.length > 1 && /[+-](?:[01]\d|2[0-3]):[0-5]\d$/.test(stringValue)) {
    return clocks.slice(0, 1);
  }
  return clocks;
}

export function swissPostExpectedDelivery(item: JsonObject): string | null {
  const interval = item.deliveryTimeInterval;
  const range = isRecord(item.deliveryRange) ? item.deliveryRange : {};
  const date = [
    item.calculatedDeliveryDate,
    item.deliveryDate,
    interval,
    range.start,
    range.end,
  ].map(datePart).find(Boolean) ?? null;
  if (!date) return null;
  const clocks = clockParts(interval);
  if (clocks.length === 0) return date;
  if (clocks.length === 1 || clocks[0] === clocks[1]) return `${date} ${clocks[0]}`;
  return `${date} ${clocks[0]}–${clocks[1]}`;
}

/**
 * Resolve one dotted translation key against the service's pattern table, where
 * `*` is a wildcard segment. The most specific pattern of the same length wins.
 */
function translationMatch(
  translations: Record<string, string>,
  segments: string[],
): string | null {
  let best: { score: number; description: string } | null = null;
  for (const [pattern, description] of Object.entries(translations)) {
    const patternSegments = pattern.split('.');
    if (patternSegments.length !== segments.length) continue;
    if (!patternSegments.every((expected, index) => expected === '*' || expected === segments[index])) {
      continue;
    }
    const score = patternSegments.filter((segment) => segment !== '*').length;
    if (!best || score > best.score) best = { score, description };
  }
  return best?.description ?? null;
}

function eventDescription(
  event: JsonObject,
  translations: Record<string, string>,
  internationalType: string,
): string {
  const eventCode = text(event.eventCode, 100);
  const segments = [...eventCode.split('.'), internationalType];
  let description = translationMatch(translations, segments);
  const subEventId = text(event.subEventId, 50);
  if (subEventId) {
    const subSegments = [...segments, subEventId];
    const detailCode = text(event.subEventDetailCode, 50);
    if (detailCode) subSegments.push(detailCode);
    const detail = translationMatch(translations, subSegments);
    if (detail && detail !== description) description = description ? `${description} — ${detail}` : detail;
  }
  const metadata = isRecord(event.externalMetadata) ? event.externalMetadata : {};
  const externalDescription = text(metadata.description);
  const code = eventCode.split('.').at(-1) ?? '';
  const value = description || externalDescription || FALLBACK_EVENT_LABELS[code] || eventCode;
  const $ = load(`<span>${value}</span>`);
  return $('span').text().trim().slice(0, 500) || 'Tracking update';
}

/** Operational scan location only: the city and its postcode, never a street. */
function eventLocation(event: JsonObject): string {
  return [text(event.city, 100), text(event.zip, 30)].filter(Boolean).join(' ').slice(0, 160);
}

/**
 * Local ordering policy: event timestamps are read only to sort. Values without
 * an offset are treated as UTC for that comparison, which keeps the ordering
 * stable without rewriting the string the carrier sent — the event keeps the
 * carrier's own `timestamp` verbatim.
 */
function timestamp(value: string): number {
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = Date.parse(explicitZone ? value : `${value}Z`);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function parseSwissPostShipment(
  item: JsonObject,
  rawEvents: unknown[],
  translations: Record<string, string> = {},
): CarrierResult {
  const globalStatus = text(item.globalStatus, 100);
  let status: CarrierStatus = STATUS_MAP.get(globalStatus) ?? 'in_transit';
  const internationalType = item.internationalImport
    ? 'IMPORT'
    : item.internationalExport
      ? 'EXPORT'
      : 'INLAND';
  const events: CarrierEvent[] = [];
  for (const rawEvent of rawEvents.slice(0, 100)) {
    if (!isRecord(rawEvent)) continue;
    const time = text(rawEvent.timestamp, 100);
    const eventCode = text(rawEvent.eventCode, 100);
    if (!time || !eventCode) continue;
    const event: CarrierEvent = {
      time,
      location: eventLocation(rawEvent),
      description: eventDescription(rawEvent, translations, internationalType),
      provider_code: eventCode,
    };
    const stage = swissPostEventStage(eventCode);
    if (stage) event.stage = stage;
    events.push(event);
  }
  events.sort((left, right) => timestamp(right.time ?? '') - timestamp(left.time ?? ''));
  let lastStatusText: string;
  let lastUpdate: string | null;
  if (events[0]) {
    lastStatusText = events[0].description ?? 'Tracking update';
    if (events[0].stage && STAGE_STATUS[events[0].stage]) status = STAGE_STATUS[events[0].stage]!;
    lastUpdate = events[0].time ?? null;
  } else {
    lastStatusText = globalStatus;
    lastUpdate = text(item.lastEventDateTime, 100) || null;
  }
  return {
    status,
    ...(events[0]?.stage ? { current_stage: events[0].stage } : {}),
    last_status_text: lastStatusText,
    last_update: lastUpdate,
    expected_delivery: swissPostExpectedDelivery(item),
    timezone: 'Europe/Zurich',
    global_status: globalStatus,
    canonical_tracking_number: comparableShipmentNumber(item.shipmentNumber) || undefined,
    ...(/^[A-Z0-9]{4,40}$/.test(comparableShipmentNumber(item.internationalBarcode))
      ? { international_tracking_number: comparableShipmentNumber(item.internationalBarcode) } : {}),
    delivery_range: item.deliveryRange,
    delivery_time_interval: item.deliveryTimeInterval,
    events,
  };
}

export class SwissPostTracker {
  #translations: Record<string, string> | null = null;
  #translationAttempted = false;
  readonly #fetcher: typeof fetch | undefined;

  constructor(options: SwissPostOptions = {}) {
    this.#fetcher = options.fetcher;
  }

  async readJson(
    fetcher: typeof fetch,
    url: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const { bytes } = await fetchBounded(url, init, {
      provider: 'Swiss Post tracking',
      timeoutMs: 10_000,
      fetcher,
    });
    return parseJsonBytes(bytes, PROVIDER);
  }

  /** Cached for the process: the table is large, static, and shared by every lookup. */
  async loadTranslations(fetcher: typeof fetch): Promise<Record<string, string>> {
    if (this.#translations) return this.#translations;
    if (this.#translationAttempted) return {};
    this.#translationAttempted = true;
    try {
      const payload = await this.readJson(fetcher, TRANSLATIONS_URL, { headers: HEADERS });
      const raw = isRecord(payload) && isRecord(payload['shipment-text--'])
        ? payload['shipment-text--']
        : {};
      this.#translations = Object.fromEntries(
        Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      );
    } catch {
      return {};
    }
    return this.#translations;
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const fetcher = makeFetchCookie(this.#fetcher ?? fetch, new CookieJar());
    const userResult = await fetchBounded(`${API_BASE}/user`, { headers: HEADERS }, {
      provider: 'Swiss Post tracking',
      timeoutMs: 10_000,
      fetcher,
    });
    const userPayload = parseJsonBytes(userResult.bytes, PROVIDER);
    if (!isRecord(userPayload)) throw new SchemaError(PROVIDER, 'Swiss Post returned an invalid anonymous user response');
    const userId = text(userPayload.userIdentifier);
    if (!userId) throw new SchemaError(PROVIDER, 'Swiss Post did not return an anonymous user identifier');
    const csrf = userResult.response.headers.get('x-csrf-token') ?? '';
    const headers = { ...HEADERS, 'x-csrf-token': csrf };
    const query = new URLSearchParams({ userId });
    const historyPayload = await this.readJson(fetcher, `${API_BASE}/history?${query}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchQuery: trackingNumber }),
    });
    const hash = isRecord(historyPayload) ? text(historyPayload.hash) : '';
    if (!hash) throw new SchemaError(PROVIDER, 'Swiss Post did not return a shipment search identifier');
    const items = await this.readJson(
      fetcher,
      `${API_BASE}/history/not-included/${encodeURIComponent(hash)}?${query}`,
      { headers },
    );
    if (!Array.isArray(items)) {
      throw new SchemaError(PROVIDER, 'Swiss Post returned an invalid shipment response');
    }
    if (items.length === 0) throw new NotFoundError(PROVIDER);
    if (!items.every(isRecord)) {
      throw new SchemaError(PROVIDER, 'Swiss Post returned an invalid shipment response');
    }
    const requested = comparableShipmentNumber(trackingNumber);
    const identified = items.filter((candidate) => comparableShipmentNumber(candidate.shipmentNumber));
    if (identified.length === 0) {
      throw new SchemaError(PROVIDER, 'Swiss Post did not return a shipment identifier');
    }
    const matches = identified.filter((candidate) =>
      comparableShipmentNumber(candidate.shipmentNumber) === requested
      || comparableShipmentNumber(candidate.internationalBarcode) === requested,
    );
    if (matches.length === 0) throw new SchemaError(PROVIDER, 'Swiss Post returned a different shipment');
    if (matches.length !== 1) throw new SchemaError(PROVIDER, 'Swiss Post returned an ambiguous shipment');
    const item = matches[0]!;
    const identity = text(item.identity);
    let events: unknown[] = [];
    if (identity) {
      try {
        const payload = await this.readJson(
          fetcher,
          `${API_BASE}/shipment/id/${encodeURIComponent(identity)}/events`,
          { headers },
        );
        if (Array.isArray(payload)) events = payload;
      } catch {
        // A shipment summary is still useful when the optional event call fails.
      }
    }
    const translations = events.length > 0 ? await this.loadTranslations(fetcher) : {};
    return parseSwissPostShipment(item, events, translations);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new SwissPostTracker({ fetcher: environment.fetcher });
  return {
    id: 'swiss-post',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
