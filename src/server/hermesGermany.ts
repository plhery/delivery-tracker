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
  ORDER_INFO_RECEIVED: milestone('registered', 'pending', 'Shipment announced to Hermes'),
  PREANNOUNCED: milestone('registered', 'pending', 'Shipment announced to Hermes'),
  PARCELSHOP_DROP_OFF: milestone('registered', 'pending', 'Dropped off at a ParcelShop'),
  ATG_OUT_OF_WAREHOUSE: milestone('registered', 'pending', 'Sender preparing handover to Hermes'),
  HANDED_OVER: milestone('accepted', 'in_transit', 'Shipment handed to Hermes'),
  HANDED_OVER_TO_HERMES: milestone('accepted', 'in_transit', 'Shipment handed to Hermes'),
  TAKEN_OVER_BY_HERMES: milestone('accepted', 'in_transit', 'Shipment collected by Hermes'),
  PICKED_UP: milestone('accepted', 'in_transit', 'Shipment collected by Hermes'),
  SHIPMENT_PICKED_UP: milestone('accepted', 'in_transit', 'Shipment collected by Hermes'),
  PARCELSHOP_COLLECTED_BY_DRIVER: milestone('accepted', 'in_transit', 'Shipment collected by Hermes'),
  ARRIVED_IN_DESTINATION_REGION: milestone('in_transit', 'in_transit', 'Shipment arrived in the destination region'),
  ARRIVED_AT_DEPOT: milestone('in_transit', 'in_transit', 'Shipment arrived at the depot'),
  ARRIVED_AT_DELIVERY_DEPOT: milestone('in_transit', 'in_transit', 'Shipment arrived at the delivery depot'),
  ARRIVED_IN_DESTINATION_REGION_V2: milestone('in_transit', 'in_transit', 'Shipment arrived in the destination region'),
  IN_TRANSIT: milestone('in_transit', 'in_transit', 'Shipment in transit'),
  SORTED: milestone('in_transit', 'in_transit', 'Shipment sorted at the hub'),
  DELIVERY_TOUR_STARTED: milestone('out_for_delivery', 'out_for_delivery', 'Out for delivery'),
  OUT_FOR_DELIVERY: milestone('out_for_delivery', 'out_for_delivery', 'Out for delivery'),
  NEXT_STOP: milestone('out_for_delivery', 'out_for_delivery', 'Courier is at the next stop'),
  DELIVERED: milestone('delivered', 'delivered', 'Delivered'),
  DELIVERED_HOMEDELIVERY: milestone('delivered', 'delivered', 'Delivered'),
  DELIVERED_NEIGHBOUR: milestone('delivered', 'delivered', 'Delivered to a neighbour'),
  DELIVERED_DROPOFF: milestone('delivered', 'delivered', 'Delivered to the agreed safe place'),
  DELIVERED_MAILBOX: milestone('delivered', 'delivered', 'Delivered to the mailbox'),
  DELIVERED_PARCELSHOP: milestone('delivered', 'delivered', 'Collected at the ParcelShop'),
  DELIVERED_PARCELBOX: milestone('delivered', 'delivered', 'Delivered to the parcel box'),
  PICKED_UP_BY_RECIPIENT: milestone('delivered', 'delivered', 'Collected by the recipient'),
  COLLECTED: milestone('delivered', 'delivered', 'Collected by the recipient'),
  READY_FOR_PICKUP: milestone('ready_for_pickup', 'out_for_delivery', 'Ready for collection'),
  PARCELSHOP_ITEMS_FOR_COLLECTION: milestone('ready_for_pickup', 'out_for_delivery', 'Ready for collection at the ParcelShop'),
  READY_FOR_COLLECTION: milestone('ready_for_pickup', 'out_for_delivery', 'Ready for collection'),
  DELIVERY_FAILED: milestone('failed_attempt', 'exception', 'Delivery attempt unsuccessful'),
  NOT_DELIVERABLE: milestone('failed_attempt', 'exception', 'Shipment not deliverable'),
  UNKNOWN_WHEREABOUTS: milestone('failed_attempt', 'exception', 'Shipment whereabouts unknown'),
  RETURN_TO_SENDER: milestone('returned', 'exception', 'Returning to sender'),
  RETURN_DELIVERED_TO_SENDER: milestone('returned', 'exception', 'Returned to sender'),
  RETURN: milestone('returned', 'exception', 'Returning to sender'),
  RETOURE_DELIVERED: milestone('returned', 'exception', 'Returned to sender'),
};
// Pre-announcement preference bookings fire before collection and must never
// move the parcel backwards on their own.
const IGNORED_BOOKING_STATUS = new Set(['EDL_BOOKED_DROPOFF']);

