import 'server-only';

import { load } from 'cheerio';
import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import type { AdapterFactory } from '../../core/adapter';
import { ChallengeError, IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { ClassifiedStatus } from '../../core/status';
import { isValidS10TrackingNumber } from '../../core/detection';
import { isoTime } from '../../core/time';
import {
  cleanScalar,
  decodeText,
  fetchBounded,
  parseJsonBytes,
  UpstreamHttpError,
} from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { classifyIndiaPostEvent } from './status';

// Protocol provenance (inspected 2026-09-01):
// https://github.com/bivu-m/njs-tracker-scraper
// MySpeedPost currently exposes its tracking form as a Livewire component at
// /track and completes the asynchronous lookup through /livewire/update.
const TRACKING_PAGE = 'https://myspeedpost.com/track';
const LIVEWIRE_UPDATE = 'https://myspeedpost.com/livewire/update';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_MAX_POLL_ATTEMPTS = 10;
const MAX_RESPONSE_BYTES = 2_000_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';

export { classifyIndiaPostEvent };

interface ParsedEvent {
  event: CarrierEvent;
  classified: ClassifiedStatus;
  timestamp: number;
  index: number;
}

interface TrackComponent {
  snapshot: string;
  data: JsonObject;
  status: string;
}

interface LivewireUpdate {
  component: TrackComponent;
  effects: JsonObject;
}

interface IndiaPostTrackerOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  fetcher?: typeof fetch;
}

// India Post sends ids and pincodes as numbers as often as strings, so the
// number-tolerant `cleanScalar` is used throughout instead of `clean`.
const clean = cleanScalar;

/** The MySpeedPost session bootstrap ran into Cloudflare, not into a shipment answer. */
export class IndiaPostChallengeError extends ChallengeError {
  constructor() {
    super('India Post', 'India Post tracking returned a browser challenge');
    this.name = 'IndiaPostChallengeError';
  }
}

export function normalizeIndiaPostTrackingNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^[A-Z]{2}\d{9}IN$/.test(value) || !isValidS10TrackingNumber(value)) {
    throw new TypeError('India Post tracking requires a valid 13-character S10 number ending in IN');
  }
  return value;
}

export function indiaPostTrackingUrl(raw: string): string {
  const url = new URL(TRACKING_PAGE);
  url.searchParams.set('n', normalizeIndiaPostTrackingNumber(raw));
  url.searchParams.set('sync', 'true');
  return url.toString();
}

function parseTrackingRequest(html: string): JsonObject {
  const $ = load(html);
  for (const element of $('[tracking-request]').toArray()) {
    const serialized = $(element).attr('tracking-request');
    if (!serialized) continue;
    try {
      const payload: unknown = JSON.parse(serialized);
      if (isRecord(payload) && Array.isArray(payload.tracking_events)) return payload;
    } catch {
      // Keep looking in case an unrelated component owns the malformed attribute.
    }
  }
  throw new SchemaError('India Post', 'India Post returned an invalid tracking history');
}

export function parseIndiaPostTrackingHtml(
  html: string,
  trackingNumber: string,
): CarrierResult {
  const requested = normalizeIndiaPostTrackingNumber(trackingNumber);
  const $ = load(html);
  const returned = clean($('#consignment_search').first().attr('value'), 64)
    .toLocaleUpperCase('en-US')
    .replace(/[\s.-]/g, '');
  if (returned !== requested) throw new SchemaError('India Post', 'India Post returned a different shipment');

  const trackingRequest = parseTrackingRequest(html);
  if (trackingRequest.tracking_status !== 'Completed') {
    throw new SchemaError('India Post', 'India Post returned an incomplete tracking response');
  }
  if (!Array.isArray(trackingRequest.tracking_events)) {
    throw new SchemaError('India Post', 'India Post returned invalid tracking events');
  }
  const rawEvents = trackingRequest.tracking_events;
  const events = rawEvents.filter(isRecord);
  if (events.length !== rawEvents.length || events.length === 0) {
    throw new SchemaError('India Post', 'India Post returned invalid tracking events');
  }

  const parsed: ParsedEvent[] = [];
  const seen = new Set<string>();
  events.slice(0, 500).forEach((rawEvent, index) => {
    // tracked_at is ISO; offset-less values are read as Asia/Kolkata, the zone
    // every India Post office stamps.
    const time = isoTime(rawEvent.tracked_at, 'Asia/Kolkata', 100);
    const description = clean(rawEvent.event);
    if (!time || !description) return;
    const office = clean(rawEvent.office, 120);
    const pincode = /^\d{6}$/.test(clean(rawEvent.pincode, 6))
      ? clean(rawEvent.pincode, 6)
      : '';
    const providerCode = clean(rawEvent.event_type, 100);
    const identity = JSON.stringify([time.iso, description, office, pincode, providerCode]);
    if (seen.has(identity)) return;
    seen.add(identity);
    const classified = classifyIndiaPostEvent(
      rawEvent.event_type,
      rawEvent.event,
      rawEvent.remarks,
    );
    parsed.push({
      // Office plus pincode is an operational location. Recipient identity,
      // contact numbers and address blocks travel on the row and are
      // deliberately never retained.
      event: {
        time: time.iso,
        location: [office, pincode].filter(Boolean).join(' '),
        description,
        stage: classified.stage,
        ...(providerCode ? { provider_code: providerCode } : {}),
      },
      classified,
      timestamp: time.timestamp,
      index,
    });
  });
  parsed.sort((left, right) => right.timestamp - left.timestamp || right.index - left.index);
  const latest = parsed[0];
  if (!latest) throw new SchemaError('India Post', 'India Post returned no usable tracking events');
  const classified = latest.classified.status === 'unknown'
    ? { status: 'in_transit' as const, stage: 'in_transit' }
    : latest.classified;
  return {
    status: classified.status,
    current_stage: classified.stage,
    last_status_text: latest.event.description,
    last_update: latest.event.time ?? null,
    expected_delivery: null,
    timezone: 'Asia/Kolkata',
    events: parsed.slice(0, 100).map((item) => item.event),
  };
}

