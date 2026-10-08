import 'server-only';

import { recordParcelFeedback } from './metrics';
import { logOperationalEvent } from './observability';
import { deployedVersion } from './reviewQueues';
import type { SupabaseServiceClient } from './supabase';
import { isRecord, type JsonObject } from './types';
import type { ParcelFeedbackValues } from './validation';

/**
 * What a reader says of a parcel: that what is shown is right, what is off,
 * or who carries a parcel no carrier was found for. An answer is kept with
 * the parcel's number and what the service held about it, and with nothing
 * that says who gave it: no account, link, device or address.
 */

const SHOWN_EVENTS = 6;

function cut(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value ? [...value].slice(0, limit).join('') : null;
}

/**
 * What the service holds about a parcel when an answer arrives: its status,
 * its last check and its newest scans. A private tracking link, a postcode
 * and a name the reader gave the parcel are left out.
 */
export function shownParcel(row: JsonObject): JsonObject {
  const events = (Array.isArray(row.tracking_events) ? row.tracking_events.filter(isRecord) : [])
    .sort((a, b) => Date.parse(String(b.occurred_at)) - Date.parse(String(a.occurred_at)));
  const carrierData = isRecord(row.carrier_data) ? row.carrier_data : {};
  return {
    status: cut(row.last_status_text, 300),
    sync_status: cut(row.sync_status, 40),
    sync_error: cut(row.sync_error, 200),
    last_synced_at: cut(row.last_synced_at, 40),
    expected_delivery: cut(row.expected_delivery, 40),
    provider: cut(carrierData.tracking_provider, 60),
    active_carrier: cut(carrierData.active_tracking_carrier, 60),
    delivery_carrier: cut(carrierData.delivery_carrier, 60),
    event_count: events.length,
    events: events.slice(0, SHOWN_EVENTS).map((event) => ({
      stage: cut(event.stage, 40),
      description: cut(event.description, 200),
      location: cut(event.location, 100),
      occurred_at: cut(event.occurred_at, 40),
    })),
  };
}

/**
 * Keeps an answer about the parcel of `row`, reached through an account or a
 * link. An answer the table refuses (`full`, `closed`) is counted and logged;
 * its reader is thanked like any other.
 */
export async function keepParcelFeedback(
  service: SupabaseServiceClient,
  row: JsonObject,
  values: ParcelFeedbackValues,
  via: 'account' | 'link',
): Promise<'stored' | 'replaced' | 'full' | 'closed'> {
  const carrier = cut(row.carrier, 100) ?? 'unknown';
  const outcome = await service.recordParcelFeedback({
    id: values.id,
    tracking_number: String(row.tracking_number ?? ''),
    carrier,
    answer: values.answer,
    reasons: values.reasons,
    note: values.note,
    carrier_name: values.carrierName,
    tracking_page: values.trackingPage,
    asked: values.asked,
    via,
    app: values.app,
    locale: values.locale,
    server_version: deployedVersion(),
    shown: shownParcel(row),
  });
  recordParcelFeedback(values.answer, via, values.app, outcome);
  logOperationalEvent('parcel_feedback', {
    answer: values.answer,
    reasons: values.reasons.join(',') || null,
    carrier,
    asked: values.asked,
    via,
    app: values.app,
    outcome,
  });
  return outcome;
}
