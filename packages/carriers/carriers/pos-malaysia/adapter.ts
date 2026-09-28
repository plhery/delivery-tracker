import 'server-only';

import { randomUUID } from 'node:crypto';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { IndeterminateError, SchemaError, TransportError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { ClassifiedStatus } from '../../core/status';
import { runSteps } from '../../core/runner';
import { NOOP_RECORDER, type StepRecorder } from '../../core/telemetry';
import { zonedTime } from '../../core/time';
import { clean, fetchBounded, parseJsonBytes, UpstreamHttpError } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyPosMalaysiaStatus } from './status';

// Protocol provenance:
// - The consumer request builder is shipped by https://tracking.pos.com.my:
//   POST https://ttu-svc.pos.com.my/api/trackandtrace/v1/request with
//   {connote_ids: [...], culture: "en"} and a client-generated P-Request-ID
//   header. No cookies, account, signature or browser state.
// - Empty process_status with tracking_data:null proves no available history,
//   not absence of a shipment. Identity binds through the echoed connote_id.
// - Event vocabulary from the vendor's own shipped demo parcel (delivered):
//   six process_summary values with fixed English wordings, mapped in
//   status.ts. Only process_status "DELIVERED" is a closed overall value;
//   anything else derives from the latest event.
const TRACKING_ENDPOINT = 'https://ttu-svc.pos.com.my/api/trackandtrace/v1/request';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENTS_TO_RETURN = 20;

function parsedTime(value: unknown): { iso: string; timestamp: number } | null {
  // English 12-hour wall clocks. Only a confirmed domestic route establishes
  // this zone; relayed international scans can name another country's time.
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
  const matching = items.filter(
    (candidate) => typeof candidate.connote_id === 'string' && candidate.connote_id.trim().toUpperCase() === requested,
  );
  if (matching.length !== 1) throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned a different or ambiguous shipment');
  const item = matching[0]!;
  const domestic = isRecord(item.sender_data) && isRecord(item.recipient_data)
    && clean(item.sender_data.sender_country, 8).toUpperCase() === 'MY'
    && clean(item.recipient_data.receipient_country, 8).toUpperCase() === 'MY';
  if (!Object.hasOwn(item, 'tracking_data')) throw new SchemaError('Pos Malaysia', 'Pos Malaysia omitted tracking history');
  const rawDetails = item.tracking_data;
  if (rawDetails !== null && !Array.isArray(rawDetails)) throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned invalid tracking history');
  if (Array.isArray(rawDetails) && rawDetails.length > 500) throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned oversized tracking history');
  const parsed: Array<{ event: CarrierEvent; classified: ClassifiedStatus | null; timestamp: number | null; index: number }> = [];
  const seen = new Set<string>();
  (rawDetails ?? []).forEach((rawEvent, index) => {
    if (!isRecord(rawEvent)) throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned an invalid scan');
    // The official client treats Error rows as response messages, not scans.
    if (rawEvent.type === 'Error') throw new IndeterminateError('Pos Malaysia', 'Pos Malaysia returned a tracking error');
    if (rawEvent.type !== 'Valid') throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned an unknown scan type');
    const summary = clean(rawEvent.process_summary, 200);
    const description = clean(rawEvent.process, 500) || summary;
    if (!description) throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned a scan with no status');
    if (rawEvent.date != null && typeof rawEvent.date !== 'string') throw new SchemaError('Pos Malaysia', 'Pos Malaysia returned an invalid scan clock');
    const clock = clean(rawEvent.date, 100);
    const time = domestic ? parsedTime(clock) : null;
    const eventType = clean(rawEvent.event_type, 32);
    const location = clean(rawEvent.office, 160);
    const identity = JSON.stringify([time?.iso ?? clock, summary, description, eventType, location]);
    if (seen.has(identity)) return;
    seen.add(identity);
    const classified = classifyPosMalaysiaStatus(summary);
    parsed.push({
      event: {
        ...(time ? { time: time.iso } : clock ? { provider_time_text: clock } : {}),
        // Offices are Pos Malaysia facility names (hubs, kiosks), kept coarse.
        // Sender/recipient blocks travel alongside the item but are deliberately
        // never retained; proof-of-delivery links and image fields are dropped.
        location,
        description,
        ...(classified ? { stage: classified.stage } : {}),
        ...(eventType ? { provider_code: eventType } : {}),
      },
      classified,
      timestamp: time?.timestamp ?? null,
      index,
    });
  });
  // The source supplies current-first history. Sorting a malformed clock among
  // valid rows would promote an older scan; keep source order in that case.
  if (parsed.every(row => row.timestamp !== null)) {
    parsed.sort((left, right) => right.timestamp! - left.timestamp! || left.index - right.index);
  }
  const events = parsed.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);
  if (clean(item.process_status, 32).toLocaleUpperCase('en-US') === 'DELIVERED') {
    const latestIsDelivered = parsed[0]?.classified?.stage === 'delivered';
    if (!latestIsDelivered) {
      events.unshift({ description: 'Delivered', stage: 'delivered', provider_code: 'DELIVERED', summary_snapshot: true });
      events.length = Math.min(events.length, MAX_EVENTS_TO_RETURN);
    }
    return {
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: latestIsDelivered ? events[0]?.description ?? 'Delivered' : 'Delivered',
      // The overall summary carries no clock. An older movement scan cannot
      // date delivery; only a matching delivered row provides that timestamp.
      last_update: latestIsDelivered ? events[0]?.time ?? null : null,
      expected_delivery: null,
      ...(domestic ? { timezone: 'Asia/Kuala_Lumpur' } : {}),
      events,
    };
  }
  if (events.length === 0) throw new IndeterminateError('Pos Malaysia', 'Pos Malaysia returned no available tracking history');
  const latest = parsed[0]!;
  return {
    status: latest.classified?.status ?? 'unknown',
    ...(latest.classified ? { current_stage: latest.classified.stage } : {}),
    last_status_text: latest.event.description ?? 'Tracking information received',
    last_update: latest.event.time ?? null,
    expected_delivery: null,
    ...(domestic ? { timezone: 'Asia/Kuala_Lumpur' } : {}),
    events,
  };
}