function enumValue(value: unknown): string {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : '';
}

function parseTrackSnapshot(snapshot: string, trackingNumber: string): TrackComponent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot);
  } catch (error) {
    throw new SchemaError('India Post', 'India Post returned invalid Livewire state', { cause: error });
  }
  if (!isRecord(parsed) || !isRecord(parsed.data) || !isRecord(parsed.memo)
    || parsed.memo.name !== 'track-consignment') {
    throw new SchemaError('India Post', 'India Post returned invalid Livewire state');
  }
  const returned = clean(parsed.data.consignment_number, 64)
    .toLocaleUpperCase('en-US')
    .replace(/[\s.-]/g, '');
  if (returned !== trackingNumber) throw new SchemaError('India Post', 'India Post returned a different shipment');
  const status = enumValue(parsed.data.status);
  if (!status) throw new SchemaError('India Post', 'India Post returned an invalid tracking status');
  return { snapshot, data: parsed.data, status };
}

function initialTrackComponent(html: string, trackingNumber: string): TrackComponent {
  const $ = load(html);
  for (const element of $('[wire\\:snapshot]').toArray()) {
    const snapshot = $(element).attr('wire:snapshot');
    if (!snapshot) continue;
    try {
      const parsed: unknown = JSON.parse(snapshot);
      if (isRecord(parsed) && isRecord(parsed.memo) && parsed.memo.name === 'track-consignment') {
        return parseTrackSnapshot(snapshot, trackingNumber);
      }
    } catch {
      // A page can contain several unrelated Livewire components.
    }
  }
  throw new SchemaError('India Post', 'India Post did not return its tracking component');
}

function csrfToken(html: string): string {
  const token = clean(load(html)('meta[name="csrf-token"]').attr('content'), 512);
  if (!/^[A-Za-z0-9_-]{20,512}$/.test(token)) {
    throw new SchemaError('India Post', 'India Post did not issue a tracking session token');
  }
  return token;
}

function parseLivewireUpdate(payload: unknown, trackingNumber: string): LivewireUpdate {
  if (!isRecord(payload) || !Array.isArray(payload.components) || payload.components.length !== 1
    || !isRecord(payload.components[0])) {
    throw new SchemaError('India Post', 'India Post returned an invalid Livewire response');
  }
  const rawComponent = payload.components[0];
  if (typeof rawComponent.snapshot !== 'string') {
    throw new SchemaError('India Post', 'India Post returned an invalid Livewire response');
  }
  return {
    component: parseTrackSnapshot(rawComponent.snapshot, trackingNumber),
    effects: isRecord(rawComponent.effects) ? rawComponent.effects : {},
  };
}

function dispatchNames(effects: JsonObject): Set<string> {
  if (!Array.isArray(effects.dispatches)) return new Set();
  return new Set(
    effects.dispatches
      .filter(isRecord)
      .map((dispatch) => clean(dispatch.name, 100))
      .filter(Boolean),
  );
}

function challengePage(status: number, html: string, headers: Headers): boolean {
  return [401, 403, 419, 429].includes(status)
    || headers.get('cf-mitigated') === 'challenge'
    || /Just a moment|Enable JavaScript and cookies|cf-chl-|challenge-platform/i.test(html);
}

