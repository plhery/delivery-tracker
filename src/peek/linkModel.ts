import type {
  ApiCarrierDetectionResponse,
  ApiClaimParcelResult,
  ApiParcelAlertPreset,
  ApiParcelAlerts,
  ApiParcelLink,
  ApiParcelNumberHint,
  ApiParcelShare,
  ApiPublicParcelResponse,
} from '../generated/apiContract';
import type { Locale, MessageKey } from '../i18n';
import { currentEvent } from '../lib/stages';
import { userErrorKey } from '../lib/userMessages';
import { toParcel } from '../store/apiRepo';
import type { CarrierId, ParcelWithEvents, TrackingEvent } from '../types';

/** A parcel link as the server describes it for this device: its role, and what it may do. */
export type ParcelLink = ApiParcelLink;
/** The two ends of a masked tracking number. */
export type ParcelNumberHint = ApiParcelNumberHint;
export type CarrierAnswer = ApiCarrierDetectionResponse;
export type ParcelClaimResult = ApiClaimParcelResult;
/** Whether the server sends browser notifications, and the key a browser subscribes with. */
export type ParcelAlerts = ApiParcelAlerts;
/** What an alert announces: every scan, the important steps, or the delivery only. */
export type ParcelAlertPreset = ApiParcelAlertPreset;
export const PARCEL_ALERT_PRESETS: readonly ParcelAlertPreset[] = ['all', 'important', 'delivery'];
/** The link a signed-in person shares one of their parcels through. */
export type ParcelShare = ApiParcelShare;

/** What a link's owner can change: whether viewers read the whole number, whether it is a gift, whether it is shared at all. */
export interface ParcelLinkChanges {
  showNumber?: boolean;
  gift?: boolean;
  shared?: boolean;
}

/** A browser's push subscription with what it wants to hear about, and in which language. */
export interface ParcelAlertInput {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  preset: ParcelAlertPreset;
  locale: Locale;
}

/** Sharing one of an account's parcels. The demo keeps its links in this browser. */
export interface ParcelShareClient {
  /** The parcel's live link, or null while it is not shared. */
  current(parcelId: string): Promise<ParcelShare | null>;
  /** Makes the link when there is none, else changes it. */
  share(parcel: ParcelWithEvents, changes?: Pick<ParcelLinkChanges, 'showNumber' | 'gift'>): Promise<ParcelShare>;
  /** The link goes blank for good; sharing again makes a new one. */
  stop(parcelId: string): Promise<void>;
}

/** A parcel as its link shows it to this device. */
export interface ParcelLinkView {
  link: ParcelLink;
  /** The parcel in the app's own model. `trackingNumber` is empty when the link masks it. */
  parcel: ParcelWithEvents;
  /** The ends of a masked number; null when the number is shown. */
  numberHint: ParcelNumberHint | null;
}

/** What a lookup sends. The parcel's name is not part of it: a name never leaves the device this way. */
export interface ParcelLookupInput {
  trackingNumber: string;
  carrier?: CarrierId;
  trackingUrl?: string;
  dpdPostcode?: string;
}

/** A lookup's answer: the new link, its owner key (given once) and the parcel as the owner sees it. */
export interface ParcelLookup {
  id: string;
  key: string;
  view: ParcelLinkView;
}

/** A link that leads nowhere reads as `'unavailable'`: unknown, forgotten, expired or malformed alike. */
export type ParcelLinkRead = ParcelLinkView | 'unavailable';

/** A link to keep in the signed-in account. The name travels only here, as the parcel's label. */
export interface ParcelClaim {
  id: string;
  key?: string | null;
  label?: string | null;
}

