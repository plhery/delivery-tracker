import 'server-only';

import { fetchBounded, parseJsonBytes, UpstreamHttpError } from './boundedFetch';
import type { CarrierEvent, CarrierResult, CarrierStatus } from './carrierResult';
import type { Stage } from '../types';
import { isRecord } from './types';

// Protocol provenance:
// - Prior art (structure + vocabulary, verified independently below, MIT):
//   https://github.com/ha-parcel-integrations/ha-poste-italiane (api.py,
//   parcels.py status map, tests/payloads.py — keyless DoveQuando endpoint,
//   esitoRicerca envelope, epoch-millis dataOra, Europe/Rome ETA text).
// - Live verification 2026-09-10: unknown codes answer HTTP 200 with
//   esitoRicerca "1"; old expired parcels answer without esitoRicerca and
//   with empty listaMovimenti. The success vocabulary below was confirmed
//   against a real parcel 2026-08-24 by the prior-art client.
// - Deep link verified live in a real browser session: .../cerca/index.html
//   #/risultati-spedizioni/{code} resolves the code and renders the tracker
//   (expired parcels show the documented "Tracciatura non disponibile").
// - The Italian status vocabulary is explicitly still observed, so — unlike
//   closed vocabularies — unmapped wording reports unknown with its raw text
//   preserved, never a wrong status.
const TRACKING_ENDPOINT = 'https://www.poste.it/online/dovequando/DQ-REST/ricercasemplice';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_EVENTS_TO_RETURN = 20;

interface ClassifiedStatus {
  status: CarrierStatus;
  stage: Stage;
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('it-IT') : '';
}

function classifyPosteItalianeStatus(raw: string): ClassifiedStatus | undefined {
  const value = raw;
  if (!value) return undefined;
  if (value.startsWith('la spedizione è stata presa in carico')
    || value.startsWith('da un nostro operatore presso l\u2019ufficio postale')
    || value.startsWith('da un nostro operatore presso l\'ufficio postale')
    || value === 'a seguito di acquisto da poste.it') return { status: 'pending', stage: 'registered' };
  if (value.startsWith('la spedizione è in transito')
    || value.startsWith('completata la fase di verifica per lo svincolo')
    || value.startsWith('consegna non andata a buon fine')) {
    return value.startsWith('consegna non andata a buon fine')
      ? { status: 'exception', stage: 'failed_attempt' }
      : { status: 'in_transit', stage: 'in_transit' };
  }
  if (value.startsWith('in restituzione al mittente')) return { status: 'exception', stage: 'returned' };
  switch (value) {
    case 'la spedizione è in consegna':
      return { status: 'out_for_delivery', stage: 'out_for_delivery' };
    case 'la spedizione è stata consegnata':
    // ASCII-apostrophe variant observed live on a delivered parcel.
    case "la spedizione e' stata consegnata":
    case 'con successo in data':
      return { status: 'delivered', stage: 'delivered' };
    case 'all\u2019estero':
    case 'all\'estero':
    case 'presso il paese estero in data':
    case 'in data':
      return { status: 'in_transit', stage: 'in_transit' };
    case 'sono in corso delle verifiche sulla spedizione. contatta assistenza':
      return { status: 'exception', stage: 'failed_attempt' };
    case 'disponibile per il ritiro dal giorno lavorativo successivo alla data indicata':
      return { status: 'out_for_delivery', stage: 'ready_for_pickup' };
    default:
      return undefined;
  }
}

const ITALIAN_MONTHS: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

function expectedDeliveryDay(value: unknown): string | null {
  // dataPrevistaConsegna reads like "Consegna prevista entro Giovedì 1 Gennaio
  // 2026": reduce it to the local calendar day, never a timestamp.
  if (typeof value !== 'string') return null;
  // Note: \w is ASCII-only in JS without the u flag and would choke on accented
  // weekday names like "Venerdì", so the weekday group excludes spaces/digits
  // instead (Python's \w would have matched; kept equivalent here).
  const match = /(?:consegna prevista(?: entro)?\s+)(?:[^\s\d]+\s+)?(\d{1,2})\s+([a-zà]+)\s+(\d{4})/i.exec(value);
  if (!match) return null;
  const month = ITALIAN_MONTHS[match[2]!.toLocaleLowerCase('it-IT')];
  if (!month) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (!Number.isInteger(day) || day < 1 || day > 31 || !Number.isInteger(year)) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function clean(value: unknown, maxLength = 500): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function parsedTime(value: unknown): { iso: string; timestamp: number } | null {
  // dataOra is epoch milliseconds (numbers, occasionally numeric strings).
  const millis = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(millis) || millis <= 0) return null;
  const iso = new Date(millis).toISOString();
  return { iso, timestamp: millis };
}

export class PosteItalianeTrackingError extends Error {
  readonly status = 404;

  constructor() {
    super('Poste Italiane could not locate the shipment');
    this.name = 'PosteItalianeTrackingError';
  }
}

export function normalizePosteItalianeTrackingNumber(raw: string): string {
  // Mirrors number detection: RA/1UW/3UW/5P/2IMA families. Anything else stays
  // with the generic postal fallback — those routes were never sampled here.
  const value = raw.toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!/^(?:RA\d{11}|[13]UW[A-Z0-9]{10}|5P[A-Z0-9]{11}|2IMA\d{10})$/.test(value)) {
    throw new TypeError('Poste Italiane tracking requires a Poste Italiane parcel identifier');
  }
  return value;
}

