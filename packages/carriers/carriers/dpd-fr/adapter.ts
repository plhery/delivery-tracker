import 'server-only';

import { load } from 'cheerio';
import type { AdapterFactory } from '../../core/adapter';
import { ChallengeError, IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult, CarrierStatus } from '../../core/result';
import { runSteps } from '../../core/runner';
import type { StepRecorder } from '../../core/telemetry';
import { zonedTime } from '../../core/time';
import { TrawlClient, clean, decodeText, fetchBounded } from '../../core/transport';
import { classifyStatus, comparableText, includesAny } from './status';

// Protocol provenance:
// - DPD France publishes a server-rendered recipient page rather than a
//   reusable JSON feed, so the timeline is read out of `#tableTrace`: one row
//   per scan, four cells (date, clock, wording, operational location), plus a
//   details block per leg (`#infos1` outbound, `#infos2` return).
// - One page can describe two parcels: an outbound number and its return
//   number. The requested number decides which leg is read; the other leg's
//   rows never enter the result.
// - Cloudflare normally challenges anonymous direct requests, so the page is
//   fetched directly first and through the private browser service's native
//   scrape API when that request is challenged.
const TRACKING_BASE = 'https://trace.dpd.fr/fr/trace';
const TIMEZONE = 'Europe/Paris';
const DEFAULT_TIMEOUT_MS = 90_000;
const DIRECT_TIMEOUT_MS = 20_000;
/** The browser service keeps its own transport allowance on top of this budget. */
const SOLVER_ALLOWANCE_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_EVENTS_TO_INSPECT = 500;
const MAX_EVENTS_TO_RETURN = 100;

/** Cloudflare interrupted the trace page with an interactive challenge. */
export class DPDFranceChallengeError extends ChallengeError {
  constructor(message = 'DPD France returned a Cloudflare browser challenge') {
    super('DPD France', message);
    this.name = 'DPDFranceChallengeError';
  }
}

/** DPD France positively reports that it does not know the parcel number. */
export class DPDFranceTrackingError extends NotFoundError {
  constructor() {
    super('DPD France', 'DPD France could not locate the shipment');
    this.name = 'DPDFranceTrackingError';
  }
}

function challenged(status: number, headers: Headers, html: string): boolean {
  return (status === 403 && headers.get('cf-mitigated') === 'challenge')
    || /Just a moment|Performing security verification|Enable JavaScript and cookies/i.test(html);
}

/** Trace rows carry naive Paris wall-clock times in two separate cells. */
function parsedEventTime(date: string, clock: string): { iso: string; timestamp: number } | null {
  return zonedTime(`${date} ${clock}`, 'dd/MM/yyyy HH:mm', TIMEZONE);
}

/** The details block prints a plain calendar day; only the day is retained. */
function expectedDeliveryDate(value: string): string | null {
  const parsed = zonedTime(value, 'dd/MM/yyyy', TIMEZONE, { maxLength: 32 });
  return parsed ? parsed.iso.slice(0, 10) : null;
}

export function normalizeDPDFranceTrackingNumber(raw: string): string {
  const value = raw.replace(/[\s.-]/g, '');
  if (!/^(?:[01]\d{11,14}|250\d{9,12})$/.test(value)) {
    throw new TypeError(
      'DPD France tracking numbers must start with 0, 1, or 250 and contain 12 to 15 digits',
    );
  }
  return value;
}

export function dpdFranceTrackingUrl(raw: string): string {
  const number = normalizeDPDFranceTrackingNumber(raw);
  return `${TRACKING_BASE}/${encodeURIComponent(number)}`;
}