export interface ParcelLinksClient {
  readonly mode: 'api' | 'demo';
  detectCarrierPublic(trackingNumber: string, signal?: AbortSignal): Promise<CarrierAnswer>;
  lookupParcel(input: ParcelLookupInput, signal?: AbortSignal): Promise<ParcelLookup>;
  /**
   * `advance` is a manual refresh: the device demo moves its story one step, the API reads as usual.
   * A link whose sharing was stopped reads as unavailable; with `tellStopped` it fails as `stopped` instead.
   */
  readParcelLink(id: string, options?: ParcelLinkReadOptions): Promise<ParcelLinkRead>;
  forgetParcelLink(id: string, key: string): Promise<void>;
  /** Changes what the link shows, with its owner key. Answers the parcel as the owner now sees it. */
  updateParcelLink(id: string, key: string, changes: ParcelLinkChanges, signal?: AbortSignal): Promise<ParcelLinkView>;
  /** Turns a browser's alerts on for this link, or changes what they announce. Anyone with the link can. */
  setParcelAlert(id: string, alert: ParcelAlertInput, key?: string | null): Promise<void>;
  /** Turns a browser's alerts off. Nothing is said about whether there were any. */
  removeParcelAlert(id: string, endpoint: string): Promise<void>;
}

export interface ParcelLinkReadOptions {
  key?: string | null;
  signal?: AbortSignal;
  advance?: boolean;
  tellStopped?: boolean;
}

/**
 * - `unavailable`: the link leads nowhere, or the key is not its owner's.
 * - `stopped`: the link's owner stopped sharing it.
 * - `full`: the link has all the alerts it can take.
 * - `unconfigured`: this server sends no browser notifications.
 * - `burst`: too many requests; `retryAfterSeconds` says when to try again.
 * - `daily`: no lookups are left today; signing in is the way on.
 * - `validation`: the server refused the input; `guidance` names the advice when the app has some.
 * - `offline`: the request never got an answer.
 * - `server`: the service is in trouble, or answered something unreadable.
 */
export type ParcelLinkErrorKind = 'unavailable' | 'stopped' | 'full' | 'unconfigured' | 'burst' | 'daily' | 'validation' | 'offline' | 'server';

export class ParcelLinkError extends Error {
  readonly retryAfterSeconds: number | null;
  readonly guidance: MessageKey | null;

  constructor(
    readonly kind: ParcelLinkErrorKind,
    details: { message?: string; retryAfterSeconds?: number | null; guidance?: MessageKey | null; cause?: unknown } = {},
  ) {
    super(details.message || `Parcel link: ${kind}`, { cause: details.cause });
    this.name = 'ParcelLinkError';
    this.retryAfterSeconds = details.retryAfterSeconds ?? null;
    this.guidance = details.guidance ?? null;
  }
}

const FALLBACK_MESSAGES: Record<ParcelLinkErrorKind, MessageKey> = {
  unavailable: 'link.gone.title',
  stopped: 'share.stopped.title',
  full: 'alerts.error.full',
  unconfigured: 'notifications.state.unavailable',
  burst: 'error.rateLimited',
  daily: 'peek.dailyLimit',
  validation: 'error.trackingNumber',
  offline: 'error.connection',
  server: 'error.generic',
};

/** The message to show for a failed link request: the server's guidance when it has one, else the kind's own. */
export function parcelLinkErrorKey(error: unknown): MessageKey {
  if (error instanceof ParcelLinkError) return error.guidance ?? FALLBACK_MESSAGES[error.kind];
  return userErrorKey(error) ?? 'error.generic';
}

/** 12 symbols without lookalikes, the format the server gives a link. */
export const PARCEL_LINK_ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const LINK_ID = /^[2-9A-HJ-NP-Za-km-z]{12}$/;

export function isParcelLinkId(value: unknown): value is string {
  return typeof value === 'string' && LINK_ID.test(value);
}

/**
 * The two ends a link shows of a number it masks, by the server's rule: up to
 * four leading and three trailing characters, fewer for a short number.
 */
export function numberEnds(trackingNumber: string): ParcelNumberHint {
  const head = Math.min(4, Math.floor(trackingNumber.length / 3));
  const tail = Math.min(3, Math.floor(trackingNumber.length / 4));
  return { head: trackingNumber.slice(0, head), tail: trackingNumber.slice(trackingNumber.length - tail) };
}

