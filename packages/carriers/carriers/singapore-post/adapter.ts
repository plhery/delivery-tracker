import 'server-only';

import { DateTime } from 'luxon';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { IndeterminateError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { EXPLICIT_OFFSET_PATTERN, explicitOffsetTime } from '../../core/time';
import { clean, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord } from '../../core/types';
import { singaporePostStatus } from './status';

const ENDPOINT = 'https://www.singpost.com/api/services/track-events';

export function normalizeSingaporePostNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^[A-Z0-9]{8,30}$/.test(number)) throw new TypeError('Singapore Post requires an alphanumeric parcel reference');
  return number;
}

function eventTime(value: unknown): Pick<CarrierEvent, 'time'> & { local_time?: string } {
  const raw = clean(value, 64);
  if (EXPLICIT_OFFSET_PATTERN.test(raw)) {
    const parsed = explicitOffsetTime(raw);
    if (!parsed) throw new SchemaError('Singapore Post', 'Singapore Post returned an invalid event date');
    return { time: parsed.iso };
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(raw)) throw new SchemaError('Singapore Post', 'Singapore Post returned an invalid event date');
  const parsed = DateTime.fromISO(raw, { zone: 'UTC' });
  if (!parsed.isValid) throw new SchemaError('Singapore Post', 'Singapore Post returned an invalid event date');
  // Speedpost scans omit offsets, including destination events. Keep that
  // uncertainty and the portal's newest-first order rather than assign +08.
  return { local_time: parsed.toISO({ suppressMilliseconds: true, includeOffset: false })! };
}

export function parse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = normalizeSingaporePostNumber(trackingNumber);
  if (!isRecord(payload) || payload.ok !== true || !Array.isArray(payload.items)) throw new SchemaError('Singapore Post');
  const matches = payload.items.filter((item) => isRecord(item) && clean(item.trackingNumber, 64).toUpperCase() === number);
  if (matches.length !== 1 || !isRecord(matches[0])) throw new SchemaError('Singapore Post', 'Singapore Post returned a different or ambiguous shipment');
  const item = matches[0];
  if (item.trackingNumberFound === 'false' && Array.isArray(item.events) && item.events.length === 0) throw new NotFoundError('Singapore Post');
  if (item.trackingNumberFound !== 'true' || !Array.isArray(item.events)) throw new SchemaError('Singapore Post');
  if (item.events.length === 0) throw new IndeterminateError('Singapore Post', 'Singapore Post returned no parcel scans');
  if (item.events.length > 500) throw new SchemaError('Singapore Post');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const raw of item.events) {
    if (!isRecord(raw)) throw new SchemaError('Singapore Post');
    const description = clean(raw.statusDescription, 500);
    if (!description || description === '-') throw new SchemaError('Singapore Post', 'Singapore Post returned an empty scan');
    const time = eventTime(raw.date);
    const rawLocation = clean(raw.location, 200);
    const location = rawLocation === '-' ? '' : rawLocation;
    const code = clean(raw.eventDescription, 64) || clean(raw.aceStatusCode, 64);
    const key = JSON.stringify([time, description, location, code]);
    if (seen.has(key)) continue;
    seen.add(key);
    const classified = singaporePostStatus(code);
    events.push({ ...time, description, location, ...(code ? { provider_code: code } : {}), ...(classified ? { stage: classified.stage } : {}) });
  }
  const latest = events[0]!;
  const classified = singaporePostStatus(latest.provider_code ?? '');
  const country = clean(item.destinationCountry, 8).toUpperCase();
  return { status: classified?.status ?? 'unknown', ...(classified ? { current_stage: classified.stage } : {}),
    last_status_text: latest.description, last_update: latest.time ?? null,
    ...(/^[A-Z]{2}$/.test(country) ? { destination_country: country } : {}), events: events.slice(0, 100) };
}

export class SingaporePostTracker {
  constructor(private readonly options: { fetcher?: typeof fetch } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeSingaporePostNumber(raw);
    const budgetMs = context.budgetMs ?? 15_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('Singapore Post timeout must be positive');
    context.signal?.throwIfAborted();
    try {
      const { bytes } = await fetchBounded(ENDPOINT, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ trackingNumber: number }),
      }, { provider: 'Singapore Post', timeoutMs: Math.max(1, Math.floor(budgetMs)), maxBytes: 1_000_000,
        fetcher: (input, init) => (this.options.fetcher ?? fetch)(input, { ...init,
          signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]) }),
      });
      context.signal?.throwIfAborted();
      return parse(parseJsonBytes(bytes, 'Singapore Post'), number);
    } catch (error) {
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError('Singapore Post', 'Singapore Post tracking endpoint is unavailable', { cause: error });
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new SingaporePostTracker({ fetcher: environment.fetcher });
  return { id: 'singapore-post', steps: ['direct'], track: (input, context = {}) => runSteps({ carrier: 'singapore-post', budgetMs: context.budgetMs ?? 15_000,
    signal: context.signal, recorder: environment.recorder }, [{ id: 'direct', run: ({ signal, remainingMs }) => tracker.fetch(input.number, { signal, budgetMs: remainingMs }) }]) };
};
