import 'server-only';

import type { AdapterFactory } from '../../core/adapter';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import type { ClassifiedStatus } from '../../core/status';
import { zonedTime } from '../../core/time';
import { clean, fetchBounded, parseJsonBytes, UpstreamHttpError } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyCorreosSpainStatus } from './status';

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
//   attempt → office hold → collected); the map lives in status.ts.
const TRACKING_ENDPOINT = 'https://localizador.correos.es/canonico/eventos_envio_servicio';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENTS_TO_RETURN = 20;

function parsedTime(dateValue: unknown, timeValue: unknown): { iso: string; timestamp: number } | null {
  const date = clean(dateValue, 16);
  if (!date) return null;
  // Correos splits timestamps into fecEvento (DD/MM/YYYY) and horEvento
  // (HH:MM:SS, midnight when absent) in Spanish local time. Mainland Spain is
  // Europe/Madrid; Canary Islands scans stamped the same way can be off by one
  // hour — documented here rather than solved, as events carry no locality.
  return zonedTime(
    `${date} ${clean(timeValue, 16) || '00:00:00'}`,
    'dd/MM/yyyy HH:mm:ss',
    'Europe/Madrid',
    { locale: 'es-ES' },
  );
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
  if (!isRecord(envelope)) throw new SchemaError('Correos', 'Correos returned an invalid tracking response');
  const returned = clean(envelope.codEnvio, 64).toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!returned) throw new SchemaError('Correos', 'Correos did not return a shipment identifier');
  if (returned !== requested) throw new SchemaError('Correos', 'Correos returned a different shipment');
  const error = envelope.error;
  if (!isRecord(error) || error.codError == null) {
    throw new SchemaError('Correos', 'Correos returned a response without a result envelope');
  }
  // Any non-zero codError (e.g. "3" Sin Trazabilidad) means unknown or
  // not-yet-scanned: a domain outcome, never a transport failure.
  if (String(error.codError) !== '0') throw new NotFoundError('Correos');
  const rawEvents = envelope.eventos;
  if (rawEvents !== undefined && !Array.isArray(rawEvents)) {
    throw new SchemaError('Correos', 'Correos returned invalid tracking history');
  }
  const parsed: Array<{ event: CarrierEvent; classified: ClassifiedStatus | undefined; timestamp: number; index: number }> = [];
  const seen = new Set<string>();
  (Array.isArray(rawEvents) ? rawEvents : []).filter(isRecord).slice(0, 500).forEach((rawEvent, index) => {
    const code = clean(rawEvent.codEvento, 32).toLocaleUpperCase('en-US');
    // desTextoResumen is the backend's fixed Spanish wording.
    const description = clean(rawEvent.desTextoResumen, 500) || code;
    const time = parsedTime(rawEvent.fecEvento, rawEvent.horEvento);
    if (!time || !description) return;
    const identity = `${time.iso}\u0000${description}\u0000${code}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const classified = classifyCorreosSpainStatus(code);
    parsed.push({
      // An unmapped code keeps no stage: the sync classifies the wording and
      // records where the stage came from instead of assuming movement here.
      event: {
        time: time.iso,
        location: '',
        description,
        ...(classified ? { stage: classified.stage } : {}),
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
  // Office name (nom_codired), weight (peso grams) and dimensions travel on
  // the envelope. The office is only a pickup signal when the parcel is
  // actually awaiting collection; weight/dims are operational parcel data.
  const office = clean(envelope.nom_codired, 300) || null;
  const grams = Number(envelope.peso);
  const weightKg = Number.isFinite(grams) && grams > 0 ? Math.round((grams / 1000) * 1000) / 1000 : null;
  const dims = [envelope.largo, envelope.ancho, envelope.alto].map((value) => Number(value));
  const dimensionsText = dims.every((value) => Number.isFinite(value) && value > 0)
    ? `${dims[0]} x ${dims[1]} x ${dims[2]} cm` : null;
  // nombre_cliente names a person in the doorstep case, so it is never
  // projected (PRIVACY.md); weight and dimensions are operational parcel data.
  const extras = {
    ...(weightKg != null ? { weight_kg: weightKg } : {}),
    ...(dimensionsText ? { dimensions_text: dimensionsText } : {}),
  };
  const pickupExtras = (stage?: string): Record<string, string> => (
    stage === 'ready_for_pickup' && office ? { pickup_point: office } : {}
  );
  if (!latest) {
    return {
      status: 'unknown',
      last_status_text: clean(envelope.resumen_ultimo, 500) || 'Tracking information received',
      last_update: null,
      expected_delivery: null,
      ...extras,
      events,
    };
  }
  if (!latest.classified) {
    return {
      status: 'unknown',
      last_status_text: latest.event.description,
      last_update: latest.event.time ?? null,
      expected_delivery: null,
      ...extras,
      ...pickupExtras(latest.event.stage),
      events,
    };
  }
  const deliveredAt = latest.classified.status === 'delivered' ? latest.event.time ?? null : null;
  return {
    status: latest.classified.status,
    current_stage: latest.classified.stage,
    last_status_text: latest.event.description,
    last_update: latest.event.time ?? null,
    expected_delivery: null,
    ...extras,
    ...pickupExtras(latest.classified.stage),
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}),
    events,
  };
}

export class CorreosSpainTracker {
  readonly timeoutMs: number;
  readonly fetcher: typeof fetch | undefined;

  constructor(options: { timeoutMs?: number; fetcher?: typeof fetch } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetcher = options.fetcher;
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
      fetcher: this.fetcher,
    });
    if (!response.ok) throw new UpstreamHttpError('Correos tracking', response.status);
    return parseCorreosSpainTrackingResponse(parseJsonBytes(bytes, 'Correos tracking'), trackingNumber);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new CorreosSpainTracker({ fetcher: environment.fetcher });
  return {
    id: 'correos-spain',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