function cleanText(value: unknown, maxLength = 500): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function etaDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  const raw = cleanText(value, 64);
  if (!raw) return null;
  const parsed = DateTime.fromISO(raw, { setZone: true });
  if (parsed.isValid) return parsed.toISODate();
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? new Date(millis).toISOString().slice(0, 10) : null;
}

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
    if (seen.has(identity) || IGNORED_BOOKING_STATUS.has(entry.parcelStatus)) continue;
    seen.add(identity);
    const metadata = Object.hasOwn(STATUSES, entry.parcelStatus) ? STATUSES[entry.parcelStatus] : undefined;
    // historyText is the carrier's display wording; the `status` field only
    // carries generic HAPPY/FINISHED buckets and is never display text.
    const rawText = cleanText(entry.historyText);
    events.push({
      timestamp: date.toMillis(),
      metadata,
      event: {
        time,
        description: rawText || metadata?.description || 'Hermes tracking update',
        stage: metadata?.stage ?? 'in_transit',
        provider_code: entry.parcelStatus,
      },
    });
  }
  events.sort((a, b) => b.timestamp - a.timestamp);
  const latest = events[0];
  if (!latest) throw new HermesGermanyTrackingError();
  const parcel = parcels[0] as Record<string, unknown>;
  const attributes = isRecord(parcel.parcelAttributes) ? parcel.parcelAttributes : {};
  const atg = isRecord(parcel.atg) ? parcel.atg : {};
  const sender = cleanText(atg.companyName) || null;
  const eta = etaDate(parcel.eta ?? parcel.deliveryForecast ?? attributes.deliveredTimestamp);
  const deliveredByCode = latest.metadata?.status === 'delivered';
  const deliveredByFlag = attributes.delivered === true;
  const delivered = deliveredByCode || deliveredByFlag;
  if (!latest.metadata && !delivered) {
    return {
      status: 'unknown',
      last_status_text: latest.event.description,
      last_update: latest.event.time,
      expected_delivery: null,
      timezone: 'Europe/Berlin',
      ...(sender ? { sender_name: sender } : {}),
      events: events.slice(0, 100).map(({ event }) => event),
    };
  }
  const status = delivered ? 'delivered' as const : latest.metadata!.status;
  const stage = latest.metadata?.stage ?? (delivered ? 'delivered' : 'in_transit');
  const deliveredAt = delivered ? latest.event.time : null;
  return {
    status,
    current_stage: stage,
    last_status_text: latest.event.description,
    last_update: latest.event.time,
    expected_delivery: delivered ? null : eta,
    timezone: 'Europe/Berlin',
    ...(sender ? { sender_name: sender } : {}),
    ...(deliveredAt && status === 'delivered' ? { delivered_at: deliveredAt } : {}),
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
      headers: {
        Accept: 'application/json',
        'X-Language': 'de',
        Referer: 'https://www.myhermes.de/',
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
      },
    }, { provider: PROVIDER, timeoutMs: this.timeoutMs, maxBytes: 750_000, allowHttpError: true });
    if (response.status === 404) throw new HermesGermanyTrackingError();
    if (!response.ok) throw new UpstreamHttpError(PROVIDER, response.status);
    return parseHermesGermanyResponse(parseJsonBytes(bytes, PROVIDER), number);
  }
}
