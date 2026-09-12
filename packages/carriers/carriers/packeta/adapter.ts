import 'server-only';

import type { AdapterFactory } from '../../core/adapter';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { zonedTime } from '../../core/time';
import { clean, fetchBounded, parseJsonBytes, UpstreamHttpError } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyPacketaStatus, packetaEventStage } from './status';

// Protocol provenance:
// - Prior art (structure + contract, verified independently below, MIT):
//   https://github.com/ha-parcel-integrations/ha-packeta (api.py, parcels.py,
//   tests/payloads.py — keyless consumer POST, 200 {item} / 404 notFound).
// - Live verification 2026-09-10: POST
//   https://tracking.packeta.com/api/getPacketById/Z0000000000/en returns
//   HTTP 404 {"error":"notFound"} in ~0.2s with no cookies, headers or account.
//   Expired 2023-era reported Z codes return the same 404 (unknown and expired
//   are intentionally indistinguishable to anonymous callers).
// - Shape reference: the prior-art payload samples (confirmed live 2026-08-19
//   against real delivered parcels; values fictionalized there). Only
//   packetStatusId "3" (delivered) is live-confirmed; the other codes are
//   reconstructed — an unmapped code is schema drift, never a guess. The maps
//   live in status.ts.
const TRACKING_ENDPOINT = 'https://tracking.packeta.com/api/getPacketById';
const TRACKING_LOCALE = 'en';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENTS_TO_RETURN = 20;

function parsedTime(value: unknown): { iso: string; timestamp: number } | null {
  const raw = clean(value, 32);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return null;
  // Packeta emits naive wall-clock times with no offset. The backend stamps
  // Europe/Prague time (verified against real parcels by the prior-art client);
  // Romania (EET) depot scans can therefore be off by one hour. There is no
  // per-event locality to do better, so ordering within a parcel is preserved
  // while the zone caveat stays documented here instead of inventing UTC.
  return zonedTime(raw, 'yyyy-MM-dd HH:mm:ss', 'Europe/Prague');
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
  if (!isRecord(payload)) throw new SchemaError('Packeta', 'Packeta returned an invalid tracking response');
  const item = payload.item;
  // A 200 carrying an error instead of an item is Packeta's second unknown-code
  // signal (mirrors the HTTP 404 contract); it is a domain outcome, not a crash.
  if (!isRecord(item)) {
    if (typeof payload.error === 'string') throw new NotFoundError('Packeta');
    throw new SchemaError('Packeta', 'Packeta returned an invalid tracking response');
  }
  const returned = clean(item.barcode, 64).toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!returned) throw new SchemaError('Packeta', 'Packeta did not return a shipment identifier');
  if (returned !== requested) throw new SchemaError('Packeta', 'Packeta returned a different shipment');
  const code = clean(item.packetStatusId, 16);
  const classified = classifyPacketaStatus(code);
  const rawDetails = item.trackingDetails;
  if (rawDetails !== undefined && !Array.isArray(rawDetails)) {
    throw new SchemaError('Packeta', 'Packeta returned invalid tracking history');
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
    const stage = packetaEventStage(description);
    parsed.push({
      // Unrecognized sentences keep no stage so schema drift surfaces as a
      // data outcome instead of a wrong movement claim.
      event: { time: time.iso, location: '', description, ...(stage ? { stage } : {}) },
      timestamp: time.timestamp,
      index,
    });
  });
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const events = parsed.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);
  // Sender (merchant) and branchAddress (Z-BOX/partner shop) carry no
  // recipient PII and are the only pickup signal — Packeta exposes no ETA.
  const sender = clean(item.sender, 200) || null;
  const pickupPoint = clean(item.branchAddress, 300) || null;
  const deliveredAt = classified?.status === 'delivered' ? events[0]?.time ?? null : null;
  if (!classified) {
    return {
      status: 'unknown',
      last_status_text: clean(item.packetStatus, 500) || events[0]?.description || 'Tracking information received',
      last_update: events[0]?.time ?? null,
      expected_delivery: null,
      timezone: 'Europe/Prague',
      ...(sender ? { sender_name: sender } : {}),
      ...(pickupPoint ? { pickup_point: pickupPoint } : {}),
      events,
    };
  }
  return {
    status: classified.status,
    current_stage: classified.stage,
    // packetStatus is the backend's fixed English wording for the requested
    // locale.
    last_status_text: clean(item.packetStatus, 500) || events[0]?.description || 'Tracking information received',
    last_update: events[0]?.time ?? null,
    expected_delivery: null,
    timezone: 'Europe/Prague',
    ...(sender ? { sender_name: sender } : {}),
    ...(pickupPoint ? { pickup_point: pickupPoint } : {}),
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}),
    events,
  };
}

export class PacketaTracker {
  readonly timeoutMs: number;
  readonly fetcher: typeof fetch | undefined;

  constructor(options: { timeoutMs?: number; fetcher?: typeof fetch } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
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
      fetcher: this.fetcher,
    });
    if (response.status === 404) throw new NotFoundError('Packeta');
    if (!response.ok) throw new UpstreamHttpError('Packeta tracking', response.status);
    return parsePacketaTrackingResponse(parseJsonBytes(bytes, 'Packeta tracking'), trackingNumber);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PacketaTracker({ fetcher: environment.fetcher });
  return {
    id: 'packeta',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
