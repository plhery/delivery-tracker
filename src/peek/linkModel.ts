import type {
  ApiCarrierDetectionResponse,
  ApiClaimParcelResult,
  ApiParcelLink,
  ApiParcelNumberHint,
  ApiPublicParcelResponse,
} from '../generated/apiContract';
import type { MessageKey } from '../i18n';
import { userErrorKey } from '../lib/userMessages';
import { toParcel } from '../store/apiRepo';
import type { CarrierId, ParcelWithEvents } from '../types';

/** A parcel link as the server describes it for this device: its role, and what it may do. */
export type ParcelLink = ApiParcelLink;
/** The two ends of a masked tracking number. */
export type ParcelNumberHint = ApiParcelNumberHint;
export type CarrierAnswer = ApiCarrierDetectionResponse;
export type ParcelClaimResult = ApiClaimParcelResult;

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
  /** `advance` is a manual refresh: the device demo moves its story one step, the API reads as usual. */
  readParcelLink(id: string, options?: { key?: string | null; signal?: AbortSignal; advance?: boolean }): Promise<ParcelLinkRead>;
  forgetParcelLink(id: string, key: string): Promise<void>;
}

/**
 * - `unavailable`: the link leads nowhere, or the key is not its owner's.
 * - `burst`: too many requests; `retryAfterSeconds` says when to try again.
 * - `daily`: no lookups are left today; signing in is the way on.
 * - `validation`: the server refused the input; `guidance` names the advice when the app has some.
 * - `offline`: the request never got an answer.
 * - `server`: the service is in trouble, or answered something unreadable.
 */
export type ParcelLinkErrorKind = 'unavailable' | 'burst' | 'daily' | 'validation' | 'offline' | 'server';

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
  return {
    link: {
      id: link.id,
      role: link.role === 'owner' ? 'owner' : 'viewer',
      kind: link.kind === 'shared' ? 'shared' : 'lookup',
      createdAt: String(link.createdAt ?? ''),
      forgetAt: typeof link.forgetAt === 'string' ? link.forgetAt : null,
      numberShown: link.numberShown === true,
      canKeep: link.canKeep === true,
    },
    parcel: toParcel({ ...row, tracking_number: row.tracking_number ?? '' }),
    numberHint: hint && typeof hint.head === 'string' && typeof hint.tail === 'string'
      ? { head: hint.head, tail: hint.tail } : null,
  };
}
