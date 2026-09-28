import 'server-only';

import { accepted, recognizeFromLookup, type AdapterFactory, type TrackingContext } from '../../core/adapter';
import { isValidS10TrackingNumber, normalizeTrackingNumber } from '../../core/detection';
import { IndeterminateError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { explicitOffsetTime } from '../../core/time';
import { clean, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord } from '../../core/types';
import { austrianPostEventStatus, austrianPostSummaryStatus } from './status';

const PROVIDER = 'Austrian Post';
// Published in the official tracking form's data-sendungsapiurlpublic attribute;
// the official client calls this read without the optional account token.
const ENDPOINT = 'https://api.post.at/sendungen/sv/graphqlPublic';

export function normalizeAustrianPostNumber(raw: string): string {
  const number = normalizeTrackingNumber(raw);
  if (!/^\d{22}$/.test(number) && !(/^[A-Z]{2}\d{9}AT$/.test(number) && isValidS10TrackingNumber(number))) {
    throw new TypeError('Austrian Post requires a 22-digit or valid AT postal identifier');
  }
  return number;
}

export function parseAustrianPostResponse(payload: unknown, rawNumber: string): CarrierResult {
  const number = normalizeAustrianPostNumber(rawNumber);
  if (!isRecord(payload)) throw new SchemaError(PROVIDER);
  if (Array.isArray(payload.errors) && payload.errors.length) throw new IndeterminateError(PROVIDER, 'Austrian Post could not complete its tracking query');
  if (!isRecord(payload.data) || !Object.hasOwn(payload.data, 'einzelsendung')) throw new SchemaError(PROVIDER);
  const parcel = payload.data.einzelsendung;
  // This is the official client's positive not-found signature.
  if (parcel === null) throw new NotFoundError(PROVIDER);
  if (!isRecord(parcel) || clean(parcel.sendungsnummer, 64) !== number) throw new SchemaError(PROVIDER, 'Austrian Post returned a different shipment');
  if (!Array.isArray(parcel.sendungsEvents) || parcel.sendungsEvents.length > 500) throw new SchemaError(PROVIDER, 'Austrian Post returned invalid tracking history');
  const parsed: Array<{ event: CarrierEvent; timestamp: number; index: number }> = [];
  const seen = new Set<string>();
  parcel.sendungsEvents.forEach((raw, index) => {
    if (!isRecord(raw)) throw new SchemaError(PROVIDER, 'Austrian Post returned an invalid scan');
    const time = explicitOffsetTime(raw.timestamp);
    const description = clean(raw.trackingDesc, 500);
    if (!time || !description) throw new SchemaError(PROVIDER, 'Austrian Post returned an incomplete scan');
    const location = clean(raw.eventPlaceName, 200);
    const mapped = austrianPostEventStatus(clean(raw.status, 32), clean(raw.reasontypecode, 32), description);
    const key = JSON.stringify([time.iso, location, description]);
    if (seen.has(key)) return;
    seen.add(key);
    parsed.push({ event: { time: time.iso, description, ...(location ? { location } : {}), ...(mapped ? { stage: mapped.stage } : {}) }, timestamp: time.timestamp, index });
  });
  parsed.sort((a, b) => b.timestamp - a.timestamp || b.index - a.index);
  const events = parsed.slice(0, 100).map(({ event }) => event);
  const mapped = austrianPostSummaryStatus(clean(parcel.status, 32));
  if (!events.length) throw new IndeterminateError(PROVIDER, 'Austrian Post returned a shipment without tracking history');
  const weight = typeof parcel.weight === 'number' && Number.isFinite(parcel.weight) && parcel.weight > 0 ? parcel.weight : null;
  return {
    status: mapped?.status ?? 'unknown', ...(mapped ? { current_stage: mapped.stage } : {}),
    last_status_text: events[0]!.description!, last_update: events[0]!.time!, expected_delivery: null,
    ...(weight === null ? {} : { weight_kg: weight }), events,
  };
}

export class AustrianPostTracker {
  constructor(private readonly options: { fetcher?: typeof fetch; timeoutMs?: number } = {}) {}

  async fetch(rawNumber: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeAustrianPostNumber(rawNumber);
    const budgetMs = context.budgetMs ?? this.options.timeoutMs ?? 15_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('Austrian Post timeout must be positive');
    context.signal?.throwIfAborted();
    const query = `query { einzelsendung(sendungsnummer: "${number}") { sendungsnummer status weight sendungsEvents { timestamp status reasontypecode trackingDesc eventPlaceName } } }`;
    try {
      const { bytes } = await fetchBounded(ENDPOINT, {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
      }, {
        provider: PROVIDER, maxBytes: 1_000_000, timeoutMs: Math.max(1, Math.floor(budgetMs)),
        fetcher: (input, init) => (this.options.fetcher ?? fetch)(input, {
          ...init, signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]),
        }),
      });
      context.signal?.throwIfAborted();
      return parseAustrianPostResponse(parseJsonBytes(bytes, PROVIDER), number);
    } catch (error) {
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError(PROVIDER, 'Austrian Post tracking endpoint is unavailable', { cause: error });
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new AustrianPostTracker({ fetcher: environment.fetcher });
  return {
    id: 'austrian-post', steps: ['direct'], track: (input, context) => tracker.fetch(input.number, context),
    recognize: (number, context) => recognizeFromLookup(() => tracker.fetch(number, context), () => accepted(() => normalizeAustrianPostNumber(number))),
  };
};
