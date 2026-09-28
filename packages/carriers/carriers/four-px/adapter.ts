import 'server-only';

import { DateTime } from 'luxon';
import type { AdapterFactory, TrackingContext } from '../../core/adapter';
import { IndeterminateError, NotFoundError, SchemaError, TransportError, UpstreamHttpError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { clean, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord } from '../../core/types';
import { fourPxStatus } from './status';

const ENDPOINT = 'https://track.4px.com/track/v2/front/listTrackV3';

export function normalizeFourPxNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^[A-Z0-9]{8,40}$/.test(number)) throw new TypeError('4PX requires an alphanumeric parcel reference');
  return number;
}

function eventTime(raw: Record<string, unknown>): Pick<CarrierEvent, 'time'> & { local_time?: string } {
  const local = clean(raw.tkDateStr, 64);
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(local)) throw new SchemaError('4PX', '4PX returned an invalid scan time');
  const zone = clean(raw.tkTimezone, 32);
  const offset = /^UTC([+-]\d{2}:\d{2})$/.exec(zone)?.[1];
  if (zone && !offset && zone !== 'UTC') throw new SchemaError('4PX', '4PX returned an invalid scan offset');
  // The displayed time and offset form one pair. tkDate encodes different
  // clock digits and must not replace the portal's per-scan local timestamp.
  const parsed = DateTime.fromISO(`${local.replace(' ', 'T')}${offset ?? (zone === 'UTC' ? 'Z' : '')}`, { setZone: true, zone: 'UTC' });
  if (!parsed.isValid) throw new SchemaError('4PX', '4PX returned an invalid scan time');
  const iso = parsed.toISO({ suppressMilliseconds: true, includeOffset: Boolean(zone) })!;
  return zone ? { time: iso } : { local_time: iso };
}

export function parse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = normalizeFourPxNumber(trackingNumber);
  if (!isRecord(payload) || payload.result !== 1 || !Array.isArray(payload.data)) throw new SchemaError('4PX');
  const matches = payload.data.filter((item) => isRecord(item) && clean(item.queryCode, 64).toUpperCase() === number);
  if (matches.length !== 1 || !isRecord(matches[0])) throw new SchemaError('4PX', '4PX returned a different or ambiguous shipment');
  const item = matches[0];
  if (item.status === 7 && item.serverCode === null && item.shipperCode === null && item.tracks === null) throw new NotFoundError('4PX');
  if (item.mutiPackage === true) throw new IndeterminateError('4PX', '4PX returned a multi-package order requiring separate parcel history');
  if (!Array.isArray(item.tracks) || item.tracks.length === 0) throw new IndeterminateError('4PX', '4PX returned no parcel scans');
  if (item.tracks.length > 500) throw new SchemaError('4PX', '4PX returned excessive tracking history');
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const raw of item.tracks) {
    if (!isRecord(raw)) throw new SchemaError('4PX');
    const description = clean(raw.tkDesc, 500);
    if (!description) throw new SchemaError('4PX', '4PX returned an empty scan');
    const time = eventTime(raw);
    const location = clean(raw.tkLocation, 200);
    const code = clean(raw.tkCode, 64);
    const key = JSON.stringify([time, description, location, code]);
    if (seen.has(key)) continue;
    seen.add(key);
    const classified = fourPxStatus(code);
    events.push({ ...time, description, location, ...(code ? { provider_code: code } : {}), ...(classified ? { stage: classified.stage } : {}) });
  }
  const latest = events[0]!;
  const classified = fourPxStatus(latest.provider_code ?? '');
  const deliveryNumber = clean(item.serverCode, 64).toUpperCase();
  const country = clean(item.ctEndCode, 8).toUpperCase();
  return {
    status: classified?.status ?? 'unknown',
    ...(classified ? { current_stage: classified.stage } : {}),
    last_status_text: latest.description,
    last_update: latest.time ?? null,
    ...(classified?.stage === 'delivered' && latest.time ? { delivered_at: latest.time } : {}),
    ...(/^[A-Z]{2}$/.test(country) ? { destination_country: country } : {}),
    ...(deliveryNumber !== number && /^[A-Z0-9]{4,40}$/.test(deliveryNumber) ? { delivery_tracking_number: deliveryNumber } : {}),
    events: events.slice(0, 100),
  };
}

export class FourPxTracker {
  constructor(private readonly options: { fetcher?: typeof fetch } = {}) {}

  async fetch(raw: string, context: TrackingContext = {}): Promise<CarrierResult> {
    const number = normalizeFourPxNumber(raw);
    const budgetMs = context.budgetMs ?? 15_000;
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new TypeError('4PX timeout must be positive');
    context.signal?.throwIfAborted();
    try {
      const { bytes } = await fetchBounded(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ queryCodes: [number], language: 'en-us', translateLanguage: '' }),
      }, {
        provider: '4PX', timeoutMs: Math.max(1, Math.floor(budgetMs)), maxBytes: 1_000_000,
        fetcher: (input, init) => (this.options.fetcher ?? fetch)(input, { ...init,
          signal: AbortSignal.any([...(context.signal ? [context.signal] : []), ...(init?.signal ? [init.signal] : [])]) }),
      });
      context.signal?.throwIfAborted();
      return parse(parseJsonBytes(bytes, '4PX'), number);
    } catch (error) {
      if (error instanceof UpstreamHttpError && [404, 410].includes(error.status)) throw new TransportError('4PX', '4PX tracking endpoint is unavailable', { cause: error });
      throw error;
    }
  }
}

export const adapter: AdapterFactory = (environment) => {
  const tracker = new FourPxTracker({ fetcher: environment.fetcher });
  return { id: 'four-px', steps: ['direct'], track: (input, context = {}) => runSteps({ carrier: 'four-px', budgetMs: context.budgetMs ?? 15_000,
    signal: context.signal, recorder: environment.recorder }, [{ id: 'direct', run: ({ signal, remainingMs }) => tracker.fetch(input.number, { signal, budgetMs: remainingMs }) }]) };
};
