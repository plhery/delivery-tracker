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
 * - `Type` 2: a customer reference that resolved to one or more barcodes. The
 *   requested string is not a barcode, so every returned shipment belongs to
 *   this lookup and all of them are merged.
 *
 * Any other type is refused rather than guessed at. A `Data: null` answer is
 * PostLogistics' explicit "unknown identifier".
 */
import type { AdapterFactory } from '../../core/adapter';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
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
export function parsePostlogisticsTrackingResponse(value: unknown, trackingNumber: string): CarrierResult {
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
  if (responseType !== 1 && responseType !== 2) {
    throw new SchemaError(PROVIDER, 'PostLogistics returned an invalid tracking response type');
  }
  const identified = items.filter((candidate) => comparableIdentifier(candidate.Identifier));
  if (identified.length === 0) {
    throw new SchemaError(PROVIDER, 'PostLogistics did not return a shipment identifier');
  }
  let shipments = identified;
  if (responseType === 1) {
    const requested = comparableIdentifier(trackingNumber);
    shipments = identified.filter(
      (candidate) => comparableIdentifier(candidate.Identifier) === requested,
    );
    if (shipments.length === 0) {
      throw new SchemaError(PROVIDER, 'PostLogistics returned a different shipment');
    }
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

  constructor(options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {
    this.fetcher = options.fetcher;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
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
        body: JSON.stringify({ Identifier: trackingNumber }),
      },
      { provider: UPSTREAM, timeoutMs: this.timeoutMs, fetcher: this.fetcher },
    );
    return parsePostlogisticsTrackingResponse(parseJsonBytes(bytes, UPSTREAM), trackingNumber);
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
    // One keyless POST; there is no second tier to fall back to.
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