export function posteItalianeTrackingUrl(rawTrackingNumber: string): string {
  return `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${encodeURIComponent(normalizePosteItalianeTrackingNumber(rawTrackingNumber))}`;
}

export function parsePosteItalianeTrackingResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const requested = normalizePosteItalianeTrackingNumber(trackingNumber);
  if (!isRecord(payload)) throw new TypeError('Poste Italiane returned an invalid tracking response');
  const returned = clean(payload.idTracciatura, 64).toLocaleUpperCase('en-US').replace(/[\s.-]/g, '');
  if (!returned) throw new TypeError('Poste Italiane did not return a shipment identifier');
  if (returned !== requested) throw new RangeError('Poste Italiane returned a different shipment');
  const esito = clean(payload.esitoRicerca, 8);
  // Documented unknown outcomes: esito "1"/"2". Old expired parcels omit
  // esitoRicerca and carry empty movements — unknown-or-expired are
  // indistinguishable by design, and both are clean 404s, never failures.
  if (esito === '1' || esito === '2') throw new PosteItalianeTrackingError();
  const rawMovements = payload.listaMovimenti;
  if (rawMovements !== undefined && !Array.isArray(rawMovements)) {
    throw new TypeError('Poste Italiane returned invalid tracking history');
  }
  const parsed: Array<{ event: CarrierEvent; classified: ClassifiedStatus | undefined; timestamp: number; index: number }> = [];
  const seen = new Set<string>();
  (Array.isArray(rawMovements) ? rawMovements : []).filter(isRecord).slice(0, 500).forEach((rawEvent, index) => {
    const wording = clean(rawEvent.statoLavorazione, 500);
    const time = parsedTime(rawEvent.dataOra);
    if (!time || !wording) return;
    const identity = `${time.iso}\u0000${wording}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const classified = classifyPosteItalianeStatus(normalizedText(rawEvent.statoLavorazione));
    parsed.push({
      // luogo fields are dropped: nothing distinguishes a depot from a
      // recipient address without evidence. Sender, dimensions, flags and
      // pickup-office blocks on the envelope are never retained either.
      event: {
        time: time.iso,
        location: '',
        description: wording,
        stage: classified ? classified.stage : 'in_transit',
      },
      classified: classified ?? undefined,
      timestamp: time.timestamp,
      index,
    });
  });
  parsed.sort((left, right) => right.timestamp - left.timestamp || left.index - right.index);
  const events = parsed.slice(0, MAX_EVENTS_TO_RETURN).map(({ event }) => event);
  // Envelope stato "5" forces delivered; otherwise the newest mapped event wins
  // and unmapped wording stays unknown with its raw text preserved.
  if (String(payload.stato ?? '') === '5') {
    return {
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: events[0]?.description ?? 'Delivered',
      last_update: events[0]?.time ?? null,
      expected_delivery: null,
      events,
    };
  }
  const latest = parsed.find((item) => item.classified);
  if (!latest) {
    if (events.length > 0) {
      // Movements exist but none map: report unknown with the newest raw
      // wording preserved rather than a wrong status or a false pending.
      return {
        status: 'unknown',
        last_status_text: events[0]!.description,
        last_update: events[0]?.time ?? null,
        expected_delivery: expectedDeliveryDay(payload.dataPrevistaConsegna),
        events,
      };
    }
    if (esito === '3') {
      return {
        status: 'pending',
        current_stage: 'registered',
        last_status_text: 'Tracking information received',
        last_update: null,
        expected_delivery: expectedDeliveryDay(payload.dataPrevistaConsegna),
        events,
      };
    }
    throw new PosteItalianeTrackingError();
  }
  return {
    status: latest.classified!.status,
    current_stage: latest.classified!.stage,
    last_status_text: latest.event.description,
    last_update: latest.event.time ?? null,
    expected_delivery: expectedDeliveryDay(payload.dataPrevistaConsegna),
    events,
  };
}

export class PosteItalianeTracker {
  readonly timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError('Poste Italiane tracking timeout must be positive');
    }
  }

  async fetch(rawTrackingNumber: string): Promise<CarrierResult> {
    const trackingNumber = normalizePosteItalianeTrackingNumber(rawTrackingNumber);
    const { response, bytes } = await fetchBounded(TRACKING_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
        Origin: 'https://www.poste.it',
        Referer: 'https://www.poste.it/',
        'User-Agent': 'Mozilla/5.0 (compatible; DeliveryTracker/1.0)',
      },
      body: JSON.stringify({ codiceSpedizione: trackingNumber, tipoRichiedente: 'WEB', periodoRicerca: 1 }),
    }, {
      provider: 'Poste Italiane tracking',
      timeoutMs: this.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
      retryTransient: true,
      allowHttpError: true,
    });
    if (!response.ok) throw new UpstreamHttpError('Poste Italiane tracking', response.status);
    return parsePosteItalianeTrackingResponse(parseJsonBytes(bytes, 'Poste Italiane tracking'), trackingNumber);
  }
}
