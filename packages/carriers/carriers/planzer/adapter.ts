import 'server-only';

/**
 * Planzer and Quickpac tracking.
 *
 * Planzer's own tracking app reads a keyless JSON API:
 * `api.tracking.app.planzer.ch/api/v1/shipments/{shipment}/Pak`. Quickpac's
 * 18-digit `44…` identifiers go through the same API and the same public page,
 * so one adapter serves both carrier ids (see ./README.md).
 *
 * A shipment may carry several transport positions. A parcel number reads only
 * the position whose `positionNumber` equals it, because the response can
 * include positions of other shipments in the same delivery. A shipment number
 * (the reply's own `shipmentNumber`) reads every position of that shipment.
 *
 * Shipments shared through a capability link are not in this API: they are
 * served by `./shared`, chosen by the factory when the parcel has a tracking
 * URL.
 */
import type { AdapterFactory } from '../../core/adapter';
import { SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { PlanzerSharedTracker } from './shared';
import { PLANZER_STATUS, planzerDescription, planzerEventStage } from './status';

const PROVIDER = 'Planzer';
const UPSTREAM = 'Planzer tracking';
const SHIPMENTS_URL = 'https://api.tracking.app.planzer.ch/api/v1/shipments';
const DEFAULT_TIMEOUT_MS = 10_000;
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

/**
 * The shipment number the API expects. Planzer prints `reference.shipment`
 * composites (`87979.0061660090`); only the shipment half is looked up, without
 * its leading zeros. The app stores numbers without dots, so a 5-digit
 * reference followed by a zero-padded 10-digit shipment is split the same way.
 */
export function planzerShipmentNumber(trackingNumber: string): string {
  const raw = trackingNumber.includes('.')
    ? trackingNumber.split('.', 2)[1] ?? ''
    : /^\d{5}(0\d{9})$/.exec(trackingNumber)?.[1];
  if (raw === undefined) return trackingNumber;
  return raw.replace(/^0+/, '') || raw;
}

// The parcels of one shipment repeat each milestone seconds or minutes apart.
const SAME_MILESTONE_MS = 15 * 60_000;

function eventMillis(time: string): number {
  // Naive local timestamps with up to seven fractional digits; only differences matter.
  return Date.parse(`${time.slice(0, 19)}Z`);
}

/** One row per milestone the parcels share, at its first occurrence. */
function mergeParcelMilestones(events: CarrierEvent[]): CarrierEvent[] {
  const kept: CarrierEvent[] = [];
  for (const event of [...events].sort((left, right) => text(left.time).localeCompare(text(right.time)))) {
    const at = eventMillis(text(event.time));
    const repeated = kept.some((other) => other.description === event.description
      && Math.abs(eventMillis(text(other.time)) - at) <= SAME_MILESTONE_MS);
    if (!repeated) kept.push(event);
  }
  return kept;
}

/** Projects one `/shipments/{shipment}/Pak` payload. Pure: the offline tests target this. */
export function parsePlanzerTrackingResponse(value: unknown, shipmentNumber: string): CarrierResult {
  const payload = record(value);
  const overall = record(payload.overallStatus);
  const statusText = text(record(overall.text).english);
  if (!Array.isArray(payload.transportPositions)) {
    throw new SchemaError(PROVIDER, 'Planzer returned an invalid shipment response');
  }
  const positions = recordArray(payload.transportPositions);
  if (positions.length !== payload.transportPositions.length) {
    throw new SchemaError(PROVIDER, 'Planzer returned an invalid transport position');
  }
  const requested = comparableIdentifier(shipmentNumber);
  const identified = positions.filter((position) => comparableIdentifier(position.positionNumber));
  if (identified.length === 0) {
    throw new SchemaError(PROVIDER, 'Planzer did not return a shipment identifier');
  }
  const parcelPositions = identified.filter(
    (position) => comparableIdentifier(position.positionNumber) === requested,
  );
  // Looked up by shipment number: every position belongs to the requested shipment.
  const wholeShipment = parcelPositions.length === 0 && comparableIdentifier(payload.shipmentNumber) === requested;
  const matchingPositions = wholeShipment ? identified : parcelPositions;
  if (matchingPositions.length === 0) {
    throw new SchemaError(PROVIDER, 'Planzer returned a different shipment');
  }
  let events: CarrierEvent[] = [];
  for (const position of matchingPositions) {
    for (const event of recordArray(position.positionEvents)) {
      const description = text(record(event.text).english);
      const stage = planzerEventStage(description);
      if (!stage) {
        // Surface schema changes through the existing sync error monitoring;
        // never silently turn an unfamiliar historical event into a delivery.
        throw new SchemaError('Planzer', 'Planzer returned an unrecognized tracking event status');
      }
      events.push({
        time: text(event.createdAt),
        location: '',
        description: planzerDescription(description),
        stage,
      });
    }
  }
  if (matchingPositions.length > 1) events = mergeParcelMilestones(events);
  events.sort((left, right) => text(right.time).localeCompare(text(left.time)));
  return {
    status: PLANZER_STATUS.get(statusText) ?? (statusText ? 'in_transit' : 'unknown'),
    last_status_text: planzerDescription(statusText),
    last_update: events[0]?.time || null,
    expected_delivery: text(record(payload.deliveryDay).date) || null,
    events,
  };
}

export class PlanzerTracker {
  private readonly fetcher: typeof fetch | undefined;
  private readonly timeoutMs: number;

  constructor(options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {
    this.fetcher = options.fetcher;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const shipmentNumber = planzerShipmentNumber(trackingNumber);
    const { bytes } = await fetchBounded(
      `${SHIPMENTS_URL}/${encodeURIComponent(shipmentNumber)}/Pak`,
      { headers: BASE_HEADERS },
      {
        provider: UPSTREAM,
        timeoutMs: this.timeoutMs,
        // One replay after a transport failure, HTTP 502/503/504, or a 429
        // with a short Retry-After; parsing and validation are never retried.
        retryTransient: true,
        fetcher: this.fetcher,
      },
    );
    return parsePlanzerTrackingResponse(parseJsonBytes(bytes, UPSTREAM), shipmentNumber);
  }
}

/** Kept for the host's legacy dispatch chain until it is deleted. */
export async function fetchPlanzer(trackingNumber: string): Promise<CarrierResult> {
  return new PlanzerTracker().fetch(trackingNumber);
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PlanzerTracker({ fetcher: environment.fetcher });
  const shared = new PlanzerSharedTracker({ fetcher: environment.fetcher });
  return {
    id: 'planzer',
    // Both routes are a single bounded request; the capability URL decides
    // which one, not a fallback tier.
    steps: ['direct'],
    track: (input) => (input.trackingUrl
      ? shared.fetch(input.number, input.trackingUrl)
      : tracker.fetch(input.number)),
  };
};
