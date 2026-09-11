import 'server-only';

import { DateTime } from 'luxon';
import { fetchBounded, parseJsonBytes, UpstreamHttpError } from './boundedFetch';
import type { CarrierEvent, CarrierResult, CarrierStatus } from './carrierResult';
import type { Stage } from '../types';
import { isRecord } from './types';

// Protocol provenance:
// - Prior art (structure + contract, verified independently below, MIT):
//   https://github.com/ha-parcel-integrations/ha-packeta (api.py, parcels.py,
//   tests/payloads.py — keyless consumer POST, 200 {item} / 404 notFound).
// - Live verification 2026-09-10: POST
//   https://tracking.packeta.com/api/getPacketById/Z0000000000/en returns
//   HTTP 404 {"error":"notFound"} in ~0.2s with no cookies, headers or account.
//   Expired 2023-era reported Z codes return the same 404 (unknown and expired
//   are intentionally indistinguishable to anonymous callers).
// - Shape reference: ha-packeta tests/payloads.py (confirmed live 2026-08-19
//   against real delivered parcels; values fictionalized there). Only
//   packetStatusId "3" (delivered) is live-confirmed there; the other codes are
//   reconstructed — an unmapped code below is schema drift, never a guess.
const TRACKING_ENDPOINT = 'https://tracking.packeta.com/api/getPacketById';
const TRACKING_LOCALE = 'en';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENTS_TO_RETURN = 20;

interface ClassifiedStatus {
  status: CarrierStatus;
  stage: Stage;
}

const PACKET_STATUS: Record<string, ClassifiedStatus> = {
  // TO_BE_PROCESSED
  '997': { status: 'pending', stage: 'registered' },
  // WAITING_FOR_DELIVERY (in warehouse)
  '1': { status: 'in_transit', stage: 'in_transit' },
  // ON_THE_WAY
  '31': { status: 'in_transit', stage: 'in_transit' },
  // READY_FOR_PICKUP
  '2': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  // ISSUED_AND_ACCOUNTED (live-confirmed delivered wording:
  // "The package has been delivered")
  '3': { status: 'delivered', stage: 'delivered' },
  // LOST_OR_UNKNOWN
  '21': { status: 'exception', stage: 'failed_attempt' },
};

// No per-event status code exists; real parcels confirmed these English sentences
// are canned templates (locale is pinned to English in the request), so fixed
// substring matching is safe. Unrecognized sentences keep unknown/in_transit and
// surface through sync-error monitoring via the strict overall-code mapping.
const EVENT_TEXT_STAGES: Array<[substring: string, stage: Stage]> = [
  ['aware of your parcel and are waiting for the sender', 'registered'],
  ['assigned a tracking number', 'registered'],
  ['successfully received the parcel for transport', 'in_transit'],
  ['on its way to the depot', 'in_transit'],
  ['arrived at the depot', 'in_transit'],
  ['has been handed over to the carrier', 'in_transit'],
  ['on its way to you', 'out_for_delivery'],
  ['ready for pickup', 'ready_for_pickup'],
  ['the parcel is with you', 'delivered'],
  ['investigating the status of the parcel', 'failed_attempt'],
];

function clean(value: unknown, maxLength = 500): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function stageForEventText(rawDescription: string): Stage {
  const value = rawDescription.toLocaleLowerCase('en-US');
  for (const [substring, stage] of EVENT_TEXT_STAGES) {
    if (value.includes(substring)) return stage;
  }
  return 'in_transit';
}

function parsedTime(value: unknown): { iso: string; timestamp: number } | null {
  const raw = clean(value, 32);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return null;
  // Packeta emits naive wall-clock times with no offset. The backend stamps
  // Europe/Prague time (verified against real parcels by the prior-art client);
  // Romania (EET) depot scans can therefore be off by one hour. There is no
  // per-event locality to do better, so ordering within a parcel is preserved
  // while the zone caveat stays documented here instead of inventing UTC.
  const parsed = DateTime.fromFormat(raw, 'yyyy-MM-dd HH:mm:ss', { zone: 'Europe/Prague' });
  const iso = parsed.isValid ? parsed.toISO({ suppressMilliseconds: true }) : null;
  return iso ? { iso, timestamp: parsed.toMillis() } : null;
}