export class PosMalaysiaTracker {
  readonly timeoutMs: number;
  readonly fetcher: typeof fetch | undefined;
  readonly recorder: StepRecorder;

  constructor(options: { timeoutMs?: number; fetcher?: typeof fetch; recorder?: StepRecorder } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
    this.recorder = options.recorder ?? NOOP_RECORDER;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Pos Malaysia timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const trackingNumber = normalizePosMalaysiaTrackingNumber(rawTrackingNumber);
    const budgetMs = context.budgetMs ?? this.timeoutMs;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('Pos Malaysia budget must be positive');
    return runSteps({ carrier: 'pos-malaysia', budgetMs, signal: context.signal, recorder: this.recorder }, [{
      id: 'direct', run: async ({ signal, remainingMs }) => {
        try {
          const { bytes } = await fetchBounded(TRACKING_ENDPOINT, {
            method: 'POST', signal,
            headers: {
              Accept: 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
              'P-Request-ID': randomUUID(),
            },
            body: JSON.stringify({ connote_ids: [trackingNumber], culture: 'en' }),
          }, {
            provider: 'Pos Malaysia tracking', timeoutMs: Math.max(1, Math.floor(remainingMs)),
            maxBytes: MAX_RESPONSE_BYTES, retryTransient: true, fetcher: this.fetcher,
          });
          return parsePosMalaysiaTrackingResponse(parseJsonBytes(bytes, 'Pos Malaysia tracking'), trackingNumber);
        } catch (error) {
          if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) {
            throw new TransportError('Pos Malaysia', 'Pos Malaysia tracking endpoint is unavailable', { cause: error });
          }
          throw error;
        }
      },
    }]);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new PosMalaysiaTracker({ fetcher: environment.fetcher, recorder: environment.recorder });
  return {
    id: 'pos-malaysia',
    steps: ['direct'],
    track: (input, context) => tracker.fetch(input.number, context),
  };
};
