import 'server-only';

import { randomUUID } from 'node:crypto';
import type { AdapterFactory } from '../../core/adapter';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { ClassifiedStatus } from '../../core/status';
import { zonedTime } from '../../core/time';
import { clean, fetchBounded, parseJsonBytes, UpstreamHttpError } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyPosMalaysiaStatus } from './status';

// Protocol provenance:
// - The 2020-era REST endpoint from community notes is gone; the current
//   consumer flow was recovered from the official tracking SPA bundle
//   (https://tracking.pos.com.my, inspected 2026-09-10):
//   POST https://ttu-svc.pos.com.my/api/trackandtrace/v1/request with
//   {connote_ids: [...], culture: "en"} and a client-generated P-Request-ID
//   header. No cookies, account, signature or browser state.
// - Live verification 2026-09-10: unknown codes return HTTP 200 {code:"S0000"}
//   with a per-connote entry carrying empty process_status and
//   tracking_data:null — unknown and expired are indistinguishable by design,
//   and identity binds through the echoed connote_id.
// - Event vocabulary from the vendor's own shipped demo parcel (delivered):
//   six process_summary values with fixed English wordings, mapped in
//   status.ts. Only process_status "DELIVERED" is a closed overall value;
//   anything else derives from the latest event.
const TRACKING_ENDPOINT = 'https://ttu-svc.pos.com.my/api/trackandtrace/v1/request';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENTS_TO_RETURN = 20;

function parsedTime(value: unknown): { iso: string; timestamp: number } | null {
  // Observed shape: "22 Aug 2023, 05:34:58 PM", English abbreviations, 12-hour
  // clock, no offset. Malaysia is a single UTC+8 zone with no DST, so the zone
  // assignment is unambiguous (unlike multi-country lanes).
  return zonedTime(value, 'dd MMM yyyy, hh:mm:ss a', 'Asia/Kuala_Lumpur', { locale: 'en-US' });
}

export function normalizePosMalaysiaTrackingNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^(?:MYPM\d{11}|[A-Z]{2}\d{9}MY)$/.test(value)) {
    throw new TypeError('Pos Malaysia tracking requires an MYPM barcode or MY S10 identifier');
  }
  return value;
}

export function posMalaysiaTrackingUrl(rawTrackingNumber: string): string {
  // Path-form deep link: the SPA route tracking/:ids picks the code up as a
  // chip and runs the lookup automatically (verified live; ?id= and
  // #trackingIds= do not prefill).
  return `https://tracking.pos.com.my/tracking/${encodeURIComponent(normalizePosMalaysiaTrackingNumber(rawTrackingNumber))}`;
}

export function parsePosMalaysiaTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizePosMalaysiaTrackingNumber(trackingNumber);
  if (!isRecord(payload)) throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned an invalid tracking response');
  if (payload.code !== 'S0000') throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned an unsuccessful tracking response');
  if (!Array.isArray(payload.data)) throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned an invalid tracking response');
  const items = payload.data.filter(isRecord);
  if (items.length !== payload.data.length) {
    throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned an invalid shipment entry');
  }
  const item = items.find(
    (candidate) => clean(candidate.connote_id, 64).toLocaleUpperCase('en-US').replace(/[\s.-]/g, '') === requested,
  );
  if (!item) throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned a different shipment');
  const rawDetails = item.tracking_data;
  // Unknown or expired codes come back with empty process_status and null
  // tracking_data: a domain outcome (clean 404), never a transport failure.
  if (rawDetails == null) throw new NotFoundError('Pos Malaysia');
  if (!Array.isArray(rawDetails)) throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned invalid tracking history');
  const parsed: Array<{ event: CarrierEvent; classified: ClassifiedStatus; timestamp: number; index: number }> = [];
  const seen = new Set<string>();
  rawDetails.filter(isRecord).slice(0, 500).forEach((rawEvent, index) => {
    const summary = clean(rawEvent.process_summary, 200);
    const description = clean(rawEvent.process, 500);
    const time = parsedTime(rawEvent.date);
    if (!time || !description) return;
    const eventType = clean(rawEvent.event_type, 32);
    const identity = `${time.iso}\u0000${description}\u0000${eventType}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    // Unmapped summaries keep the scan default rather than guessing.
    const classified = classifyPosMalaysiaStatus(summary);
    parsed.push({
      event: {
        time: time.iso,
        // Offices are Pos Malaysia facility names (hubs, kiosks), kept coarse.
        // Sender/recipient blocks travel alongside the item but are deliberately
        // never retained; proof-of-delivery links and image fields are dropped.
        location: clean(rawEvent.office, 160),
        description,
        stage: classified.stage,
        ...(eventType ? { provider_code: eventType } : {}),
      },
      classified,
      timestamp: time.timestamp,
      index,
    });
  });
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const events = parsed.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);
  if (clean(item.process_status, 32).toLocaleUpperCase('en-US') === 'DELIVERED') {
    return {
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: events[0]?.description ?? 'Delivered',
      last_update: events[0]?.time ?? null,
      expected_delivery: null,
      timezone: 'Asia/Kuala_Lumpur',
      events,
    };
  }
  if (events.length === 0) throw new NotFoundError('Pos Malaysia');
  const latest = parsed[0]!;
  return {
    status: latest.classified.status,
    current_stage: latest.classified.stage,
    last_status_text: latest.event.description ?? 'Tracking information received',
    last_update: latest.event.time ?? null,
    expected_delivery: null,
    timezone: 'Asia/Kuala_Lumpur',
    events,
  };
}

export class PosMalaysiaTracker {
  readonly timeoutMs: number;
  readonly fetcher: typeof fetch | undefined;

  constructor(options: { timeoutMs?: number; fetcher?: typeof fetch } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Pos Malaysia timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizePosMalaysiaTrackingNumber(rawTrackingNumber);
    const { response, bytes } = await fetchBounded(TRACKING_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
        'P-Request-ID': randomUUID(),
      },
      body: JSON.stringify({ connote_ids: [trackingNumber], culture: 'en' }),
    }, {
      provider: 'Pos Malaysia tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      retryTransient: true,
      allowHttpError: true,
      fetcher: this.fetcher,
    });
    if (!response.ok) throw new UpstreamHttpError('Pos Malaysia tracking', response.status);
    return parsePosMalaysiaTrackingResponse(parseJsonBytes(bytes, 'Pos Malaysia tracking'), trackingNumber);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PosMalaysiaTracker({ fetcher: environment.fetcher });
  return {
    id: 'pos-malaysia',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