export class PacketaTrackingError extends Error {
  readonly status = 404;

  constructor() {
    super('Packeta could not locate the shipment');
    this.name = 'PacketaTrackingError';
  }
}

export function normalizePacketaTrackingNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^Z\d{10}$/.test(value)) {
    throw new TypeError('Packeta tracking requires a Z-prefixed barcode with ten digits');
  }
  return value;
}

export function packetaTrackingUrl(rawTrackingNumber: string): string {
  // Canonical path form: the legacy ?id= form 301-redirects here (verified live).
  return `https://tracking.packeta.com/en/${encodeURIComponent(normalizePacketaTrackingNumber(rawTrackingNumber))}`;
}

export function parsePacketaTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizePacketaTrackingNumber(trackingNumber);
  if (!isRecord(payload)) throw new TypeError('Packeta returned an invalid tracking response');
  const item = payload.item;
  // A 200 carrying an error instead of an item is Packeta's second unknown-code
  // signal (mirrors the HTTP 404 contract); it is a domain outcome, not a crash.
  if (!isRecord(item)) {
    if (typeof payload.error === 'string') throw new PacketaTrackingError();
    throw new TypeError('Packeta returned an invalid tracking response');
  }
  const returned = clean(item.barcode, 64).toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!returned) throw new TypeError('Packeta did not return a shipment identifier');
  if (returned !== requested) throw new RangeError('Packeta returned a different shipment');
  const code = clean(item.packetStatusId, 16);
  const classified = PACKET_STATUS[code];
  if (!classified) throw new TypeError('Packeta returned an unrecognized packet status');
  const rawDetails = item.trackingDetails;
  if (rawDetails !== undefined && !Array.isArray(rawDetails)) {
    throw new TypeError('Packeta returned invalid tracking history');
  }
  const parsed: Array<{ event: CarrierEvent; timestamp: number; index: number }> = [];
  const seen = new Set<string>();
  (Array.isArray(rawDetails) ? rawDetails : []).filter(isRecord).slice(0, 500).forEach((rawEvent, index) => {
    const time = parsedTime(rawEvent.time);
    const description = clean(rawEvent.text, 500);
    if (!time || !description) return;
    const identity = `${time.iso}\u0000${description}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    parsed.push({
      event: { time: time.iso, location: '', description, stage: stageForEventText(description) },
      timestamp: time.timestamp,
      index,
    });
  });
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const events = parsed.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);
  return {
    status: classified.status,
    current_stage: classified.stage,
    // packetStatus is the backend's fixed English wording for the requested
    // locale. Sender/branch names travel alongside the item but are deliberately
    // never retained: only normalized status and timeline fields are projected.
    last_status_text: clean(item.packetStatus, 500) || events[0]?.description || 'Tracking information received',
    last_update: events[0]?.time ?? null,
    expected_delivery: null,
    timezone: 'Europe/Prague',
    events,
  };
}

export class PacketaTracker {
  readonly timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Packeta timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizePacketaTrackingNumber(rawTrackingNumber);
    const url = `${TRACKING_ENDPOINT}/${encodeURIComponent(trackingNumber)}/${TRACKING_LOCALE}`;
    const { response, bytes } = await fetchBounded(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
      },
    }, {
      provider: 'Packeta tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      retryTransient: true,
      allowHttpError: true,
    });
    if (response.status === 404) throw new PacketaTrackingError();
    if (!response.ok) throw new UpstreamHttpError('Packeta tracking', response.status);
    return parsePacketaTrackingResponse(parseJsonBytes(bytes, 'Packeta tracking'), trackingNumber);
  }
}
