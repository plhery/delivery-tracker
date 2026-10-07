import 'server-only';

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { locatePlace } from 'universal-parcel-scraper/places';
import type {
  ApiCarrierId,
  ApiParcelAlerts,
  ApiParcelLink,
  ApiParcelNumberHint,
  ApiPublicPackage,
  ApiPublicParcelResponse,
  ApiSyncStatus,
  ApiTrackingEventRow,
} from '../generated/apiContract';
import { EVENT_STAGE_ORDER } from '../lib/stages';
import { clientNetwork, clientSite } from './api';
import { emailConfigured } from './email/config';
import { withEventPlaces } from './eventPlaces';
import { capturePublicAllowance, logOperationalEvent } from './observability';
import { pushServices } from './push';
import type { PublicAllowance, StoredParcelLink, SupabaseServiceClient } from './supabase';
import { isRecord } from './types';

/**
 * One parcel through a link: what the link's caller may see, a gift's viewer
 * included, the owner key behind the owner role, and the daily lookup
 * allowances.
 */

/** The one answer for an unknown, forgotten, expired or malformed link, and for a wrong key. */
export const PARCEL_UNAVAILABLE = 'Parcel unavailable';
/** The answer for a link whose sharing was stopped, to anyone but its owner. */
export const PARCEL_NOT_SHARED = 'Parcel not shared';
/**
 * What every scan of a gift's origin reads until the gift is delivered. The
 * clients translate it (shared/tracking-messages.json).
 */
export const GIFT_ORIGIN_DESCRIPTION = 'Left the sender';

const LINK_ID = /^[2-9A-HJ-NP-Za-km-z]{12}$/;
const OWNER_KEY = /^[A-Za-z0-9_-]{43}$/;
/** A failure code clients translate (`carrier:not_found`); anything else is diagnostic text. */
const SYNC_ERROR_CODE = /^[a-z][a-z_]*(?::[a-z_]+)?$/;
const DEFAULT_LOOKUPS_PER_DAY = 15;
const DEFAULT_LOOKUPS_GLOBAL_PER_DAY = 3_000;
/** An IPv6 /48 may make this many clients' lookups: it can be one customer's, or a mobile network's phones. */
const CLIENTS_PER_NETWORK = 10;
const DEFAULT_DETECTIONS_PER_DAY = 60;
const DEFAULT_DETECTIONS_GLOBAL_PER_DAY = 10_000;
/** The share of an overall allowance past which the server says it is running out. */
const RUNNING_OUT = 0.8;

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
 * A day counter's name: a keyed hash of what is counted and the day, so the
 * database never holds an address and a client's days cannot be linked. The
 * key comes from the service-role key, which only the server has.
 */
function dayHash(counted: string, now: Date): string {
  const secret = createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '')
    .update('public-lookup-bucket').digest();
  return createHmac('sha256', secret).update(`${now.toISOString().slice(0, 10)}:${counted}`).digest('hex');
}

/**
 * The daily lookup counter of a client. Without trusted proxy headers every
 * client is `untrusted` and shares one counter, which fails closed.
 */
export function lookupBucket(ip: string, now: Date): string {
  return dayHash(clientNetwork(ip), now);
}

/** The daily lookup counter of an IPv6 client's /48, or null for any other address. */
export function lookupNetworkBucket(ip: string, now: Date): string | null {
  const site = clientSite(ip);
  return site === null ? null : `network:${dayHash(site, now)}`;
}

/** The daily counter of the numbers a client had carriers asked about. Its hash is not the lookup counter's. */
export function detectionBucket(ip: string, now: Date): string {
  return `detection:${dayHash(`detection:${clientNetwork(ip)}`, now)}`;
}

function allowance(value: string | undefined, fallback: number): number {
  const text = value?.trim() ?? '';
  return /^\d{1,9}$/.test(text) ? Number(text) : fallback;
}

type Environment = Record<string, string | undefined>;

/**
 * Lookups a client, an IPv6 /48 and every client together may make per UTC
 * day; 0 turns lookups off.
 */
