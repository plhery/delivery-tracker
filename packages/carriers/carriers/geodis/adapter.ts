/**
 * GEODIS: the anonymous recipient lookup behind espace-client.geodis.com.
 *
 * One bounded signed POST per lookup ('direct' step). The response describes the
 * whole consignment: sender and recipient blocks, addresses, per-scan
 * "complementary information" and links to delivery documents. `parse()` builds
 * its result from an allowlist of status, timeline and operational-location
 * fields, so none of that reaches the result or the logs.
 */
import 'server-only';

import { createHash } from 'node:crypto';
import type { AdapterFactory } from '../../core/adapter';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult, CarrierStatus } from '../../core/result';
import { clean, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { classifyStatus, comparableText, includesAny } from './status';

export { classifyStatus } from './status';

const PROVIDER = 'GEODIS';
const TRACKING_ENDPOINT =
  'https://espace-client.geodis.com/services/api/destinataire/recherche-envoi-anonyme';
const TRACKING_PAGE = 'https://espace-client.geodis.com/services/destinataires/';
const SIGNED_API_PATH = 'api/destinataire/recherche-envoi-anonyme';
const PUBLIC_SPA_APP_ID = '$DESTINATAIRE';
// This is a public client identifier shipped in GEODIS's anonymous recipient SPA,
// not an account credential. It can rotate when that SPA is deployed.
const PUBLIC_SPA_APP_KEY = '21aed7a2f03d45ab9cbcd61cd7a2461d'; // gitleaks:allow
const LANGUAGE = 'fr';
const TIMEZONE = 'Europe/Paris';
const MAX_RESPONSE_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_EVENTS_TO_RETURN = 100;

interface ParsedEvent {
  event: CarrierEvent;
  status: CarrierStatus;
  timestamp: number;
  index: number;
}

/**
 * The endpoint reports a calendar day per group and a wall clock per scan, both
 * as display strings and never with an offset. No `core/time` policy fits: the
 * displayed value is kept verbatim as the event time, and the number below is
 * only a sort key, built in UTC so ordering never shifts with a DST boundary.
 */
function dateTimestamp(value: string): number | null {
  let match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  let year: number;
  let month: number;
  let day: number;
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else {
    match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? timestamp
    : null;
}

function eventTime(dateValue: unknown, timeValue: unknown): { value: string; timestamp: number } | null {
  const date = clean(dateValue, 32);
  const timestamp = dateTimestamp(date);
  if (timestamp === null) return null;
  const clock = clean(timeValue, 16);
  if (!clock) return { value: date, timestamp };
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(clock);
  if (!match) return { value: date, timestamp };
  const withClock = timestamp
    + Number(match[1]) * 3_600_000
    + Number(match[2]) * 60_000
    + Number(match[3] ?? 0) * 1_000;
  return { value: `${date} ${clock}`, timestamp: withClock };
}

function expectedDelivery(value: unknown): string | null {
  const raw = clean(value, 32);
  const french = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const date = french
    ? `${french[3]}-${french[2]}-${french[1]}`
    : iso
      ? raw
      : '';
  return date && dateTimestamp(date) !== null ? date : null;
}

function parseEvents(content: JsonObject): ParsedEvent[] {
  if (!Array.isArray(content.listJoursSuivis)) return [];
  const parsed: ParsedEvent[] = [];
  const seen = new Set<string>();
  let index = 0;
  for (const rawDay of content.listJoursSuivis) {
    if (!isRecord(rawDay) || !Array.isArray(rawDay.suivis)) continue;
    for (const rawEvent of rawDay.suivis) {
      const currentIndex = index++;
      if (!isRecord(rawEvent)) continue;
      const time = eventTime(rawDay.dateSuivi, rawEvent.heureSuivi);
      const description = clean(rawEvent.libelleSuivi);
      if (!time || !description) continue;
      const location = clean(rawEvent.libelleCentre, 160);
      const identity = JSON.stringify([time.value, location, description]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const classified = classifyStatus(description);
      parsed.push({
        event: {
          time: time.value,
          location,
          description,
          // Unmapped wording carries no stage: the sync classifies and records it.
          ...(classified.stage ? { stage: classified.stage } : {}),
        },
        status: classified.status,
        timestamp: time.timestamp,
        index: currentIndex,
      });
    }
  }
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  return parsed.slice(0, MAX_EVENTS_TO_RETURN);
}

function activeTimelineLabel(content: JsonObject): string {
  if (!isRecord(content.timeline) || !Array.isArray(content.timeline.listTimesteps)) return '';
  for (const rawStep of content.timeline.listTimesteps) {
    if (isRecord(rawStep) && rawStep.actif === true) return clean(rawStep.libelle);
  }
  return '';
}

/**
 * Kept as a named class because the grouped live suite matches on its name. It
 * is a plain `NotFoundError`.
 */
export class GeodisTrackingError extends NotFoundError {
  constructor() {
    super(PROVIDER);
    this.name = 'GeodisTrackingError';
  }
}

function isNotFoundCode(value: unknown): boolean {
  const code = comparableText(clean(value, 100));
  return includesAny(code, ['envoi non trouve', 'shipment not found', 'tracking not found']);
}

export function normalizeGeodisTrackingNumber(raw: string): string {
  const trackingNumber = raw.trim().toLocaleUpperCase('en-US');
  if (!/^1G[A-Z0-9]{10}$/.test(trackingNumber)) {
    throw new TypeError('GEODIS tracking numbers must start with 1G and contain 12 letters and digits');
  }
  return trackingNumber;
}

export function geodisTrackingUrl(): string {
  return TRACKING_ENDPOINT;
}

export function geodisRequestBody(rawTrackingNumber: string): string {
  return JSON.stringify({ noSuivi: normalizeGeodisTrackingNumber(rawTrackingNumber) });
}

export function geodisServiceHeader(
  rawTrackingNumber: string,
  timestamp: number,
  language = LANGUAGE,
): string {
  const trackingNumber = normalizeGeodisTrackingNumber(rawTrackingNumber);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new TypeError('GEODIS signature timestamp must be a positive integer');
  }
  if (!/^[a-z]{2}$/.test(language)) throw new TypeError('GEODIS signature language is invalid');
  const body = geodisRequestBody(trackingNumber);
  const material = [
    PUBLIC_SPA_APP_KEY,
    PUBLIC_SPA_APP_ID,
    String(timestamp),
    language,
    SIGNED_API_PATH,
    body,
  ].join(';');
  const digest = createHash('sha256').update(material).digest('hex');
  return [PUBLIC_SPA_APP_ID, String(timestamp), language, digest].join(';');
}

export function parseGeodisTrackingResponse(
  payload: unknown,
  rawTrackingNumber: string,
): CarrierResult {
  const trackingNumber = normalizeGeodisTrackingNumber(rawTrackingNumber);
  if (!isRecord(payload) || typeof payload.ok !== 'boolean') {
    throw new SchemaError(PROVIDER, 'GEODIS returned an invalid tracking response');
  }
  if (!payload.ok) {
    if (isNotFoundCode(payload.codeErreur)) throw new GeodisTrackingError();
    // A rejection we cannot read proves nothing about the shipment.
    throw new IndeterminateError(PROVIDER, 'GEODIS tracking is unavailable');
  }
  if (!isRecord(payload.contenu)) {
    throw new SchemaError(PROVIDER, 'GEODIS returned incomplete tracking details');
  }
  const content = payload.contenu;
  const responseNumber = clean(content.noSuivi, 32).toLocaleUpperCase('en-US');
  if (!/^1G[A-Z0-9]{10}$/.test(responseNumber)) {
    throw new SchemaError(PROVIDER, 'GEODIS returned an invalid shipment number');
  }
  if (responseNumber !== trackingNumber) {
    throw new SchemaError(PROVIDER, 'GEODIS returned a different shipment');
  }

  const parsedEvents = parseEvents(content);
  const events = parsedEvents.map(({ event }) => event);
  const timelineLabel = activeTimelineLabel(content);
  const latestDescription = events[0]?.description ?? '';
  const currentDescription = timelineLabel || latestDescription || 'Tracking information received';
  const current = classifyStatus(currentDescription);
  const latestKnown = parsedEvents.find((event) => event.status !== 'unknown')?.status ?? 'unknown';
  let status = current.status !== 'unknown' ? current.status : latestKnown;
  if (content.etatLivre === true || content.etatRetire === true) status = 'delivered';
  else if (content.finDeVie === true && status !== 'delivered') status = 'exception';
  const isFinal = content.etatLivre === true
    || content.etatRetire === true
    || content.finDeVie === true;

  return {
    status,
    last_status_text: currentDescription,
    last_update: events[0]?.time ?? null,
    expected_delivery: isFinal
      ? null
      : expectedDelivery(content.dateLivraisonPrevue)
        ?? expectedDelivery(content.dateLivraisonSouhaitee),
    timezone: TIMEZONE,
    events,
  };
}

export interface GeodisTrackerOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

export class GeodisTracker {
  readonly timeoutMs: number;
  readonly #fetcher: typeof fetch | undefined;

  constructor(options: GeodisTrackerOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('GEODIS timeout must be positive');
    }
    this.#fetcher = options.fetcher;
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizeGeodisTrackingNumber(rawTrackingNumber);
    const body = geodisRequestBody(trackingNumber);
    const timestamp = Date.now();
    const { bytes } = await fetchBounded(geodisTrackingUrl(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'fr-FR,fr;q=0.9',
        'Content-Type': 'application/json',
        Origin: 'https://espace-client.geodis.com',
        Referer: TRACKING_PAGE,
        'User-Agent': 'Mozilla/5.0 (compatible; SwissDeliveryTracker/1.0)',
        'X-GEODIS-Service': geodisServiceHeader(trackingNumber, timestamp),
      },
      body,
    }, {
      provider: 'GEODIS tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      fetcher: this.#fetcher,
    });
    return parseGeodisTrackingResponse(parseJsonBytes(bytes, PROVIDER), trackingNumber);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new GeodisTracker({ fetcher: environment.fetcher });
  return {
    id: 'geodis',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