function pause(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

export class IndiaPostTracker {
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
  readonly maxPollAttempts: number;
  readonly fetcher: typeof fetch;

  constructor(options: IndiaPostTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
    this.fetcher = options.fetcher ?? fetch;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('India Post timeout must be positive');
    }
    if (!Number.isFinite(this.pollIntervalMs) || this.pollIntervalMs < 0) {
      throw new TypeError('India Post poll interval cannot be negative');
    }
    if (!Number.isInteger(this.maxPollAttempts) || this.maxPollAttempts < 1) {
      throw new TypeError('India Post poll attempts must be positive');
    }
  }

  private async request(
    fetcher: typeof fetch,
    url: string,
    init: RequestInit,
  ): Promise<{ bytes: Uint8Array; html: string }> {
    const result = await fetchBounded(url, init, {
      provider: 'India Post tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      redirect: 'manual',
      fetcher,
      allowHttpError: true,
    });
    const html = decodeText(result.bytes);
    if (challengePage(result.response.status, html, result.response.headers)) {
      throw new IndiaPostChallengeError();
    }
    if (!result.response.ok) {
      throw new UpstreamHttpError('India Post tracking', result.response.status);
    }
    return { bytes: result.bytes, html };
  }

  private async update(
    fetcher: typeof fetch,
    trackingNumber: string,
    pageUrl: string,
    token: string,
    snapshot: string,
    calls: JsonObject[],
    updates: JsonObject = {},
  ): Promise<LivewireUpdate> {
    const result = await this.request(fetcher, LIVEWIRE_UPDATE, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
        Origin: 'https://myspeedpost.com',
        Referer: pageUrl,
        'User-Agent': USER_AGENT,
        'X-Livewire': '',
      },
      body: JSON.stringify({
        _token: token,
        components: [{ snapshot, updates, calls }],
      }),
    });
    return parseLivewireUpdate(
      parseJsonBytes(result.bytes, 'India Post tracking'),
      trackingNumber,
    );
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const normalized = normalizeIndiaPostTrackingNumber(trackingNumber);
    const pageUrl = indiaPostTrackingUrl(normalized);
    // The Livewire flow is stateful: the session cookie issued with the page
    // must travel with every /livewire/update call, so the jar is per lookup.
    const fetcher = makeFetchCookie(this.fetcher, new CookieJar());
    const page = await this.request(fetcher, pageUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': USER_AGENT,
      },
    });
    const initial = initialTrackComponent(page.html, normalized);
    if (initial.status === 'Completed') {
      return parseIndiaPostTrackingHtml(page.html, normalized);
    }
    if (!['New', 'Processing'].includes(initial.status)) {
      throw new SchemaError('India Post', 'India Post returned an unsupported tracking state');
    }

    const token = csrfToken(page.html);
    let update = initial.status === 'Processing'
      ? await this.update(fetcher, normalized, pageUrl, token, initial.snapshot, [{
        path: '',
        method: 'fetchStatus',
        params: [],
      }])
      : await this.update(fetcher, normalized, pageUrl, token, initial.snapshot, [{
        path: '',
        method: '__dispatch',
        params: ['set_consignment_number', { consignment_number: normalized }],
      }, {
        path: '',
        method: 'submit',
        params: ['Europe/Zurich'],
      }], { userTimezone: 'Europe/Zurich' });

    for (let attempt = 0; attempt <= this.maxPollAttempts; attempt += 1) {
      const names = dispatchNames(update.effects);
      if (names.has('consignment_not_found')) throw new NotFoundError('India Post');
      if (update.component.status === 'Completed') {
        const html = typeof update.effects.html === 'string' ? update.effects.html : '';
        if (!html) throw new SchemaError('India Post', 'India Post returned an empty completed response');
        return parseIndiaPostTrackingHtml(html, normalized);
      }
      if (update.component.status !== 'Processing') {
        throw new SchemaError('India Post', 'India Post returned an unsupported tracking state');
      }
      if (attempt === this.maxPollAttempts) break;
      await pause(this.pollIntervalMs);
      update = await this.update(
        fetcher,
        normalized,
        pageUrl,
        token,
        update.component.snapshot,
        [{ path: '', method: 'fetchStatus', params: [] }],
      );
    }
    // The backend kept saying "Processing": it answered, but it proved nothing
    // about the shipment, so this must not become a not-found cooldown.
    throw new IndeterminateError('India Post', 'India Post tracking did not complete in time');
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new IndiaPostTracker({ fetcher: environment.fetcher });
  return {
    id: 'india-post',
    // The Livewire submit-and-poll cycle is part of the direct call: it is one
    // stateful conversation with one host, not a fallback tier.
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
