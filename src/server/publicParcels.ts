import 'server-only';

import { createHash, createHmac, randomBytes } from 'node:crypto';
import type {
  ApiCarrierId,
  ApiParcelLink,
  ApiParcelNumberHint,
  ApiPublicPackage,
  ApiPublicParcelResponse,
  ApiSyncStatus,
  ApiTrackingEventRow,
} from '../generated/apiContract';
import { clientNetwork } from './api';
import { withEventPlaces } from './eventPlaces';
import { isRecord, type JsonObject } from './types';

/**
 * One parcel without an account: what a parcel link's caller may see, the
 * owner key behind the owner role, and the daily lookup allowances.
 */

/** The one answer for an unknown, forgotten, expired or malformed link, and for a wrong key. */
export const PARCEL_UNAVAILABLE = 'Parcel unavailable';

const LINK_ID = /^[2-9A-HJ-NP-Za-km-z]{12}$/;
const OWNER_KEY = /^[A-Za-z0-9_-]{43}$/;
/** A failure code clients translate (`carrier:not_found`); anything else is diagnostic text. */
const SYNC_ERROR_CODE = /^[a-z][a-z_]*(?::[a-z_]+)?$/;
const DEFAULT_LOOKUPS_PER_DAY = 15;
const DEFAULT_LOOKUPS_GLOBAL_PER_DAY = 3_000;

export function isParcelLinkId(value: unknown): value is string {
  return typeof value === 'string' && LINK_ID.test(value);
}

/** 256 random bits. The server returns the key once and keeps only its hash. */
export function newOwnerKey(): string {
  return randomBytes(32).toString('base64url');
}

/** The stored form of an owner key, or null when the value cannot be one. */
export function ownerKeyHash(key: unknown): string | null {
  return typeof key === 'string' && OWNER_KEY.test(key)
    ? createHash('sha256').update(key).digest('hex')
    : null;
}

/**
 * The daily lookup counter of a client: a keyed hash of its address and the
 * day, so the database never holds an address and a client's days cannot be
 * linked. The key comes from the service-role key, which only the server has.
 * Without trusted proxy headers every client is `untrusted` and shares one
 * counter, which fails closed.
 */
export function lookupBucket(ip: string, now: Date): string {
  const secret = createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '')
    .update('public-lookup-bucket').digest();
  return createHmac('sha256', secret)
    .update(`${now.toISOString().slice(0, 10)}:${clientNetwork(ip)}`).digest('hex');
}

function allowance(value: string | undefined, fallback: number): number {
  const text = value?.trim() ?? '';
  return /^\d{1,9}$/.test(text) ? Number(text) : fallback;
}

/** Lookups a client, and every client together, may make per UTC day; 0 turns lookups off. */
export function lookupLimits(env: Record<string, string | undefined> = process.env): { perClient: number; overall: number } {
  return {
    perClient: allowance(env.PUBLIC_LOOKUPS_PER_DAY, DEFAULT_LOOKUPS_PER_DAY),
    overall: allowance(env.PUBLIC_LOOKUPS_GLOBAL_PER_DAY, DEFAULT_LOOKUPS_GLOBAL_PER_DAY),
  };
}

export function secondsUntilUtcMidnight(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1_000));
}

/** Up to four leading and three trailing characters; a short number shows less, so most of it stays hidden. */
export function numberHint(trackingNumber: string): ApiParcelNumberHint {
  const head = Math.min(4, Math.floor(trackingNumber.length / 3));
  const tail = Math.min(3, Math.floor(trackingNumber.length / 4));
  return { head: trackingNumber.slice(0, head), tail: trackingNumber.slice(trackingNumber.length - tail) };
}

const text = (value: unknown): value is string => typeof value === 'string' && value !== '';
const flag = (value: unknown): value is boolean => typeof value === 'boolean';
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/**
 * The stored carrier details a link may show, each with the type it must
 * have. Everything else stays on the server: routing state and its saved
 * postcodes and private links, probes, the recipient's name, the original
 * leg's private link, internal ids and raw histories.
 */
