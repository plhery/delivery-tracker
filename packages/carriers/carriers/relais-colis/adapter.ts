import 'server-only';

/**
 * Relais Colis recipient tracking.
 *
 * The public form is a Symfony page with a per-session CSRF token, so one
 * lookup is two bounded requests over a private cookie jar: GET the form to
 * pick up the session cookie and the `track_package[_token]` value, then POST
 * the number back to the same URL. The jar lives for that lookup only, so two
 * concurrent lookups can never share or refresh one another's token and no
 * single-flight gate is needed.
 *
 * The rendered page echoes the number it searched in the form field; that value
 * is verified before any step is read. A redirect or an error block without
 * steps is the network's way of saying it does not know the parcel.
 *
 * Privacy: the same page shows the recipient's name, delivery address and the
 * pickup point's details. Those blocks are removed from the document before any
 * text is read, and each event keeps only the step's own sentence, its date and
 * the mapped stage.
 */
import { load } from 'cheerio';
import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import type { AdapterFactory } from '../../core/adapter';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult, CarrierStatus } from '../../core/result';
import { clean, decodeText, fetchBounded, UpstreamHttpError } from '../../core/transport';
import { zonedTime, type ParsedTime } from '../../core/time';
import { classifyRelaisColisStatus } from './status';

const TRACKING_PAGE = 'https://www.relaiscolis.com/colis/suivre';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 750_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0';
const EVENT_TIME_FORMATS = ['dd/MM/yyyy HH:mm', 'dd/MM/yyyy'];

interface ParsedEvent {
  event: CarrierEvent;
  status: CarrierStatus;
  timestamp: number;
  index: number;
}

/**
 * The page prints "29/08/2026 à 14:20" or "29/08/2026 14h20"; both are naive
 * French wall-clock values, so they are read in Europe/Paris.
 */
