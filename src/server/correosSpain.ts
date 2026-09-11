import 'server-only';

import { DateTime } from 'luxon';
import { fetchBounded, parseJsonBytes, UpstreamHttpError } from './boundedFetch';
import type { CarrierEvent, CarrierResult, CarrierStatus } from './carrierResult';
import type { Stage } from '../types';
import { isRecord } from './types';

// Protocol provenance:
// - Prior art (structure + vocabulary, verified independently below, MIT):
//   https://github.com/ha-parcel-integrations/ha-correos (api.py, parcels.py,
//   tests/payloads.py — keyless localizador endpoint, codError envelope,
//   event shape, Europe/Madrid split timestamps, full status map).
// - Live verification 2026-09-10: unknown codes answer HTTP 200 with
//   [0].error.codError "3" (Sin Trazabilidad en Minerva) and eventos:null.
//   The transport status is always 200; only the envelope decides.
// - Success shape confirmed against a real ES parcel 2026-08-24 by the
//   prior-art client (admitted → classified → out-for-delivery → failed
//   attempt → office hold → collected). The vocabulary below is explicitly
//   still observed, so — unlike closed vocabularies — an unmapped code is
//   reported as unknown with its raw wording preserved, never a wrong status.
const TRACKING_ENDPOINT = 'https://localizador.correos.es/canonico/eventos_envio_servicio';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENTS_TO_RETURN = 20;

interface ClassifiedStatus {
  status: CarrierStatus;
  stage: Stage;
}

const EVENT_STATUS: Record<string, ClassifiedStatus> = {
  'A010000V': { status: 'pending', stage: 'registered' },
  'A090000V': { status: 'pending', stage: 'registered' },
  'X010000V': { status: 'pending', stage: 'registered' },
  'P040000V': { status: 'in_transit', stage: 'in_transit' },
  'P100000V': { status: 'in_transit', stage: 'in_transit' },
  'P110000V': { status: 'in_transit', stage: 'in_transit' },
  'P101110V': { status: 'in_transit', stage: 'in_transit' },
  'P101120V': { status: 'in_transit', stage: 'in_transit' },
  'P090000V': { status: 'in_transit', stage: 'in_transit' },
  'G01L010V': { status: 'in_transit', stage: 'in_transit' },
  'H01I360V': { status: 'in_transit', stage: 'in_transit' },
  'X020000V': { status: 'in_transit', stage: 'in_transit' },
  'X040000V': { status: 'in_transit', stage: 'in_transit' },
  'X060000V': { status: 'in_transit', stage: 'in_transit' },
  'X070000V': { status: 'in_transit', stage: 'in_transit' },
  'X110100V': { status: 'in_transit', stage: 'in_transit' },
  'H020000V': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'X080000V': { status: 'out_for_delivery', stage: 'out_for_delivery' },
  'H01I350V': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'X380000V': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'X390000V': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  // Community-integration reconstructions, not yet re-observed: kept, but an
  // unmapped code elsewhere still reports unknown rather than guessing.
  'L010000V': { status: 'out_for_delivery', stage: 'ready_for_pickup' },
  'I01H210V': { status: 'delivered', stage: 'delivered' },
  'X120000V': { status: 'delivered', stage: 'delivered' },
  'I010000V': { status: 'delivered', stage: 'delivered' },
  'H010930R': { status: 'exception', stage: 'failed_attempt' },
  'H06P010V': { status: 'exception', stage: 'failed_attempt' },
  'X090100R': { status: 'exception', stage: 'failed_attempt' },
  'X090060R': { status: 'exception', stage: 'failed_attempt' },
  'X130000R': { status: 'exception', stage: 'failed_attempt' },
  'M01E020R': { status: 'exception', stage: 'failed_attempt' },
  'EOL.9001': { status: 'exception', stage: 'failed_attempt' },
  'O140000V': { status: 'exception', stage: 'returned' },
};

function clean(value: unknown, maxLength = 500): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function parsedTime(dateValue: unknown, timeValue: unknown): { iso: string; timestamp: number } | null {
  const date = clean(dateValue, 16);
  if (!date) return null;
  // Correos splits timestamps into fecEvento (DD/MM/YYYY) and horEvento
  // (HH:MM:SS, midnight when absent) in Spanish local time. Mainland Spain is
  // Europe/Madrid; Canary Islands scans stamped the same way can be off by one
  // hour — documented here rather than solved, as events carry no locality.
  const parsed = DateTime.fromFormat(
    `${date} ${clean(timeValue, 16) || '00:00:00'}`,
    'dd/MM/yyyy HH:mm:ss',
    { zone: 'Europe/Madrid', locale: 'es-ES' },
  );
  const iso = parsed.isValid ? parsed.toISO({ suppressMilliseconds: true }) : null;
  return iso ? { iso, timestamp: parsed.toMillis() } : null;
}