export function lookupLimits(env: Environment = process.env): { perClient: number; perNetwork: number; overall: number } {
  const perClient = allowance(env.PUBLIC_LOOKUPS_PER_DAY, DEFAULT_LOOKUPS_PER_DAY);
  return {
    perClient,
    perNetwork: perClient * CLIENTS_PER_NETWORK,
    overall: allowance(env.PUBLIC_LOOKUPS_GLOBAL_PER_DAY, DEFAULT_LOOKUPS_GLOBAL_PER_DAY),
  };
}

/**
 * Numbers a client, and every client together, may have carriers asked about
 * per UTC day before a lookup; 0 leaves detection to a number's shape.
 */
export function detectionLimits(env: Environment = process.env): { perClient: number; overall: number } {
  return {
    perClient: allowance(env.PUBLIC_DETECTIONS_PER_DAY, DEFAULT_DETECTIONS_PER_DAY),
    overall: allowance(env.PUBLIC_DETECTIONS_GLOBAL_PER_DAY, DEFAULT_DETECTIONS_GLOBAL_PER_DAY),
  };
}

/** What was last reported about each overall allowance, and for which day: once per day and process. */
const reported = new Map<string, string>();

/**
 * Says when an overall allowance is running out or used up: used up, every
 * visitor without an account is refused until midnight UTC. An allowance of
 * 0 was turned off on purpose and reports nothing.
 */
function reportOverallAllowance(kind: 'lookup' | 'detection', claimed: PublicAllowance, limit: number, now: Date): void {
  const state = !claimed.allowed && claimed.scope === 'global' ? 'used_up'
    : claimed.overallUsed >= limit * RUNNING_OUT ? 'running_out' : null;
  if (state === null || limit === 0) return;
  const day = now.toISOString().slice(0, 10);
  if (reported.get(`${kind}:${state}`) === day) return;
  reported.set(`${kind}:${state}`, day);
  logOperationalEvent('public_allowance', { kind, state, used: claimed.overallUsed, limit }, state === 'used_up' ? 'error' : 'warning');
  capturePublicAllowance(kind, state, { used: claimed.overallUsed, limit });
}

/** Counts one lookup against today's allowances: the client's, its IPv6 /48's and everyone's. */
export async function claimLookup(service: SupabaseServiceClient, ip: string, now: Date): Promise<PublicAllowance> {
  const limits = lookupLimits();
  const network = lookupNetworkBucket(ip, now);
  const claimed = await service.claimPublicAllowance({
    bucket: lookupBucket(ip, now),
    limit: limits.perClient,
    overall: { bucket: 'global', limit: limits.overall },
    network: network === null ? null : { bucket: network, limit: limits.perNetwork },
  });
  reportOverallAllowance('lookup', claimed, limits.overall, now);
  return claimed;
}

/** Counts one number that carriers are about to be asked about, for its client and for everyone. */
export async function claimDetection(service: SupabaseServiceClient, ip: string, now: Date): Promise<PublicAllowance> {
  const limits = detectionLimits();
  const claimed = await service.claimPublicAllowance({
    bucket: detectionBucket(ip, now),
    limit: limits.perClient,
    overall: { bucket: 'detection', limit: limits.overall },
  });
  reportOverallAllowance('detection', claimed, limits.overall, now);
  return claimed;
}

export function secondsUntilUtcMidnight(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now.getTime()) / 1_000));
}

/**
 * The end of a masked number: its last quarter, four characters at most. The
 * start stays hidden: `head` is empty, and stays in the answer for the
 * clients that read it.
 */
export function numberHint(trackingNumber: string): ApiParcelNumberHint {
  const tail = Math.min(4, Math.floor(trackingNumber.length / 4));
  return { head: '', tail: trackingNumber.slice(trackingNumber.length - tail) };
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
  delivery_carrier: text,
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
  delivery_tracking_number: text,
};

/**
 * The carrier details a gift keeps until it is delivered: who carries it and
 * when it arrives. Not the sender, nor what would describe the contents or
 * where it waits. A detail a link starts to show later stays out of a gift
 * until it is listed here.
 */
const SHOWN_IN_GIFT = new Set([
  'active_tracking_carrier', 'original_carrier', 'delivery_carrier', 'tracking_provider', 'carrier_answered', 'auto_changed_from',
  'auto_changed_to', 'auto_changed_at', 'swiss_post_ready', 'expected_delivery_from', 'destination_country',
]);

