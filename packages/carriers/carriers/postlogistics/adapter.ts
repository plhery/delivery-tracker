import 'server-only';

/**
 * PostLogistics tracking.
 *
 * The public tracker at `tracking.postlogistics.ch` posts the identifier to
 * `eosapi.postlogistics.ch/api/trackandtrace/public`. The response says what
 * the identifier was:
 *
 * - `Type` 1: a barcode. The answer may contain several shipments, so only the
 *   one whose `Identifier` equals the requested barcode is read.
 * - `Type` 2: a customer reference that resolved to one or more barcodes.
 *   Shippers reuse references, so only the one current consignment among them
 *   is merged; an answer without one is a not-found (`referenceConsignment`).
 * - `Type` 3: a Swiss Post parcel barcode PostLogistics does not hold. The
 *   endpoint relays Swiss Post's own scans (placeholder `PST` codes, no place),
 *   so the parcel is Swiss Post's: once the echo matches, this is a not-found
 *   and routing asks the Swiss Post adapter instead.
 *
 * Any other type is refused rather than guessed at. A `Data: null` answer is
 * PostLogistics' explicit "unknown identifier".
 */
import type { AdapterFactory, Recognition } from '../../core/adapter';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { referenceConsignment } from '../swiss-post-cargo/reference';
import { postlogisticsIdentifier } from './number';
import { postlogisticsStatus } from './status';

const PROVIDER = 'PostLogistics';
const UPSTREAM = 'PostLogistics tracking';
const TRACK_URL = 'https://eosapi.postlogistics.ch/api/trackandtrace/public?culture=fr-FR';
const DEFAULT_TIMEOUT_MS = 15_000;
const BASE_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (compatible; SwissDeliveryTracker/1.0)',
};

function record(value: unknown): JsonObject {
  return isRecord(value) ? value : {};
}

function recordArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function comparableIdentifier(value: unknown): string {
  return text(value).toLocaleUpperCase('en-US').replace(/[^A-Z0-9]/g, '');
}

/** Projects one track-and-trace payload. Pure: the offline tests target this. */
export function parsePostlogisticsTrackingResponse(value: unknown, trackingNumber: string, now = Date.now()): CarrierResult {
  const payload = record(value);
  if (payload.Data === null) throw new NotFoundError(PROVIDER);
  if (!Array.isArray(payload.Data)) {
    throw new SchemaError(PROVIDER, 'PostLogistics returned an invalid tracking response');
  }
  const items = recordArray(payload.Data);
  if (items.length !== payload.Data.length) {
    throw new SchemaError(PROVIDER, 'PostLogistics returned an invalid shipment entry');
  }
  if (items.length === 0) throw new SchemaError(PROVIDER, 'PostLogistics did not return a shipment entry');
  const responseType = Number(payload.Type);
  if (responseType !== 1 && responseType !== 2 && responseType !== 3) {
    throw new SchemaError(PROVIDER, 'PostLogistics returned an invalid tracking response type');
  }
  const identified = items.filter((candidate) => comparableIdentifier(candidate.Identifier));
  if (identified.length === 0) {
    throw new SchemaError(PROVIDER, 'PostLogistics did not return a shipment identifier');
  }
  let shipments = identified;
  if (responseType !== 2) {
    const requested = comparableIdentifier(trackingNumber);
    shipments = identified.filter(
      (candidate) => comparableIdentifier(candidate.Identifier) === requested,
    );
    if (shipments.length === 0) {
      throw new SchemaError(PROVIDER, 'PostLogistics returned a different shipment');
    }
  }
  if (responseType === 3) {
    throw new NotFoundError(PROVIDER, 'PostLogistics only relays Swiss Post tracking for this barcode');
  }
  if (responseType === 2) {
    shipments = referenceConsignment(shipments, (shipment) => recordArray(shipment.History)
      .map((event) => Date.parse(text(event.TimeStamp))), PROVIDER, now);
  }
  const history = shipments.flatMap((shipment) => recordArray(shipment.History));
  // Merged references interleave several barcodes, so order by absolute
  // instant and keep the provider's order for entries that share one.
  const orderedHistory = history.map((event, index) => {
    const rawTimestamp = text(event.TimeStamp);
    const parsedTimestamp = Date.parse(rawTimestamp);
    return {
      event,
      index,
      timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : Number.NEGATIVE_INFINITY,
    };
  }).sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const events = orderedHistory.map(({ event }): CarrierEvent => ({
    time: text(event.TimeStamp),
    location: text(event.City),
    description: text(event.Description),
  }));
  const latest = orderedHistory[0]?.event ?? {};
  const latestStatus = text(latest.Status);
  const eta = shipments.map((shipment) => record(shipment.DriveAndArrive))
    .map((drive) => text(drive.PlannedDeliveryDate) || text(drive.EstimatedArrival))
    .find(Boolean) ?? '';
  return {
    status: postlogisticsStatus(latestStatus),
    last_status_text: text(latest.Description) || latestStatus,
    last_update: text(latest.TimeStamp) || null,
    expected_delivery: eta ? eta.slice(0, 10) : null,
    events,
  };
}

export class PostlogisticsTracker {
  private readonly fetcher: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(options: { fetcher?: typeof fetch; timeoutMs?: number; now?: () => number } = {}) {
    this.fetcher = options.fetcher;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const dashed = postlogisticsIdentifier(trackingNumber);
    const identifiers = dashed === trackingNumber ? [trackingNumber] : [trackingNumber, dashed];
    const signal = AbortSignal.timeout(this.timeoutMs);
    for (const [index, identifier] of identifiers.entries()) {
      const { bytes } = await fetchBounded(
        TRACK_URL,
        {
          method: 'POST',
          headers: {
            ...BASE_HEADERS,
            'Content-Type': 'application/json',
            Origin: 'https://tracking.postlogistics.ch',
            Referer: 'https://tracking.postlogistics.ch/',
          },
          body: JSON.stringify({ Identifier: identifier }),
          signal,
        },
        { provider: UPSTREAM, timeoutMs: this.timeoutMs, fetcher: this.fetcher },
      );
      try {
        return parsePostlogisticsTrackingResponse(parseJsonBytes(bytes, UPSTREAM), trackingNumber, this.now());
      } catch (error) {
        if (!(error instanceof NotFoundError) || index === identifiers.length - 1) throw error;
      }
    }
    throw new NotFoundError(PROVIDER);
  }

  async recognizes(trackingNumber: string): Promise<Recognition> {
    try {
      const result = await this.fetch(trackingNumber);
      const events = (result.events ?? []).filter((event) => event.description && event.time);
      const times = events.map((event) => explicitOffsetTime(event.time)?.timestamp)
        .filter((value): value is number => value !== undefined);
      return {
        known: events.length > 0,
        lastActivityAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
      };
    } catch (error) {
      if (error instanceof NotFoundError) return { known: false };
      throw error;
    }
  }
}

/** Kept for the host's legacy dispatch chain until it is deleted. */
export async function fetchPostlogistics(trackingNumber: string): Promise<CarrierResult> {
  return new PostlogisticsTracker().fetch(trackingNumber);
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PostlogisticsTracker({ fetcher: environment.fetcher });
  return {
    id: 'postlogistics',
    // Keyless POST, with one alternate spelling after a compact not-found.
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
    recognize: (number) => tracker.recognizes(number),
  };
};