const SHOWN_CARRIER_DATA: Record<string, (value: unknown) => boolean> = {
  active_tracking_carrier: text,
  original_carrier: text,
  tracking_provider: text,
  carrier_answered: flag,
  auto_changed_from: text,
  auto_changed_to: text,
  auto_changed_at: text,
  sender_name: text,
  swiss_post_ready: flag,
  expected_delivery_from: text,
  pickup_point: text,
  dimensions_text: text,
  weight_kg: amount,
  destination_country: text,
};
/** The other leg's number is a tracking number too: shown only where the parcel's own is. */
const SHOWN_WITH_NUMBER: Record<string, (value: unknown) => boolean> = {
  active_tracking_number: text,
  original_tracking_number: text,
};

function publicCarrierData(value: unknown, numberShown: boolean): ApiPublicPackage['carrier_data'] {
  const stored = isRecord(value) ? value : {};
  const shown = numberShown ? { ...SHOWN_CARRIER_DATA, ...SHOWN_WITH_NUMBER } : SHOWN_CARRIER_DATA;
  return Object.fromEntries(Object.entries(shown)
    .filter(([key, valid]) => valid(stored[key]))
    .map(([key]) => [key, stored[key]]));
}

const optionalText = (value: unknown): string | null => typeof value === 'string' ? value : null;

function later(first: unknown, second: unknown): string {
  const [a, b] = [String(first ?? ''), String(second ?? '')];
  return Date.parse(b) > Date.parse(a) || !Number.isFinite(Date.parse(a)) ? b : a;
}

function isoTime(value: unknown): string | null {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * Explicit projection of a link and its package row: a column or a stored key
 * added later is never published by accident. The owner key and its hash are
 * not part of the input.
 */
export function publicParcelResponse(found: { link: JsonObject; package: JsonObject }): ApiPublicParcelResponse {
  const { link, package: row } = found;
  const owner = link.owner === true;
  const numberShown = owner || link.show_number === true;
  const trackingNumber = String(row.tracking_number ?? '');
  const events = withEventPlaces(row).tracking_events;
  const shownLink: ApiParcelLink = {
    id: String(link.id),
    role: owner ? 'owner' : 'viewer',
    kind: link.shared === true ? 'shared' : 'lookup',
    createdAt: isoTime(link.created_at) ?? '',
    forgetAt: isoTime(link.forget_at),
    numberShown,
    canKeep: numberShown,
  };
  return {
    link: shownLink,
    package: {
      id: String(row.id),
      tracking_number: numberShown ? trackingNumber : null,
      number_hint: numberShown ? null : numberHint(trackingNumber),
      // A name stays on the device that chose it.
      label: '',
      carrier: String(row.carrier) as ApiCarrierId,
      // A parcel several lookups share does not say when the first one was made.
      created_at: later(row.created_at, link.created_at),
      expected_delivery: optionalText(row.expected_delivery),
      last_status_text: optionalText(row.last_status_text),
      last_synced_at: optionalText(row.last_synced_at),
      sync_status: String(row.sync_status) as ApiSyncStatus,
      sync_error: typeof row.sync_error === 'string' && SYNC_ERROR_CODE.test(row.sync_error) ? row.sync_error : null,
      // A stored link is always a private credential (Planzer, Dachser), and a postcode is the recipient's.
      tracking_url: null,
      dpd_postcode: null,
      carrier_data: publicCarrierData(row.carrier_data, numberShown),
      archived_at: null,
      notifications_muted: false,
      tracking_events: (Array.isArray(events) ? events.filter(isRecord) : []).map((event) => ({
        id: String(event.id),
        package_id: String(event.package_id),
        stage: event.stage as ApiTrackingEventRow['stage'],
        description: String(event.description ?? ''),
        location: optionalText(event.location),
        occurred_at: String(event.occurred_at),
        place: (isRecord(event.place) ? event.place : null) as ApiTrackingEventRow['place'],
      })),
    },
  };
}