function publicCarrierData(value: unknown, numberShown: boolean, wrapped: boolean): ApiPublicPackage['carrier_data'] {
  const stored = isRecord(value) ? value : {};
  const shown = numberShown ? { ...SHOWN_CARRIER_DATA, ...SHOWN_WITH_NUMBER } : SHOWN_CARRIER_DATA;
  return Object.fromEntries(Object.entries(shown)
    .filter(([key, valid]) => valid(stored[key]) && (!wrapped || SHOWN_IN_GIFT.has(key)))
    .map(([key]) => [key, stored[key]]));
}

function eventTime(event: ApiTrackingEventRow): number {
  const time = Date.parse(event.occurred_at);
  return Number.isFinite(time) ? time : 0;
}

/** A country as a scan's place: its label point, and nothing more precise. */
function countryPlace(country: string): ApiTrackingEventRow['place'] {
  try {
    const place = locatePlace(country);
    if (place?.precision !== 'country' || place.country !== country) return null;
    return { latitude: place.latitude, longitude: place.longitude, precision: 'country', country, name: place.name };
  } catch {
    return null;
  }
}

/**
 * The journey of a gift as its viewer sees it until it is delivered: where it
 * comes from stays a country.
 *
 * - Scans from before the carrier had the parcel (`pending`, `registered`) are
 *   left out.
 * - The origin country is the country of the earliest located scan.
 * - When the parcel leaves that country, or is bound for another one, every
 *   scan located in the origin country is blurred, and so is every scan
 *   without a place from before the parcel was first seen elsewhere.
 * - When the journey stays in one country, or no scan is located, only the
 *   `accepted` scans are blurred: the rest is the way to the recipient.
 *
 * A blurred scan keeps its time and stage. Its description becomes
 * GIFT_ORIGIN_DESCRIPTION, its location the origin country's code and its
 * place that country, without a town or the carrier's point.
 */
export function giftEvents(
  events: readonly ApiTrackingEventRow[],
  destinationCountry: string | null,
): ApiTrackingEventRow[] {
  const journey = [...events].sort((a, b) => eventTime(a) - eventTime(b)
    || EVENT_STAGE_ORDER.indexOf(a.stage) - EVENT_STAGE_ORDER.indexOf(b.stage)
    || a.id.localeCompare(b.id));
  const origin = journey.find((event) => event.place)?.place?.country ?? null;
  const abroad = origin === null ? -1 : journey.findIndex((event) => event.place && event.place.country !== origin);
  const leavesOrigin = origin !== null && (abroad !== -1 || (destinationCountry !== null && destinationCountry !== origin));
  const position = new Map(journey.map((event, index) => [event, index]));
  const blurred = (event: ApiTrackingEventRow): boolean => {
    if (!leavesOrigin) return event.stage === 'accepted';
    if (event.place) return event.place.country === origin;
    return abroad === -1 || position.get(event)! < abroad;
  };
  const place = origin === null ? null : countryPlace(origin);
  return events
    .filter((event) => event.stage !== 'pending' && event.stage !== 'registered')
    .map((event) => blurred(event)
      ? { ...event, description: GIFT_ORIGIN_DESCRIPTION, location: origin, place }
      : event);
}

/**
 * Whether this server sends browser notifications, and the key a browser
 * subscribes with. A push configuration that does not load reads as none: a
 * parcel is still shown. `email` says whether the server emails accounts when
 * a parcel is delivered, which a link's page offers with signing in.
 */