export class CorreosSpainTrackingError extends Error {
  readonly status = 404;

  constructor() {
    super('Correos could not locate the shipment');
    this.name = 'CorreosSpainTrackingError';
  }
}

export function normalizeCorreosSpainTrackingNumber(raw: string): string {
  // The localizador accepts any Correos-issued code (S10 ES, PQ domestic,
  // PR-prefixed); the codError envelope — not the shape — decides unknown.
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^[A-Z0-9]{4,40}$/.test(value) || !/\d/.test(value)) {
    throw new TypeError('Correos tracking requires a tracking code with letters, numbers and a digit');
  }
  return value;
}

export function correosSpainTrackingUrl(rawTrackingNumber: string): string {
  const url = new URL('https://www.correos.es/es/es/herramientas/localizador/envios/detalle');
  url.searchParams.set('tracking-number', normalizeCorreosSpainTrackingNumber(rawTrackingNumber));
  return url.toString();
}

export function parseCorreosSpainTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizeCorreosSpainTrackingNumber(trackingNumber);
  // The endpoint answers a single-element array; bare objects are accepted too
  // since some error bodies come back unwrapped.
  const envelope = Array.isArray(payload) ? payload[0] : payload;
  if (!isRecord(envelope)) throw new TypeError('Correos returned an invalid tracking response');
  const returned = clean(envelope.codEnvio, 64).toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!returned) throw new TypeError('Correos did not return a shipment identifier');
  if (returned !== requested) throw new RangeError('Correos returned a different shipment');
  const error = envelope.error;
  if (!isRecord(error) || error.codError == null) {
    throw new TypeError('Correos returned a response without a result envelope');
  }
  // Any non-zero codError (e.g. "3" Sin Trazabilidad) means unknown or
  // not-yet-scanned: a domain outcome, never a transport failure.
  if (String(error.codError) !== '0') throw new CorreosSpainTrackingError();
  const rawEvents = envelope.eventos;
  if (rawEvents !== undefined && !Array.isArray(rawEvents)) {
    throw new TypeError('Correos returned invalid tracking history');
  }
  const parsed: Array<{ event: CarrierEvent; classified: ClassifiedStatus | undefined; timestamp: number; index: number }> = [];
  const seen = new Set<string>();
  (Array.isArray(rawEvents) ? rawEvents : []).filter(isRecord).slice(0, 500).forEach((rawEvent, index) => {
    const code = clean(rawEvent.codEvento, 32).toLocaleUpperCase('en-US');
    // desTextoResumen is the backend's fixed Spanish wording. Customer names,
    // dimensions, delivery slots and office blocks travel on the envelope but
    // are deliberately never retained.
    const description = clean(rawEvent.desTextoResumen, 500) || code;
    const time = parsedTime(rawEvent.fecEvento, rawEvent.horEvento);
    if (!time || !description) return;
    const identity = `${time.iso}\u0000${description}\u0000${code}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const classified = EVENT_STATUS[code];
    parsed.push({
      event: {
        time: time.iso,
        location: '',
        description,
        stage: classified ? classified.stage : 'in_transit',
      },
      classified,
      timestamp: time.timestamp,
      index,
    });
  });
  // The localizador lists oldest first; the parcel state is the latest entry.
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const events = parsed.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);
  const latest = parsed[0];
  if (!latest) {
    return {
      status: 'unknown',
      last_status_text: clean(envelope.resumen_ultimo, 500) || 'Tracking information received',
      last_update: null,
      expected_delivery: null,
      events,
    };
  }
  if (!latest.classified) {
    return {
      status: 'unknown',
      last_status_text: latest.event.description,
      last_update: latest.event.time ?? null,
      expected_delivery: null,
      events,
    };
  }
  return {
    status: latest.classified.status,
    current_stage: latest.classified.stage,
    last_status_text: latest.event.description,
    last_update: latest.event.time ?? null,
    expected_delivery: null,
    events,
  };
}

export class CorreosSpainTracker {
  readonly timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Correos tracking timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizeCorreosSpainTrackingNumber(rawTrackingNumber);
    const url = `${TRACKING_ENDPOINT}/${encodeURIComponent(trackingNumber)}`
      + '?codAplicacion=60&codCanal=3&codIdioma=ES&indUltEvento=N';
    const { response, bytes } = await fetchBounded(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
      },
    }, {
      provider: 'Correos tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      retryTransient: true,
      allowHttpError: true,
    });
    if (!response.ok) throw new UpstreamHttpError('Correos tracking', response.status);
    return parseCorreosSpainTrackingResponse(parseJsonBytes(bytes, 'Correos tracking'), trackingNumber);
  }
}