function parsedEventTime(value: string): ParsedTime | null {
  const normalized = value.replace(/\s+(?:a|à)\s+/i, ' ').replace(/(\d{1,2})h(\d{2})/i, '$1:$2');
  for (const format of EVENT_TIME_FORMATS) {
    const parsed = zonedTime(normalized, format, 'Europe/Paris');
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Kept so the grouped live canary and existing host callers can still match
 * this name; the taxonomy kind is `not_found` like any other missing shipment.
 */
export class RelaisColisTrackingError extends NotFoundError {
  constructor() {
    super('Relais Colis');
    this.name = 'RelaisColisTrackingError';
  }
}

export function normalizeRelaisColisTrackingNumber(raw: string): string {
  const trackingNumber = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^[A-Z0-9]{10,16}$/.test(trackingNumber) || !/\d/.test(trackingNumber)) {
    throw new TypeError('Relais Colis tracking numbers must contain 10 to 16 letters and digits');
  }
  return trackingNumber;
}

export function relaisColisTrackingUrl(): string {
  return TRACKING_PAGE;
}

function responseTrackingNumber(page: ReturnType<typeof load>): string {
  const value = clean(page('#track_package_trackingNumber').first().attr('value'), 32);
  if (!value) return '';
  try {
    return normalizeRelaisColisTrackingNumber(value);
  } catch {
    return '';
  }
}

export function parseRelaisColisTrackingHtml(
  html: string,
  rawTrackingNumber: string,
): CarrierResult {
  const trackingNumber = normalizeRelaisColisTrackingNumber(rawTrackingNumber);
  // An empty body proves nothing about the shipment, so it stays indeterminate.
  if (!html.trim()) {
    throw new IndeterminateError('Relais Colis', 'Relais Colis returned an empty tracking response');
  }

  const $ = load(html);
  const returnedNumber = responseTrackingNumber($);
  if (!returnedNumber) {
    throw new SchemaError('Relais Colis', 'Relais Colis did not return a shipment identifier');
  }
  if (returnedNumber !== trackingNumber) {
    throw new SchemaError('Relais Colis', 'Relais Colis returned a different shipment');
  }

  // These blocks can contain the recipient, delivery address, phone number and
  // pickup-point details. Remove them before reading any response text, and emit
  // only the provider's status/date fields below.
  $('.follow-address, .follow-address-box, [data-recipient], [data-delivery-address]').remove();
  $('script, style, noscript').remove();

  const errorText = clean(
    $('.field-error, .follow-text--error, .error').first().text(),
  );
  if (errorText && $('.follow-step').length === 0) throw new RelaisColisTrackingError();

  const parsedEvents: ParsedEvent[] = [];
  const seen = new Set<string>();
  $('.follow-step').slice(0, 250).each((index, element) => {
    const row = $(element);
    const description = clean(row.find('.follow-step-text').first().text());
    const time = clean(row.find('.follow-step-date').first().text(), 64);
    const parsedTime = parsedEventTime(time);
    if (!description || !parsedTime) return;
    const identity = `${time}\u0000${description}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const classified = classifyRelaisColisStatus(description);
    parsedEvents.push({
      event: {
        time: parsedTime.iso,
        location: '',
        description,
        stage: classified.stage,
      },
      status: classified.status,
      timestamp: parsedTime.timestamp,
      index,
    });
  });
  parsedEvents.sort((left, right) => (
    right.timestamp - left.timestamp || left.index - right.index
  ));
  const limitedEvents = parsedEvents.slice(0, 100);
  const events = limitedEvents.map(({ event }) => event);
  if (events.length === 0) {
    throw new SchemaError('Relais Colis', 'Relais Colis did not return tracking history');
  }

  const latest = limitedEvents[0]!;
  const latestKnown = limitedEvents.find((item) => item.status !== 'unknown');
  return {
    status: latest.status !== 'unknown' ? latest.status : latestKnown?.status ?? 'unknown',
    last_status_text: latest.event.description ?? 'Tracking information received',
    last_update: latest.event.time ?? null,
    expected_delivery: null,
    timezone: 'Europe/Paris',
    events,
  };
}

function csrfToken(html: string): string {
  const token = clean(load(html)('#track_package__token').first().attr('value'), 512);
  if (!token) throw new SchemaError('Relais Colis', 'Relais Colis did not return a CSRF token');
  return token;
}

function pageHeaders(): Record<string, string> {
  return {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9',
    'User-Agent': USER_AGENT,
  };
}

export interface RelaisColisTrackerOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

export class RelaisColisTracker {
  readonly timeoutMs: number;
  readonly fetcher?: typeof fetch;

  constructor(options: RelaisColisTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Relais Colis timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizeRelaisColisTrackingNumber(rawTrackingNumber);
    // One cookie jar per lookup: the CSRF token is bound to the session it was
    // issued for, and nothing is shared between concurrent lookups.
    const sessionFetch = makeFetchCookie(this.fetcher ?? fetch, new CookieJar());
    const bootstrap = await fetchBounded(TRACKING_PAGE, {
      headers: pageHeaders(),
    }, {
      provider: 'Relais Colis tracking page',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      redirect: 'manual',
      fetcher: sessionFetch,
      allowHttpError: true,
    });
    if (!bootstrap.response.ok) {
      throw new UpstreamHttpError('Relais Colis tracking page', bootstrap.response.status);
    }

    const body = new URLSearchParams({
      'track_package[trackingNumber]': trackingNumber,
      'track_package[searchPackage]': '',
      'track_package[_token]': csrfToken(decodeText(bootstrap.bytes)),
    });
    const result = await fetchBounded(TRACKING_PAGE, {
      method: 'POST',
      headers: {
        ...pageHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://www.relaiscolis.com',
        Referer: TRACKING_PAGE,
      },
      body,
    }, {
      provider: 'Relais Colis tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      redirect: 'manual',
      fetcher: sessionFetch,
      allowHttpError: true,
    });

    if ([301, 302, 303, 307, 308, 404].includes(result.response.status)) {
      throw new RelaisColisTrackingError();
    }
    if (!result.response.ok) {
      throw new UpstreamHttpError('Relais Colis tracking', result.response.status);
    }
    const parsed = parseRelaisColisTrackingHtml(decodeText(result.bytes), trackingNumber);
    parsed.tracking_url = TRACKING_PAGE;
    parsed.tracking_source = 'rendered-page';
    return parsed;
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new RelaisColisTracker({ fetcher: environment.fetcher });
  return {
    id: 'relais-colis',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