/** A masked number as the app writes it: "1234 ••• 899". */
export function maskedNumber(hint: ParcelNumberHint): string {
  return `${hint.head} ••• ${hint.tail}`;
}

/**
 * A public answer in the app's parcel model, so the page reuses everything
 * the deliveries app knows about a parcel. A malformed answer is refused.
 */
export function parcelLinkView(response: ApiPublicParcelResponse): ParcelLinkView {
  const { link, package: row } = response ?? {};
  if (!link || typeof link !== 'object' || !isParcelLinkId(link.id)
    || !row || typeof row !== 'object' || typeof row.id !== 'string' || typeof row.carrier !== 'string'
    || !Array.isArray(row.tracking_events)) {
    throw new ParcelLinkError('server', { message: 'Unreadable parcel link answer' });
  }
  const hint = row.number_hint;
  const vapidPublicKey = typeof link.alerts?.vapidPublicKey === 'string' && link.alerts.vapidPublicKey ? link.alerts.vapidPublicKey : null;
  return {
    link: {
      id: link.id,
      role: link.role === 'owner' ? 'owner' : 'viewer',
      kind: link.kind === 'shared' ? 'shared' : 'lookup',
      createdAt: String(link.createdAt ?? ''),
      forgetAt: typeof link.forgetAt === 'string' ? link.forgetAt : null,
      numberShown: link.numberShown === true,
      canKeep: link.canKeep === true,
      gift: link.gift === true,
      // Only a link that says it was stopped is: an answer from before sharing could be stopped is a shared one.
      shared: link.shared !== false,
      // A browser can only subscribe with the server's key.
      alerts: { available: link.alerts?.available === true && vapidPublicKey !== null, vapidPublicKey },
    },
    parcel: toParcel({ ...row, tracking_number: row.tracking_number ?? '' }),
    numberHint: hint && typeof hint.head === 'string' && typeof hint.tail === 'string'
      ? { head: hint.head, tail: hint.tail } : null,
  };
}

/** What the server writes in place of a scan's own words while a gift hides where it comes from. */
export const GIFT_ORIGIN_DESCRIPTION = 'Left the sender';

/**
 * Whether the link shows a gift still on its way to someone who is not its
 * owner: the sender, the contents and where it comes from are a surprise
 * until it is delivered.
 */
export function isWrappedGift(view: ParcelLinkView): boolean {
  return view.link.gift === true && view.link.role !== 'owner' && currentEvent(view.parcel.events)?.stage !== 'delivered';
}

/**
 * A gift's journey with its hidden beginning told once: the server blurs every
 * scan made where the parcel comes from, and scans that follow one another
 * then read the same. The newest of each run stays.
 */
export function collapseGiftRows(events: readonly TrackingEvent[]): TrackingEvent[] {
  const journey = events.map((event, index) => ({ event, index }))
    .sort((a, b) => (Date.parse(a.event.occurredAt) || 0) - (Date.parse(b.event.occurredAt) || 0) || a.index - b.index);
  const blurred = (event: TrackingEvent) => event.description === GIFT_ORIGIN_DESCRIPTION;
  const dropped = new Set<TrackingEvent>();
  journey.forEach(({ event }, position) => {
    const next = journey[position + 1]?.event;
    if (next && blurred(event) && blurred(next) && (event.location ?? '') === (next.location ?? '')) dropped.add(event);
  });
  return events.filter((event) => !dropped.has(event));
}

/** The longest gift note and signature a link carries. */
export const MAX_GIFT_NOTE_LENGTH = 280;
export const MAX_GIFT_FROM_LENGTH = 60;

/** Text as a link may carry it: one line, without control characters, at most `limit` characters. */
export function cleanLinkText(value: string | null | undefined, limit: number): string | null {
  const text = [...(value ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, limit).join('').trim();
  return text || null;
}
