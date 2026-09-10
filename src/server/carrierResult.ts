import { isRecord, type JsonObject } from './types';
import { STAGES } from '../generated/apiContract';

export type CarrierStatus =
  | 'pending'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'exception'
  | 'unknown';

export interface CarrierEvent extends JsonObject {
  time?: string;
  location?: string;
  description?: string;
  stage?: string;
  provider_code?: string;
}

export interface CarrierResult extends JsonObject {
  status?: CarrierStatus;
  current_stage?: string;
  last_status_text?: string | null;
  last_update?: string | null;
  expected_delivery?: string | null;
  sender_name?: string | null;
  delivery_carrier?: 'swiss-post';
  canonical_tracking_number?: string;
  international_tracking_number?: string;
  timezone?: string;
  events?: CarrierEvent[];
}

const STATUSES = new Set<CarrierStatus>([
  'pending',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'exception',
  'unknown',
]);
const CURRENT_STAGES = new Set<string>(STAGES);
const OPTIONAL_TEXT_FIELDS = [
  'last_status_text',
  'last_update',
  'expected_delivery',
  'sender_name',
  'canonical_tracking_number',
  'international_tracking_number',
  'timezone',
] as const;
const EVENT_TEXT_FIELDS = ['time', 'location', 'description', 'stage'] as const;

export function normalizeCarrierResult(value: unknown): CarrierResult {
  if (!isRecord(value)) throw new TypeError('The carrier adapter returned an invalid response');
  const normalized: CarrierResult = { ...value };
  normalized.status = typeof value.status === 'string' && STATUSES.has(value.status as CarrierStatus)
    ? value.status as CarrierStatus
    : 'unknown';
  if (value.current_stage !== undefined) {
    if (typeof value.current_stage !== 'string' || !CURRENT_STAGES.has(value.current_stage)) {
      throw new TypeError('The carrier adapter returned an invalid current stage');
    }
    normalized.current_stage = value.current_stage;
  }

  for (const field of OPTIONAL_TEXT_FIELDS) {
    const fieldValue = normalized[field];
    if (fieldValue != null && typeof fieldValue !== 'string') {
      throw new TypeError(`The carrier adapter returned an invalid ${field.replaceAll('_', ' ')}`);
    }
  }

  if (normalized.delivery_carrier !== undefined && normalized.delivery_carrier !== 'swiss-post') {
    throw new TypeError('The carrier adapter returned an unsupported delivery carrier');
  }

  const rawEvents = normalized.events ?? [];
  if (!Array.isArray(rawEvents)) {
    throw new TypeError('The carrier adapter returned invalid tracking events');
  }
  normalized.events = rawEvents.map((rawEvent) => {
    if (!isRecord(rawEvent)) {
      throw new TypeError('The carrier adapter returned an invalid tracking event');
    }
    for (const field of EVENT_TEXT_FIELDS) {
      const fieldValue = rawEvent[field];
      if (fieldValue != null && typeof fieldValue !== 'string') {
        throw new TypeError('The carrier adapter returned an invalid tracking event');
      }
    }
    return { ...rawEvent } as CarrierEvent;
  });
  return normalized;
}
