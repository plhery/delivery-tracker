import 'server-only';

/**
 * Ciblex parcel tracking.
 *
 * The public extranet renders one server-side HTML page per 14-digit parcel
 * number: a banner that echoes the number it actually looked up, and a bordered
 * table of date / time / action / place rows. The echoed number is verified
 * before anything is read, so a page answering for another shipment can never
 * become this parcel's history.
 *
 * Privacy: the same page also carries customer and order blocks and, on
 * failure rows, the recipient address in the place column. `parse()` reads only
 * the four timeline cells, replaces the action wording with our own English
 * description, and keeps a place only when it matches the depot shape the
 * portal uses for operational sites.
 */
import { load } from 'cheerio';
import type { AdapterFactory } from '../../core/adapter';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult, CarrierStatus } from '../../core/result';
import { clean, decodeText, fetchBounded, UpstreamHttpError } from '../../core/transport';
import { zonedTime, type ParsedTime } from '../../core/time';
import { classifyCiblexStatus, comparableText } from './status';

const TRACKING_ENDPOINT = 'https://secure.extranet.ciblex.fr/extranet/client/corps.php';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 750_000;
const MAX_ROWS_TO_INSPECT = 500;
const MAX_EVENTS_TO_RETURN = 100;
const EVENT_TIME_FORMATS = ['dd/MM/yyyy HH:mm:ss', 'dd/MM/yyyy HH:mm', 'dd/MM/yyyy'];

interface ParsedEvent {
  event: CarrierEvent;
  status: CarrierStatus;
  timestamp: number;
  index: number;
}

/** The page prints naive French wall-clock values; the portal runs on Europe/Paris. */
function parseEventTime(rawDate: string, rawTime: string): ParsedTime | null {
  const value = `${clean(rawDate, 16)} ${clean(rawTime, 16)}`.trim();
  for (const format of EVENT_TIME_FORMATS) {
    const parsed = zonedTime(value, format, 'Europe/Paris');
    if (parsed) return parsed;
  }
  return null;
}

function safeLocation(value: string): string {
  const location = clean(value, 100);
  // The public page formats Ciblex depots as "CITY 68 (68)". Requiring the
  // same department code both before and inside parentheses keeps this field
  // to operational depots instead of forwarding a free-form recipient address.
  const match = /^([\p{Letter}\p{Mark} .'\/-]{1,70}) (\d{2,3}) \(\2\)$/u.exec(location);
  return match ? location : '';
}

export function normalizeCiblexTrackingNumber(raw: string): string {
  const trackingNumber = raw.replace(/\s/g, '');
  if (!/^\d{14}$/.test(trackingNumber)) {
    throw new TypeError('Ciblex tracking numbers must contain exactly 14 digits');
  }
  return trackingNumber;
}

export function ciblexTrackingUrl(rawTrackingNumber: string): string {
  const trackingNumber = normalizeCiblexTrackingNumber(rawTrackingNumber);
  const url = new URL(TRACKING_ENDPOINT);
  url.search = new URLSearchParams({ module: 'colis', colis: trackingNumber }).toString();
  return url.toString();
}

function responseTrackingNumber(page: ReturnType<typeof load>): string {
  for (const element of page('.t_bandeau_detail td').toArray()) {
    const match = /SUIVI\s+COLIS\s*:\s*(\d{14})/i.exec(clean(page(element).text(), 100));
    if (match) return match[1]!;
  }
  return '';
}

export function parseCiblexTrackingHtml(
  html: string,
  rawTrackingNumber: string,
): CarrierResult {
  const trackingNumber = normalizeCiblexTrackingNumber(rawTrackingNumber);
  // A valid unknown parcel normally returns an echoed empty table. A completely
  // empty 200 has also appeared transiently and proves nothing about the
  // shipment, so it stays an indeterminate upstream answer rather than a 404.
  if (!html.trim()) throw new IndeterminateError('Ciblex', 'Ciblex returned an empty tracking response');
  const $ = load(html);
  const returnedNumber = responseTrackingNumber($);
  if (!returnedNumber) {
    if ($('.f_erreur').length > 0) throw new NotFoundError('Ciblex');
    throw new SchemaError('Ciblex', 'Ciblex did not return a shipment identifier');
  }
  if (returnedNumber !== trackingNumber) {
    throw new SchemaError('Ciblex', 'Ciblex returned a different shipment');
  }

  const parsed: ParsedEvent[] = [];
  const seen = new Set<string>();
  $('table[border="2"] tr').slice(0, MAX_ROWS_TO_INSPECT).each((index, element) => {
    const cells = $(element).children('td').toArray().map((cell) => clean($(cell).text(), 200));
    if (cells.length !== 4 || comparableText(cells[0] ?? '') === 'date') return;
    const time = parseEventTime(cells[0] ?? '', cells[1] ?? '');
    const rawDescription = clean(cells[2], 200);
    if (!time || !rawDescription) return;
    const classified = classifyCiblexStatus(rawDescription);
    // Failure rows frequently describe recipient-address problems. Do not
    // retain their location cell even if it happens to resemble a depot.
    const location = classified.status === 'exception' ? '' : safeLocation(cells[3] ?? '');
    const identity = `${time.iso}\u0000${classified.stage}\u0000${location}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    parsed.push({
      event: {
        time: time.iso,
        location,
        description: classified.description,
        stage: classified.stage,
      },
      status: classified.status,
      timestamp: time.timestamp,
      index,
    });
  });
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const limited = parsed.slice(0, MAX_EVENTS_TO_RETURN);
  if (limited.length === 0) throw new NotFoundError('Ciblex');
  const latest = limited[0]!;
  const latestKnown = limited.find((item) => item.status !== 'unknown');
  return {
    status: latest.status !== 'unknown' ? latest.status : latestKnown?.status ?? 'unknown',
    current_stage: latest.status !== 'unknown'
      ? latest.event.stage ?? 'in_transit'
      : latestKnown?.event.stage ?? 'in_transit',
    last_status_text: latest.event.description ?? 'Tracking information received',
    last_update: latest.event.time ?? null,
    expected_delivery: null,
    timezone: 'Europe/Paris',
    events: limited.map(({ event }) => event),
  };
}

export interface CiblexTrackerOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

export class CiblexTracker {
  readonly timeoutMs: number;
  readonly fetcher?: typeof fetch;

  constructor(options: CiblexTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Ciblex timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizeCiblexTrackingNumber(rawTrackingNumber);
    const result = await fetchBounded(ciblexTrackingUrl(trackingNumber), {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        Referer: 'https://ciblex.eu/suivi-colis-express/',
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
      },
    }, {
      provider: 'Ciblex tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      fetcher: this.fetcher,
      allowHttpError: true,
    });
    if (result.response.status === 404) throw new NotFoundError('Ciblex');
    if (!result.response.ok) {
      throw new UpstreamHttpError('Ciblex tracking', result.response.status);
    }
    return parseCiblexTrackingHtml(decodeText(result.bytes), trackingNumber);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new CiblexTracker({ fetcher: environment.fetcher });
  return {
    id: 'ciblex',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