export function parcelAlerts(service: SupabaseServiceClient): ApiParcelAlerts {
  const email = emailConfigured();
  try {
    const web = pushServices(service).web;
    return { available: web !== null, vapidPublicKey: web?.publicKey ?? null, email };
  } catch {
    return { available: false, vapidPublicKey: null, email };
  }
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

/** Whether the link is a gift still on its way for this caller: everyone but the owner, until the parcel is delivered. */
export function isWrappedGift({ link, package: row }: StoredParcelLink): boolean {
  return link.gift === true && link.owner !== true && row.current_stage !== 'delivered';
}

/**
 * Explicit projection of a link and its package row: a column or a stored key
 * added later is never published by accident. The owner key and its hash are
 * not part of the input.
 *
 * A gift on its way shows its viewer less: no sender, weight, size or pickup
 * point, no carrier status line, a masked number whatever the link shows
 * otherwise, and the journey of giftEvents. Delivered, it is a link like any
 * other. Its owner always sees everything.
 */
export function publicParcelResponse(found: StoredParcelLink, alerts: ApiParcelAlerts): ApiPublicParcelResponse {
  const { link, package: row } = found;
  const owner = link.owner === true;
  const wrapped = isWrappedGift(found);
  const numberShown = owner || (link.show_number === true && !wrapped);
  const trackingNumber = String(row.tracking_number ?? '');
  const stored = withEventPlaces(row).tracking_events;
  const events = (Array.isArray(stored) ? stored.filter(isRecord) : []).map((event): ApiTrackingEventRow => ({
    id: String(event.id),
    package_id: String(event.package_id),
    stage: event.stage as ApiTrackingEventRow['stage'],
    description: String(event.description ?? ''),
    location: optionalText(event.location),
    occurred_at: String(event.occurred_at),
    place: (isRecord(event.place) ? event.place : null) as ApiTrackingEventRow['place'],
  }));
  const carrierData = isRecord(row.carrier_data) ? row.carrier_data : {};
  const destination = typeof carrierData.destination_country === 'string' && /^[A-Za-z]{2}$/.test(carrierData.destination_country)
    ? carrierData.destination_country.toUpperCase() : null;
  const shownLink: ApiParcelLink = {
    id: String(link.id),
    role: owner ? 'owner' : 'viewer',
    kind: link.shared === true ? 'shared' : 'lookup',
    createdAt: isoTime(link.created_at) ?? '',
    forgetAt: isoTime(link.forget_at),
    numberShown,
    // The owner always reads the number: this is what the link's viewers are shown.
    ...(owner ? { showNumber: link.show_number === true } : {}),
    // A gift cannot be kept by its recipient before it arrives: its number is not shown.
    canKeep: numberShown,
    gift: link.gift === true,
    ...((owner || (link.gift === true && !wrapped)) && isRecord(link.gift_words)
      ? { giftWords: {
        name: optionalText(link.gift_words.name), note: optionalText(link.gift_words.note), from: optionalText(link.gift_words.from),
      } } : {}),
    // The stored link's own `shared` says that it belongs to an account: the kind above.
    shared: link.stopped !== true,
    alerts,
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
      // The carrier's status line can name the place the newest scan was made.
      last_status_text: wrapped ? null : optionalText(row.last_status_text),
      last_synced_at: optionalText(row.last_synced_at),
      sync_status: String(row.sync_status) as ApiSyncStatus,
      sync_error: typeof row.sync_error === 'string' && SYNC_ERROR_CODE.test(row.sync_error) ? row.sync_error : null,
      // A stored link is always a private credential (Planzer, Dachser), and a postcode is the recipient's.
      tracking_url: null,
      dpd_postcode: null,
      carrier_data: publicCarrierData(carrierData, numberShown, wrapped),
      archived_at: null,
      notifications_muted: false,
      tracking_events: wrapped ? giftEvents(events, destination) : events,
    },
  };
}

/** What someone holding only the link gets: the parcel as a viewer sees it, or why not. */
export type ViewerParcel =
  | { status: 'shown'; parcel: ApiPublicParcelResponse; wrappedGift: boolean }
  | { status: 'stopped' }
  | { status: 'unavailable' };

/**
 * A link as a viewer sees it, for the page's metadata and preview image: they
 * are built from this answer, never from the stored row, so a gift on its way
 * says no more there than on the page. `wrappedGift` tells them to speak of a
 * gift. Reading it is not an opening of the link.
 */
export async function viewerParcel(service: SupabaseServiceClient, linkId: string): Promise<ViewerParcel> {
  const found = isParcelLinkId(linkId) ? await service.publicParcel(linkId, null, false) : null;
  if (found === null) return { status: 'unavailable' };
  if (found === 'stopped') return { status: 'stopped' };
  return { status: 'shown', parcel: publicParcelResponse(found, parcelAlerts(service)), wrappedGift: isWrappedGift(found) };
}
