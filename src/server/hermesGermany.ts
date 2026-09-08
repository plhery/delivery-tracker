import 'server-only';

import { DateTime } from 'luxon';
import { fetchBounded, parseJsonBytes, UpstreamHttpError } from './boundedFetch';
import type { CarrierEvent, CarrierResult, CarrierStatus } from './carrierResult';
import type { Stage } from '../types';
import { isRecord } from './types';

// Public recipient protocol inspected 2026-09-08:
// https://gcp-prd.my-deliveries.de/tnt/bundle/tnt-bundle-v2.js
// Separate from Hermes Einrichtungs-Service (myhes.de). The postcode-protected
// address endpoint is deliberately not called.
const API = 'https://api.my-deliveries.de/tnt/v2/shipments/search/';
const PROVIDER = 'Hermes Germany tracking';
type Milestone = { stage: Stage; status: CarrierStatus; description: string };

function milestone(stage: Stage, status: CarrierStatus, description: string): Milestone {
  return { stage, status, description };
}

const STATUSES: Record<string, Milestone> = {
  ANNOUNCED: milestone('registered', 'pending', 'Shipment announced to Hermes'),
  ATG_OUT_OF_WAREHOUSE: milestone('registered', 'pending', 'Sender preparing handover to Hermes'),
  HANDED_OVER: milestone('accepted', 'in_transit', 'Shipment handed to Hermes'),
  PICKED_UP: milestone('accepted', 'in_transit', 'Shipment collected by Hermes'),
  ARRIVED_IN_DESTINATION_REGION: milestone('in_transit', 'in_transit', 'Shipment arrived in the destination region'),
  DELIVERY_TOUR_STARTED: milestone('out_for_delivery', 'out_for_delivery', 'Out for delivery'),
  DELIVERED: milestone('delivered', 'delivered', 'Delivered'),
  DELIVERED_NEIGHBOUR: milestone('delivered', 'delivered', 'Delivered to a neighbour'),
  DELIVERED_DROPOFF: milestone('delivered', 'delivered', 'Delivered to the agreed safe place'),
  DELIVERED_MAILBOX: milestone('delivered', 'delivered', 'Delivered to the mailbox'),
  READY_FOR_PICKUP: milestone('ready_for_pickup', 'out_for_delivery', 'Ready for collection'),
  DELIVERY_FAILED: milestone('failed_attempt', 'exception', 'Delivery attempt unsuccessful'),
  RETURN_TO_SENDER: milestone('returned', 'exception', 'Returning to sender'),
  RETURN_DELIVERED_TO_SENDER: milestone('returned', 'exception', 'Returned to sender'),
  RETOURE_DELIVERED: milestone('returned', 'exception', 'Returned to sender'),
};

export class HermesGermanyTrackingError extends Error {
  readonly status = 404;

  constructor() {
    super('Hermes Germany could not locate the shipment');
    this.name = 'HermesGermanyTrackingError';
  }
}

export function normalizeHermesGermanyNumber(raw: string): string {
  const value = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^(?=.*\d)[A-Z0-9]{8,20}$/.test(value)) {
    throw new TypeError('Hermes Germany requires an 8-to-20-character tracking number');
  }
  return value;
}

export function parseHermesGermanyResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizeHermesGermanyNumber(trackingNumber);
  if (!Array.isArray(payload) || payload.some((entry) => !isRecord(entry))) {
    throw new TypeError('Hermes Germany returned an invalid tracking response');
  }
  if (!payload.length) throw new HermesGermanyTrackingError();
  const parcels = payload.filter((entry) => entry.barcode === requested);
  if (parcels.length !== 1) throw new RangeError('Hermes Germany returned a different or ambiguous shipment');
  const progress: unknown = parcels[0].parcelProgress;
  if (!Array.isArray(progress) || !progress.length || progress.length > 500) {
    throw new TypeError('Hermes Germany returned an invalid tracking history');
  }
  const seen = new Set<string>();
  const events: Array<{ event: CarrierEvent; timestamp: number; metadata?: Milestone }> = [];
  for (const entry of progress) {
    if (!isRecord(entry) || typeof entry.timestamp !== 'string'
      || typeof entry.parcelStatus !== 'string' || !/^[A-Z_]{1,64}$/.test(entry.parcelStatus)) {
      throw new TypeError('Hermes Germany returned an invalid tracking event');
    }
    const date = DateTime.fromISO(entry.timestamp, { zone: 'Europe/Berlin', setZone: true });
    if (!date.isValid) throw new TypeError('Hermes Germany returned an invalid event date');
    const time = date.toUTC().toISO()!;
    const identity = `${time}|${entry.parcelStatus}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const metadata = Object.hasOwn(STATUSES, entry.parcelStatus) ? STATUSES[entry.parcelStatus] : undefined;
    events.push({
      timestamp: date.toMillis(),
      metadata,
      event: {
        time,
        // Never copy free-text fields: they may contain recipient/delivery details.
        description: metadata?.description ?? 'Hermes tracking update',
        stage: metadata?.stage ?? 'pending',
        provider_code: entry.parcelStatus,
      },
    });
  }
  events.sort((a, b) => b.timestamp - a.timestamp);
  const latest = events[0];
  if (!latest.metadata) throw new TypeError('Hermes Germany returned an unrecognized shipment status');
  return {
    status: latest.metadata.status,
    current_stage: latest.metadata.stage,
    last_status_text: latest.metadata.description,
    last_update: latest.event.time,
    expected_delivery: null,
    timezone: 'Europe/Berlin',
    events: events.slice(0, 100).map(({ event }) => event),
  };
}

export class HermesGermanyTracker {
  constructor(readonly timeoutMs = 15_000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Hermes Germany timeout must be positive');
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const number = normalizeHermesGermanyNumber(trackingNumber);
    const { response, bytes } = await fetchBounded(`${API}${encodeURIComponent(number)}`, {
      headers: { Accept: 'application/json', 'X-Language': 'en', Origin: 'https://www.myhermes.de' },
    }, { provider: PROVIDER, timeoutMs: this.timeoutMs, maxBytes: 750_000, allowHttpError: true });
    if (response.status === 404) throw new HermesGermanyTrackingError();
    if (!response.ok) throw new UpstreamHttpError(PROVIDER, response.status);
    return parseHermesGermanyResponse(parseJsonBytes(bytes, PROVIDER), number);
  }
}
