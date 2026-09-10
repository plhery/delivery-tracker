import 'server-only';

import { DateTime } from 'luxon';
import { fetchBounded, parseJsonBytes, UpstreamHttpError } from './boundedFetch';
import type { CarrierEvent, CarrierResult, CarrierStatus } from './carrierResult';
import type { Stage } from '../types';
import { isRecord } from './types';

// Protocol provenance:
// - Prior art (structure + vocabulary, verified independently below, MIT):
//   https://github.com/ha-parcel-integrations/ha-inpost (const.py,
//   parcels.py normalize_tracking_parcel/TRACKING_STATUS_MAP, tests).
//   Two public surfaces exist: the ShipX tracking endpoint
//   (api-shipx-pl.easypack24.net, keyless, but its success shape is
//   unconfirmed) and the inposteasy.com per-country hubs below. Only the
//   inposteasy hub is implemented here; ShipX remains a future lead.
// - Live verification 2026-09-10: GET
//   https://inposteasy.com/api/tracking/000000000000000000000000 returns
//   HTTP 404 with a structured NOT_FOUND problem body in ~0.2s, no cookies,
//   headers or account. Long-expired corpus numbers return the same 404.
// - Public cross-border status vocabulary live-confirmed on IT/PT/GB
//   consignments 2026-08-31 by the prior-art client. It is explicitly still
//   being observed, so — unlike closed vocabularies — an unmapped code is
//   reported as unknown with its raw code preserved, never invented movement.
const TRACKING_ENDPOINT = 'https://inposteasy.com/api/tracking';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENTS_TO_RETURN = 20;

interface ClassifiedStatus {
  status: CarrierStatus;
  stage: Stage;
}

const TRACKING_STATUS: Record<string, ClassifiedStatus> = {
  // Creation and handover.
  'CRE.1001': { status: 'pending', stage: 'registered' },
  'FMD.1001': { status: 'pending', stage: 'registered' },
  'FMD.1002': { status: 'in_transit', stage: 'in_transit' },
  // Logistics-centre movement.
  'MMD.1001': { status: 'in_transit', stage: 'in_transit' },
  'MMD.1002': { status: 'in_transit', stage: 'in_transit' },
  'MMD.1003': { status: 'in_transit', stage: 'in_transit' },
  'MMD.1004': { status: 'in_transit', stage: 'in_transit' },
  // Last-mile, redirects and collection.
  'LMD.1001': { status: 'in_transit', stage: 'in_transit' },
  'LMD.1002': { status: 'in_transit', stage: 'in_transit' },
  'LMD.3006': { status: 'in_transit', stage: 'in_transit' },
  'LMD.3014': { status: 'in_transit', stage: 'in_transit' },
  'LMD.1004': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'LMD.1005': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'LMD.9001': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'LMD.9002': { status: 'exception', stage: 'failed_attempt' },
  'LMD.9014': { status: 'exception', stage: 'returned' },
  // Terminal outcomes.
  'EOL.1001': { status: 'delivered', stage: 'delivered' },
  'EOL.1003': { status: 'delivered', stage: 'delivered' },
  'EOL.9001': { status: 'exception', stage: 'failed_attempt' },
  'RTS.1001': { status: 'exception', stage: 'returned' },
  'RTS.1002': { status: 'exception', stage: 'returned' },
};

function clean(value: unknown, maxLength = 500): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function statusCode(value: unknown): string {
  return clean(value, 32).toLocaleUpperCase('en-US');
}

function parsedTime(value: unknown): { iso: string; timestamp: number } | null {
  const raw = clean(value, 64);
  if (!raw) return null;
  // Observed event datetimes carry explicit offsets; require them rather than
  // assigning a zone to a multi-country lane (PL/IT/PT/GB hubs share this API).
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return null;
  const parsed = DateTime.fromISO(raw, { setZone: true });
  const iso = parsed.isValid ? parsed.toISO({ suppressMilliseconds: true }) : null;
  return iso ? { iso, timestamp: parsed.toMillis() } : null;
}

export class InpostTrackingError extends Error {
  readonly status = 404;

  constructor() {
    super('InPost could not locate the shipment');
    this.name = 'InpostTrackingError';
  }
}

export function normalizeInpostTrackingNumber(raw: string): string {
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^(?:\d{24}|JJD\d{16}|JD\d{16}|8YDR\d{9})$/.test(value)) {
    throw new TypeError('InPost tracking requires a 24-digit, JJD/JD legacy or 8YDR identifier');
  }
  return value;
}

export function parseInpostTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizeInpostTrackingNumber(trackingNumber);
  if (!isRecord(payload)) throw new TypeError('InPost returned an invalid tracking response');
  const returned = clean(payload.trackingNumber, 64).toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!returned) throw new TypeError('InPost did not return a shipment identifier');
  if (returned !== requested) throw new RangeError('InPost returned a different shipment');
  const code = statusCode(payload.status);
  const classified = TRACKING_STATUS[code];
  const rawDetails = payload.trackingDetails;
  if (rawDetails !== undefined && !Array.isArray(rawDetails)) {
    throw new TypeError('InPost returned invalid tracking history');
  }
  const parsed: Array<{ event: CarrierEvent; timestamp: number; index: number }> = [];
  const seen = new Set<string>();
  (Array.isArray(rawDetails) ? rawDetails : []).filter(isRecord).slice(0, 500).forEach((rawEvent, index) => {
    const eventCode = statusCode(rawEvent.status);
    const eventClassified = TRACKING_STATUS[eventCode];
    const time = parsedTime(rawEvent.datetime);
    // statusTitle is the backend's fixed English wording for the requested hub.
    // Origin/destination country codes travel alongside the parcel but feed no
    // retained field: only normalized status and timeline fields are projected.
    const description = clean(rawEvent.statusTitle, 500) || eventCode;
    if (!time || !description) return;
    const identity = `${time.iso}\u0000${description}\u0000${eventCode}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    parsed.push({
      event: {
        time: time.iso,
        location: '',
        description,
        stage: eventClassified ? eventClassified.stage : 'in_transit',
      },
      timestamp: time.timestamp,
      index,
    });
  });
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const events = parsed.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);
  if (!classified) {
    return {
      status: 'unknown',
      last_status_text: clean(payload.statusTitle, 500) || clean(payload.statusDescription, 500) || code || 'Tracking information received',
      last_update: events[0]?.time ?? null,
      expected_delivery: null,
      events,
    };
  }
  return {
    status: classified.status,
    current_stage: classified.stage,
    last_status_text: clean(payload.statusTitle, 500) || clean(payload.statusDescription, 500) || code,
    last_update: events[0]?.time ?? null,
    expected_delivery: null,
    events,
  };
}

export class InpostTracker {
  readonly timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('InPost timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizeInpostTrackingNumber(rawTrackingNumber);
    const url = `${TRACKING_ENDPOINT}/${encodeURIComponent(trackingNumber)}`;
    const { response, bytes } = await fetchBounded(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
      },
    }, {
      provider: 'InPost tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      retryTransient: true,
      allowHttpError: true,
    });
    if (response.status === 404) throw new InpostTrackingError();
    if (!response.ok) throw new UpstreamHttpError('InPost tracking', response.status);
    return parseInpostTrackingResponse(parseJsonBytes(bytes, 'InPost tracking'), trackingNumber);
  }
}