export function parseDPDFranceTrackingHtml(html: string, rawTrackingNumber: string): CarrierResult {
  const trackingNumber = normalizeDPDFranceTrackingNumber(rawTrackingNumber);
  if (!html.trim()) throw new SchemaError('DPD France', 'DPD France returned an empty tracking response');
  if (/Just a moment|Performing security verification|Enable JavaScript and cookies/i.test(html)) {
    throw new DPDFranceChallengeError();
  }

  const $ = load(html);
  const displayedNumbers = (selector: string) => $(selector).map((_, element) => (
    clean($(element).text(), 64).replace(/\D/g, '')
  )).get().filter(Boolean);
  const detailsNumbers = (selector: string) => $(`${selector} .tableInfosAR`).map((_, element) => {
    const row = $(element);
    return comparableText(row.find('strong').text()) === 'n colis'
      ? clean(row.find('.tdInfos').text(), 64).replace(/\D/g, '')
      : '';
  }).get().filter(Boolean);
  const outboundNumbers = [
    ...displayedNumbers('.parcelNumberAller'),
    ...detailsNumbers('#infos1'),
  ];
  const returnNumbers = [
    ...displayedNumbers('.parcelNumberRetour'),
    ...detailsNumbers('#infos2'),
  ];
  const responseNumbers = [...new Set([...outboundNumbers, ...returnNumbers])];

  if (responseNumbers.length === 0) {
    if (/pas en mesure de retrouver le num[eé]ro de colis|num[eé]ro de colis inconnu/i.test(html)) {
      throw new DPDFranceTrackingError();
    }
    throw new SchemaError('DPD France', 'DPD France did not return tracking details');
  }
  if (!responseNumbers.includes(trackingNumber)) {
    throw new SchemaError('DPD France', 'DPD France returned a different shipment');
  }
  const isReturn = !outboundNumbers.includes(trackingNumber) && returnNumbers.includes(trackingNumber);
  const eventSelector = isReturn
    ? '#tableTrace tr.tabTraceColisRetour'
    : '#tableTrace tr.tabTraceColisAller';
  const detailsSelector = isReturn ? '#infos2' : '#infos1';

  const parsedEvents: Array<{
    event: CarrierEvent;
    status: CarrierStatus;
    timestamp: number;
    sourceIndex: number;
  }> = [];
  const seen = new Set<string>();
  $(eventSelector).slice(0, MAX_EVENTS_TO_INSPECT).each((sourceIndex, element) => {
    const row = $(element);
    const cells = row.children('td');
    const date = clean(cells.eq(0).text(), 32);
    const clock = clean(cells.eq(1).text(), 32);
    const description = clean(cells.eq(2).text());
    const location = clean(cells.eq(3).text());
    const time = parsedEventTime(date, clock);
    if (!time || !description) return;
    const identity = JSON.stringify([time.iso, location, description]);
    if (seen.has(identity)) return;
    seen.add(identity);
    const classified = classifyStatus(description);
    // Wording the map does not recognize carries no stage: the sync's
    // classifier decides, and the row still stays visible in the history.
    const mapped = classified.status !== 'unknown';
    parsedEvents.push({
      event: {
        time: time.iso,
        location,
        description,
        ...(mapped ? { stage: classified.stage } : {}),
      },
      status: classified.status,
      timestamp: time.timestamp,
      sourceIndex,
    });
  });
  parsedEvents.sort((left, right) => (
    right.timestamp - left.timestamp || left.sourceIndex - right.sourceIndex
  ));
  const events = parsedEvents.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);
  const latest = parsedEvents.find((event) => event.status !== 'unknown');
  const status = latest?.status ?? 'unknown';
  const lastStatusText = events[0]?.description ?? 'Tracking information received';

  let expectedDelivery: string | null = null;
  $(`${detailsSelector} .tableInfosAR`).each((_, element) => {
    if (expectedDelivery) return;
    const row = $(element);
    const label = comparableText(row.find('strong').text());
    if (includesAny(label, ['livraison prevue', 'date de livraison prevue'])) {
      expectedDelivery = expectedDeliveryDate(row.find('.tdInfos').text());
    }
  });

  return {
    status,
    last_status_text: lastStatusText,
    last_update: events[0]?.time ?? null,
    expected_delivery: ['delivered', 'exception'].includes(status) ? null : expectedDelivery,
    timezone: TIMEZONE,
    events,
  };
}

