import type { AdapterFactory } from '../../core/adapter';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import { fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord, type JsonObject } from '../../core/types';
import { hermesEventStage, hermesStatus } from './status';

export { hermesStatus };

// Hermes Einrichtungs-Service (two-man furniture and white-goods delivery) is a
// different company from Hermes Germany's parcel network; its public order
// lookup lives on myhes.de and takes the consignment number alone.
const HERMES_API = 'https://myhes.de/api/request/auftragsdaten';
const PROVIDER = 'Hermes';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface HermesOptions {
  timeoutMs?: number;
  /** Test seam; production uses the global fetch. */
  fetcher?: typeof fetch;
}

function normalizeHermesTrackingNumber(raw: unknown): string {
  return String(raw ?? '').replace(/[\s.-]/g, '').toUpperCase();
}

export function parseHermesTrackingResponse(
  payload: unknown,
  trackingNumber: string,
): CarrierResult {
  if (!isRecord(payload)) throw new SchemaError(PROVIDER, 'Hermes returned an invalid tracking response');
  const body = isRecord(payload.body) ? payload.body : payload;
  if (!isRecord(body.auftragsdaten)) {
    throw new SchemaError(PROVIDER, 'Hermes returned an invalid tracking response');
  }
  const order = body.auftragsdaten;
  if (
    !order.lieferscheinnummer
    || normalizeHermesTrackingNumber(order.lieferscheinnummer)
      !== normalizeHermesTrackingNumber(trackingNumber)
  ) throw new SchemaError(PROVIDER, 'Hermes returned a different shipment');
  const journey = isRecord(order.statusjourneyDto) ? order.statusjourneyDto : {};
  if (journey.auftragstatusdaten !== undefined && !Array.isArray(journey.auftragstatusdaten)) {
    throw new SchemaError(PROVIDER, 'Hermes returned invalid tracking history');
  }
  // Hermes's own public UI treats auftragstatusdaten as the customer-facing
  // timeline. statusdaten contains a second, internal operational stream with
  // duplicate scans and different identifiers, so it is intentionally ignored.
  const rawEvents: JsonObject[] = Array.isArray(journey.auftragstatusdaten)
    ? journey.auftragstatusdaten.filter(isRecord)
    : [];
  // The public API answers a valid, unknown 8- or 9-digit consignment with a
  // synthetic order whose identifying/status fields are all null. Do not turn
  // that placeholder into a real-looking pending parcel.
  if (
    rawEvents.length === 0
    && order.auftragId == null
    && order.auftragsart == null
    && order.statusjourneyDto == null
  ) throw new NotFoundError(PROVIDER);
  const meaningfulEvents = rawEvents.filter((event) => (
    String(event.sendungsstatus ?? '').trim()
    && String(event.sendungsstatusBuchungszeitpunkt ?? '').trim()
  ));
  meaningfulEvents.sort((left, right) => String(right.sendungsstatusBuchungszeitpunkt ?? '')
    .localeCompare(String(left.sendungsstatusBuchungszeitpunkt ?? '')));
  const events = meaningfulEvents.map((event) => ({
    time: String(event.sendungsstatusBuchungszeitpunkt ?? ''),
    location: '',
    description: String(event.sendungsstatus),
    stage: hermesEventStage(event.sendungsstatusId, event.sendungsstatus),
  }));
  return {
    status: meaningfulEvents[0]
      ? hermesStatus(meaningfulEvents[0].sendungsstatusId, meaningfulEvents[0].sendungsstatus)
      : 'pending',
    last_status_text: events[0]?.description ?? '',
    last_update: events[0]?.time || null,
    expected_delivery: typeof order.lieferdatum === 'string'
      ? order.lieferdatum
      : typeof order.hesBasicLieferterminZeit === 'string'
        ? order.hesBasicLieferterminZeit
        : null,
    timezone: 'Europe/Berlin',
    events,
  };
}

export class HermesTracker {
  readonly timeoutMs: number;
  readonly #fetcher: typeof fetch | undefined;

  constructor(options: number | HermesOptions = {}) {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, fetcher } = typeof options === 'number'
      ? { timeoutMs: options, fetcher: undefined }
      : options;
    this.timeoutMs = timeoutMs;
    this.#fetcher = fetcher;
  }

  async fetch(trackingNumber: string): Promise<CarrierResult> {
    const url = new URL(HERMES_API);
    url.searchParams.set('parcelNumber', trackingNumber);
    const { bytes } = await fetchBounded(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; SwissDeliveryTracker/1.0)',
      },
    }, {
      provider: 'Hermes tracking',
      timeoutMs: this.timeoutMs,
      ...(this.#fetcher ? { fetcher: this.#fetcher } : {}),
    });
    return parseHermesTrackingResponse(parseJsonBytes(bytes, PROVIDER), trackingNumber);
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new HermesTracker({ fetcher: environment.fetcher });
  return {
    id: 'hermes',
    steps: ['direct'],
    track: (input) => tracker.fetch(input.number),
  };
};
