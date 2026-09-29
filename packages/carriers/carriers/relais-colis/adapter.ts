import 'server-only';

import { load } from 'cheerio';
import { DateTime } from 'luxon';
import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';
import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { IndeterminateError, NotFoundError, SchemaError, TransportError } from '../../core/errors';
import type { CarrierEvent, CarrierResult, CarrierStatus } from '../../core/result';
import { clean, decodeText, fetchBounded, UpstreamHttpError, UpstreamNetworkError } from '../../core/transport';
import { calendarDay, zonedTime, type ParsedTime } from '../../core/time';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { classifyRelaisColisStatus, comparableText } from './status';

const TRACKING_PAGE = 'https://www.relaiscolis.com/colis/suivre';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 750_000;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0';

interface EventClock {
  instant: ParsedTime | null;
  local: string | null;
}

function eventClock(value: string): EventClock {
  const match = /^(\d{2})[/-](\d{2})[/-](\d{4})(?:\s+(?:à\s+)?(\d{1,2})[:h](\d{2}))?$/.exec(value);
  if (!match) return { instant: null, local: null };
  const day = calendarDay(Number(match[3]), Number(match[2]), Number(match[1]));
  if (!day) return { instant: null, local: null };
  if (!match[4]) return { instant: null, local: day };
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) return { instant: null, local: null };
  const local = `${day}T${String(hour).padStart(2, '0')}:${match[5]}:00`;
  const instant = zonedTime(local, "yyyy-MM-dd'T'HH:mm:ss", 'Europe/Paris');
  // A nonexistent civil clock can be normalized across a DST transition.
  const uniqueOffset = DateTime.fromISO(local, { zone: 'Europe/Paris' }).getPossibleOffsets().length === 1;
  return { instant: instant?.iso.startsWith(local) && uniqueOffset ? instant : null, local };
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
  const banners = page('.back-subedtext--sub').filter((_, element) => (
    page(element).siblings('.back-subedtext').toArray().some((label) => comparableText(page(label).text()) === 'votre colis')
  )).map((_, element) => clean(page(element).text(), 32)).get();
  // A prefilled form alone cannot bind history from a successful response.
  if (page('.follow-step').length && banners.length !== 1) return '';
  if (banners.length > 1) return '';
  // Successful pages clear the search field and identify the parcel in a banner.
  const fields = [clean(page('#track_package_trackingNumber').first().attr('value'), 32)];
  const values = [...new Set([...banners, ...fields].filter(Boolean))];
  if (values.length !== 1) return '';
  try { return normalizeRelaisColisTrackingNumber(values[0]!); } catch { return ''; }
}

