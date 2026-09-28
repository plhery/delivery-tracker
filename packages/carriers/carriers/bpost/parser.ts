import { DateTime } from 'luxon';
import { isValidS10TrackingNumber } from '../../core/detection/s10';
import { IndeterminateError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { clean } from '../../core/transport';
import { isRecord } from '../../core/types';
import { classifyBpostStatus } from './status';

export function normalizeBpostNumber(raw: string): string {
  const number = raw.toUpperCase().replace(/[\s.-]/g, '');
  if (!/^(?:\d{18}|\d{24}|\d{30})$/.test(number) && !isValidS10TrackingNumber(number)) {
    throw new TypeError('bpost requires a parcel barcode or postal tracking number');
  }
  return number;
}

export function parseBpost(payload: unknown, number: string): CarrierResult {
  const requested = normalizeBpostNumber(number);
  if (!isRecord(payload)) throw new SchemaError('bpost');
  // This is the explicit negative from the same anonymous batch request that
  // returns positive histories. The postcode-gated GET has different behavior.
  if (payload.error === 'NO_DATA_FOUND' && !Object.hasOwn(payload, 'items')) throw new NotFoundError('bpost');
  if (payload.error) throw new IndeterminateError('bpost', 'bpost returned an unrecognized lookup error');
  if (!Array.isArray(payload.items) || payload.items.length > 100 || !payload.items.every(isRecord)) throw new SchemaError('bpost');
  const matches = payload.items.filter((item) => item.itemCode === requested && item.searchCode === requested);
  if (matches.length !== 1) throw new SchemaError('bpost', 'bpost did not return one matching parcel barcode');
  const item = matches[0]!;
  if (!Array.isArray(item.events) || item.events.length > 500) throw new SchemaError('bpost');
  const returnDelivery = item.retourOrBackToSender === true && isRecord(item.activeStep)
    && item.activeStep.knownProcessStep === 'DELIVERED_TO_SENDER';
  const events: CarrierEvent[] = [];
  const seen = new Set<string>();
  for (const raw of item.events) {
    if (!isRecord(raw)) throw new SchemaError('bpost', 'bpost returned an incomplete scan');
    const key = isRecord(raw.key) && isRecord(raw.key.EN) ? raw.key.EN : null;
    const description = clean(key?.description, 500);
    const date = clean(raw.date, 32);
    const clock = clean(raw.time, 16);
    const text = [date, clock].filter(Boolean).join(' ');
    if (!description || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(clock)) {
      throw new SchemaError('bpost', 'bpost returned a scan without valid wording or clock');
    }
    // UTC validates calendar digits only; the public feed supplies no offset.
    // Preserve provider order across locations instead of comparing wall clocks.
    const parsed = DateTime.fromFormat(text, clock.length === 5 ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd HH:mm:ss', { zone: 'UTC' });
    const local = parsed.isValid ? parsed.toISO({ includeOffset: false, suppressMilliseconds: true }) : null;
    if (!local) throw new SchemaError('bpost', 'bpost returned an invalid scan date');
    const location = isRecord(raw.location) ? [clean(raw.location.locationName, 160), clean(raw.location.countryCode, 2)]
      .filter(Boolean).join(', ') : '';
    const dedup = `${local}\u0000${description}\u0000${location}`;
    if (seen.has(dedup)) continue;
    seen.add(dedup);
    const mapped = classifyBpostStatus(description);
    // The official widget distinguishes delivery to the sender from recipient
    // delivery. Do not let the host's wording fallback reinterpret a return.
    if (item.retourOrBackToSender === true && mapped?.stage === 'delivered' && !returnDelivery) {
      throw new IndeterminateError('bpost', 'bpost returned an ambiguous return-delivery milestone');
    }
    const stage = returnDelivery && mapped?.stage === 'delivered' ? 'returned' : mapped?.stage;
    events.push({ local_time: local, description, ...(location ? { location } : {}),
      ...(stage ? { stage } : {}), ...(item.retourOrBackToSender === true ? { provider_leg: 'return' } : {}) });
  }
  if (!events.length) throw new IndeterminateError('bpost', 'bpost returned no parcel history');
  const latest = events[0]!;
  const mapped = classifyBpostStatus(latest.description!);
  const current = returnDelivery && mapped?.stage === 'delivered' ? { status: 'exception' as const, stage: 'returned' as const } : mapped;
  const grams = item.weightInGrams;
  const dimensions = clean(item.dimensionsInCm, 100);
  const dimensionMatch = dimensions.match(/^(\d+(?:\.\d+)?)cm x (\d+(?:\.\d+)?)cm x (\d+(?:\.\d+)?)cm$/);
  return { status: current?.status ?? 'unknown', ...(current ? { current_stage: current.stage } : {}),
    last_status_text: latest.description, last_update: null, last_update_local: latest.local_time,
    expected_delivery: null,
    ...(typeof grams === 'number' && Number.isFinite(grams) && grams > 0 ? { weight_kg: grams / 1000 } : {}),
    ...(dimensionMatch && dimensionMatch.slice(1).every((value) => Number(value) > 0)
      ? { dimensions_text: `${dimensionMatch.slice(1).join(' × ')} cm` } : {}),
    events: events.slice(0, 100) };
}
