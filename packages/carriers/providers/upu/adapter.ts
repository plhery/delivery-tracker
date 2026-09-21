import 'server-only';

import { DateTime } from 'luxon';
import type { AdapterFactory } from '../../core/adapter';
import { isValidS10TrackingNumber } from '../../core/detection/s10';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierEvent, CarrierResult } from '../../core/result';
import { runSteps } from '../../core/runner';
import { decodeText, fetchBounded, parseJsonBytes } from '../../core/transport';
import { isRecord } from '../../core/types';
import { eventStage, hasPrivateDeliveryDetails, isNotice, numberOf, result, text } from '../shared/result';

const SOURCE = 'UPU';
export const UPU_BUDGET_MS = 8_000;
const MAX_EVENTS = 1_000;
const STAGES: Record<string, string> = {
  EMA: 'accepted', EMB: 'in_transit', EMC: 'in_transit', EMD: 'in_transit',
  EDA: 'customs', EDB: 'customs', EDC: 'in_transit',
  EXA: 'customs', EXB: 'customs', EXC: 'in_transit', EMI: 'delivered',
};

/** The wire offset was contradicted by a destination operator; retain wall time only. */
function localTime(value: unknown): string {
  if (typeof value !== 'string') throw new SchemaError(SOURCE, 'UPU event has no date');
  const wcf = /^\/Date\((-?\d+)([+-])(\d{2})(\d{2})\)\/$/.exec(value);
  let date: DateTime;
  if (wcf) {
    const hours = Number(wcf[3]);
    const minutes = Number(wcf[4]);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
      throw new SchemaError(SOURCE, 'UPU event has an invalid offset');
    }
    const offset = (wcf[2] === '+' ? 1 : -1) * (hours * 60 + minutes);
    date = DateTime.fromMillis(Number(wcf[1]), { zone: 'UTC' }).plus({ minutes: offset });
  } else {
    // Documented ISO replies still do not establish the event's true zone.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) {
      throw new SchemaError(SOURCE, 'UPU event has an invalid date');
    }
    date = DateTime.fromISO(value, { setZone: true, zone: 'UTC' });
  }
  if (!date.isValid || date.year < 1900 || date.year > 2200) throw new SchemaError(SOURCE, 'UPU event has an invalid date');
  return date.toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

export function parseUpuResponse(payload: unknown, trackingNumber: string): CarrierResult {
  const number = numberOf(trackingNumber);
  if (Array.isArray(payload) && payload.length === 0) throw new NotFoundError(SOURCE, 'UPU has no available history');
  if (!Array.isArray(payload) || payload.length !== 1 || !isRecord(payload[0]) || payload[0].ID !== number
    || !Array.isArray(payload[0].Events) || payload[0].Events.length > MAX_EVENTS) {
    throw new SchemaError(SOURCE, 'UPU has no matching shipment history');
  }
  const events: CarrierEvent[] = [];
  for (const raw of payload[0].Events) {
    if (!isRecord(raw) || typeof raw.EventCd !== 'string' || !/^[A-Z0-9]{2,8}$/.test(raw.EventCd)) {
      throw new SchemaError(SOURCE, 'UPU returned an invalid event');
    }
    const description = text(raw.EventNm);
    // DLV means a forecast, not final delivery. Do not let it advance freshness.
    if (raw.EventCd === 'DLV' || /\b(?:estimated|expected|predicted) delivery\b/i.test(description)) continue;
    if (!description || isNotice(description)) throw new SchemaError(SOURCE, 'UPU returned no event label');
    const stage = STAGES[raw.EventCd] ?? eventStage(description) ?? 'pending';
    if (stage !== 'delivered' && hasPrivateDeliveryDetails(description)) continue;
    const location = text(raw.EventLocation);
    events.push({ local_time: localTime(raw.EventDT), provider_code: raw.EventCd,
      description: stage === 'delivered' ? 'Delivered' : description, stage,
      ...(location && !hasPrivateDeliveryDetails(location) ? { location } : {}),
    });
  }
  if (!events.length) throw new NotFoundError(SOURCE, 'UPU has no actual tracking scans');
  // The response is oldest first. Sort within this feed only; never compare its
  // wall times with another provider's instants. Numeric State is not a scan.
  const unique = [...new Map(events.map((event) => [JSON.stringify([
    event.local_time, event.provider_code, event.location, event.description,
  ]), event])).values()].sort((a, b) => String(b.local_time).localeCompare(String(a.local_time)));
  const projected = { ...result(unique, SOURCE, true), events: unique };
  return { ...projected, last_update_local: projected.events?.[0]?.local_time,
    tracking_source: 'structured-web-response' };
}

export const adapter: AdapterFactory = (environment) => ({
  id: SOURCE,
  steps: ['direct'],
  async track(input, context) {
    const number = numberOf(input.number);
    if (!isValidS10TrackingNumber(number)) throw new TypeError('UPU requires a checksum-valid postal S10 number');
    const budgetMs = Math.min(context?.budgetMs ?? UPU_BUDGET_MS, UPU_BUDGET_MS);
    if (!Number.isFinite(budgetMs) || budgetMs < 1) throw new TypeError('UPU timeout must be positive');
    context?.signal?.throwIfAborted();
    return runSteps({ carrier: SOURCE, budgetMs, signal: context?.signal, recorder: environment.recorder }, [{
      id: 'direct',
      run: async ({ remainingMs, signal }) => {
        const { bytes } = await fetchBounded(
          `https://globaltracktrace.ptc.post/gtt.api/service.svc/rest/ItemTTWithTrans/${number}/EN`, {},
          { provider: SOURCE, timeoutMs: Math.max(1, Math.floor(remainingMs)), maxBytes: 2_000_000,
            fetcher: (url, init) => (environment.fetcher ?? fetch)(url, {
              ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
            }),
          },
        );
        // The observed unknown/expired lookup is HTTP 200 with no body.
        if (!decodeText(bytes).trim()) throw new NotFoundError(SOURCE, 'UPU has no available history');
        return parseUpuResponse(parseJsonBytes(bytes, SOURCE), number);
      },
    }]);
  },
});