export function parseRelaisColisTrackingHtml(html: string, rawTrackingNumber: string): CarrierResult {
  const trackingNumber = normalizeRelaisColisTrackingNumber(rawTrackingNumber);
  if (!html.trim()) throw new IndeterminateError('Relais Colis', 'Relais Colis returned an empty tracking response');
  const $ = load(html);
  $('.follow-address, .follow-address-box, [data-recipient], [data-delivery-address], script, style, noscript').remove();
  const errorText = comparableText($('.field-error, .follow-text--error, .error').text());
  if (errorText.includes('jeton csrf est invalide')) {
    throw new IndeterminateError('Relais Colis', 'Relais Colis rejected the tracking session');
  }
  const returnedNumber = responseTrackingNumber($);
  if (!returnedNumber) throw new SchemaError('Relais Colis', 'Relais Colis did not return a shipment identifier');
  if (returnedNumber !== trackingNumber) throw new SchemaError('Relais Colis', 'Relais Colis returned a different shipment');
  if (errorText && !$('.follow-step').length) {
    if (errorText === 'aucune donnee de suivi pour votre colis veuillez reessayer plus tard') throw new RelaisColisTrackingError();
    throw new IndeterminateError('Relais Colis', 'Relais Colis returned an unrecognized form error');
  }

  const parsed: Array<{ event: CarrierEvent; status: CarrierStatus; local: string | null }> = [];
  const seen = new Set<string>();
  const add = (description: string, time: string) => {
    if (!description) throw new SchemaError('Relais Colis', 'Relais Colis returned a scan without a status');
    const identity = `${time}\u0000${description}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const clock = eventClock(time);
    const classified = classifyRelaisColisStatus(description);
    if (parsed.length >= 500) throw new SchemaError('Relais Colis', 'Relais Colis returned excessive tracking history');
    parsed.push({ event: {
      ...(clock.instant ? { time: clock.instant.iso } : clock.local ? { local_time: clock.local } : {}),
      ...(!clock.instant && time ? { provider_time_text: time } : {}),
      location: '', description, stage: classified.stage,
    }, status: classified.status, local: clock.instant ? null : clock.local });
  };
  if ($('.follow-step').length > 250) throw new SchemaError('Relais Colis', 'Relais Colis returned excessive tracking history');
  $('.follow-step').each((_, element) => {
    const row = $(element);
    const heading = clean(row.find('.follow-step-text').first().text());
    const groups = row.find('.box').filter((_, box) => $(box).children('.follow-step-date').length > 0);
    if (groups.length) {
      groups.each((_, box) => {
        const values = $(box).children('.follow-step-date');
        if (values.length !== 2 || !clean(values.eq(1).text())) throw new SchemaError('Relais Colis', 'Relais Colis returned an ambiguous scan group');
        add(clean(values.eq(1).text()), clean(values.eq(0).text(), 64));
      });
    } else {
      add(heading, clean(row.find('.follow-step-date').first().text(), 64));
    }
  });
  const limited = parsed.slice(0, 100);
  const latest = limited[0];
  if (!latest) throw new SchemaError('Relais Colis', 'Relais Colis did not return tracking history');
  // Both groups and scans are displayed newest first. Unresolved current clocks
  // and unfamiliar current wording must not borrow an older delivery's state.
  return { status: latest.status, last_status_text: latest.event.description,
    last_update: latest.event.time ?? null, ...(latest.local ? { last_update_local: latest.local } : {}),
    expected_delivery: null, timezone: 'Europe/Paris', events: limited.map(({ event }) => event) };
}

function csrfToken(html: string): string {
  const token = clean(load(html)('#track_package__token').first().attr('value'), 512);
  if (!token) throw new SchemaError('Relais Colis', 'Relais Colis did not return a CSRF token');
  return token;
}

function responseError(provider: string, status: number): Error {
  const cause = new UpstreamHttpError(provider, status);
  return [404, 410].includes(status)
    ? new TransportError('Relais Colis', 'Relais Colis tracking page is unavailable', { status, cause }) : cause;
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
  recorder?: StepRecorder;
}

export class RelaisColisTracker {
  readonly timeoutMs: number;
  readonly fetcher?: typeof fetch;
  readonly recorder: StepRecorder;

  constructor(options: RelaisColisTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
    this.recorder = options.recorder ?? NOOP_RECORDER;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Relais Colis timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const trackingNumber = normalizeRelaisColisTrackingNumber(rawTrackingNumber);
    return runSteps({ carrier: 'relais-colis', budgetMs: context.budgetMs ?? this.timeoutMs,
      signal: context.signal, recorder: this.recorder }, [{ id: 'direct', run: async ({ signal, remainingMs }) => {
      try {
        // One cookie jar per lookup: the CSRF token is bound to the session it was
        // issued for, and nothing is shared between concurrent lookups.
        const sessionFetch = makeFetchCookie(this.fetcher ?? fetch, new CookieJar());
        const bootstrap = await fetchBounded(TRACKING_PAGE, {
          headers: pageHeaders(), signal,
        }, {
          provider: 'Relais Colis tracking page',
          timeoutMs: Math.max(1, Math.floor(remainingMs)),
          maxBytes: MAX_RESPONSE_BYTES,
          redirect: 'manual',
          fetcher: sessionFetch,
          allowHttpError: true,
        });
        if (!bootstrap.response.ok) {
          throw responseError('Relais Colis tracking page', bootstrap.response.status);
        }

        const body = new URLSearchParams({
          'track_package[trackingNumber]': trackingNumber,
          'track_package[searchPackage]': '',
          'track_package[_token]': csrfToken(decodeText(bootstrap.bytes)),
        });
        const result = await fetchBounded(TRACKING_PAGE, {
          method: 'POST', signal,
          headers: {
            ...pageHeaders(),
            'Content-Type': 'application/x-www-form-urlencoded',
            Origin: 'https://www.relaiscolis.com',
            Referer: TRACKING_PAGE,
          },
          body,
        }, {
          provider: 'Relais Colis tracking',
          timeoutMs: Math.max(1, Math.floor(remainingMs)),
          maxBytes: MAX_RESPONSE_BYTES,
          redirect: 'manual',
          fetcher: sessionFetch,
          allowHttpError: true,
        });

        if (!result.response.ok) {
          throw responseError('Relais Colis tracking', result.response.status);
        }
        const parsed = parseRelaisColisTrackingHtml(decodeText(result.bytes), trackingNumber);
        parsed.tracking_url = TRACKING_PAGE;
        parsed.tracking_source = 'rendered-page';
        return parsed;
      } catch (error) {
        // Session cookies and the posted token must not survive as diagnostics.
        if (error instanceof UpstreamNetworkError) throw new UpstreamNetworkError(error.provider, error.cause);
        throw error;
      }
    } }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new RelaisColisTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return {
    id: 'relais-colis',
    steps: ['direct'],
    track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeRelaisColisTrackingNumber(number))),
  };
};