export interface DPDFranceTrackerOptions {
  timeoutMs?: number;
  directTimeoutMs?: number;
  /** Whole-lookup budget; defaults to both tiers plus the solver's own allowance. */
  budgetMs?: number;
  /** Legacy configuration seam kept for tests; production passes `trawl`. */
  trawlUrl?: string;
  fetcher?: typeof fetch;
  trawl?: TrawlClient | null;
  recorder?: StepRecorder;
}

export class DPDFranceTracker {
  readonly timeoutMs: number;
  readonly directTimeoutMs: number;
  readonly budgetMs: number;
  readonly trawlUrl: string;
  private readonly fetcher?: typeof fetch;
  private readonly configuredTrawl?: TrawlClient | null;
  private readonly recorder?: StepRecorder;

  constructor(options: DPDFranceTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.directTimeoutMs = Math.max(1_000, Math.min(
      this.timeoutMs,
      options.directTimeoutMs ?? DIRECT_TIMEOUT_MS,
    ));
    this.budgetMs = options.budgetMs
      ?? this.directTimeoutMs + this.timeoutMs + SOLVER_ALLOWANCE_MS;
    this.trawlUrl = (options.trawlUrl ?? process.env.FLARESOLVERR_URL ?? '').trim();
    this.fetcher = options.fetcher;
    this.configuredTrawl = options.trawl;
    this.recorder = options.recorder;
  }

  /** The browser service, resolved late so a malformed URL fails the tier, not construction. */
  private browserService(): TrawlClient | null {
    if (this.configuredTrawl !== undefined) return this.configuredTrawl;
    return this.trawlUrl ? new TrawlClient(this.trawlUrl, this.fetcher) : null;
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const number = normalizeDPDFranceTrackingNumber(rawTrackingNumber);
    const url = dpdFranceTrackingUrl(number);
    const trawl = this.browserService();
    const html = await runSteps<string>({
      carrier: 'dpd-fr', budgetMs: this.budgetMs, recorder: this.recorder,
    }, [
      {
        id: 'direct',
        run: async () => {
          try {
            return await this.directGet(url);
          } catch (error) {
            // Without a browser service there is no second tier, so the
            // challenge has to carry the operator's next step itself.
            if (trawl || !(error instanceof DPDFranceChallengeError)) throw error;
            throw new DPDFranceChallengeError(
              'DPD France requires a browser challenge solver; configure FLARESOLVERR_URL',
            );
          }
        },
      },
      {
        id: 'trawl',
        enabled: trawl !== null,
        recovers: (error) => error instanceof DPDFranceChallengeError,
        run: async () => (await trawl!.scrape({
          url,
          skipHttp: true,
          maxTier: 3,
          maxTimeout: this.timeoutMs,
        }, {
          provider: 'TRAWL while fetching DPD France',
          timeoutMs: this.timeoutMs,
          maxBytes: MAX_RESPONSE_BYTES,
          fetcher: this.fetcher,
        })).html,
      },
    ]);
    const result = parseDPDFranceTrackingHtml(html, number);
    result.tracking_url = url;
    result.tracking_source = 'rendered-page';
    return result;
  }

  private async directGet(url: string): Promise<string> {
    const result = await fetchBounded(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      },
    }, {
      provider: 'DPD France tracking',
      timeoutMs: this.directTimeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      redirect: 'follow',
      allowHttpError: true,
      fetcher: this.fetcher,
    });
    const html = decodeText(result.bytes);
    if (challenged(result.response.status, result.response.headers, html)) {
      throw new DPDFranceChallengeError();
    }
    if (!result.response.ok) {
      throw new IndeterminateError('DPD France', `DPD France tracking returned HTTP ${result.response.status}`);
    }
    return html;
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new DPDFranceTracker({
    fetcher: environment.fetcher,
    trawl: environment.trawl,
    recorder: environment.recorder,
  });
  return {
    id: 'dpd-fr',
    // One direct HTML GET, then the browser service's native scrape API when
    // Cloudflare challenges it.
    steps: ['direct', 'trawl'],
    track: (input) => tracker.fetch(input.number),
  };
};
