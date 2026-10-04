import type { Locale } from './lib/locale';
import type {
  ApiCarrierId,
  ApiEventPlace,
  ApiStage,
  ApiSyncStatus,
} from './generated/apiContract';

export type CarrierId = ApiCarrierId;

export type SyncStatus = ApiSyncStatus;

/**
 * The lifecycle of a parcel. The first six are the "happy path" in order;
 * the rest are exceptions that can happen along the way.
 */
export type Stage = ApiStage;

export interface Parcel {
  id: string;
  trackingNumber: string;
  label: string;
  carrier: CarrierId;
  createdAt: string; // ISO timestamp
  expectedDelivery?: string;
  senderName?: string;
  expectedDeliveryFrom?: string;
  pickupPoint?: string;
  receiverName?: string;
  weightKg?: number;
  dimensionsText?: string;
  autoChangedFrom?: CarrierId;
  autoChangedTo?: CarrierId;
  autoChangedAt?: string;
  /** A carrier that knows the number but needs this input before it can track the parcel. */
  providerInputNeeded?: { provider: string; field: 'dpdPostcode' };
  nextCheckAt?: string;
  inputNeeded?: { carrier: CarrierId; field: 'dpdPostcode' | 'trackingUrl' };
  originalParcelId?: string;
  originalCarrier?: CarrierId;
  originalTrackingNumber?: string;
  originalTrackingUrl?: string;
  lastStatusText?: string;
  lastSyncedAt?: string;
  syncStatus: SyncStatus;
  syncError?: string;
  trackingUrl?: string;
  dpdPostcode?: string;
  /** False when DPD rejected the stored postcode and tracked without it. */
  dpdPostcodeVerified?: boolean;
  /** Carrier currently supplying automatic updates for a multi-carrier journey. */
  trackingSource?: CarrierId;
  trackingProvider?: string;
  /** The carrier answered the check the provider's result came from; links stay with the carrier. */
  carrierAnswered?: boolean;
  activeTrackingNumber?: string;
  /** Whether Swiss Post has announced a Swiss-issued inbound shipment. */
  swissPostReady?: boolean;
  archivedAt?: string;
  notificationsMuted?: boolean;
  /** The account's delivery email is off for this parcel. */
  emailMuted?: boolean;
  /** Where the carrier says the parcel is heading, when it says. */
  destinationCountry?: string;
}

/** Where a scan happened, located on the server from its free-text location. */
export type EventPlace = ApiEventPlace;

export interface TrackingEvent {
  id: string;
  parcelId: string;
  stage: Stage;
  description: string;
  location?: string;
  place?: EventPlace;
  occurredAt: string; // ISO timestamp
}

export interface ParcelWithEvents extends Parcel {
  events: TrackingEvent[];
}

export interface NewParcelInput {
  trackingNumber: string;
  label: string;
  carrier?: CarrierId;
  trackingUrl?: string;
  dpdPostcode?: string;
}

export interface ParcelCarrierInput {
  providerPostcode?: string;
  carrier: CarrierId;
  trackingUrl?: string;
  dpdPostcode?: string;
}

export class ParcelAlreadyExistsError extends Error {
  constructor(
    message: string,
    readonly parcelId: string,
  ) {
    super(message);
    this.name = 'ParcelAlreadyExistsError';
  }
}

/** The tracking checks outlived the wait; they keep running and their results arrive with the next poll. */
export class RefreshTimeoutError extends Error {
  constructor() {
    super('The tracking check is taking longer than expected. Updates will appear automatically.');
    this.name = 'RefreshTimeoutError';
  }
}

/** Storage backends: the shared server API in production, local demo in development. */
export interface ParcelRepo {
  readonly mode: 'api' | 'demo';
  list(): Promise<ParcelWithEvents[]>;
  /** The local demo writes its sample parcels in this language. */
  setLanguage?(locale: Locale): void;
  /** Restore the original sample parcels; available only in the local demo. */
  resetDemo?(): Promise<ParcelWithEvents[]>;
  add(input: NewParcelInput): Promise<ParcelWithEvents>;
  /** Take in a parcel followed through a parcel link, with its history; available only in the local demo. */
  adopt?(parcel: ParcelWithEvents, label: string): Promise<ParcelWithEvents>;
  rename(id: string, label: string): Promise<ParcelWithEvents>;
  changeCarrier?(id: string, input: ParcelCarrierInput): Promise<ParcelWithEvents>;
  setNotificationsMuted?(id: string, muted: boolean): Promise<ParcelWithEvents>;
  /** Turns the account's delivery email off or back on for one parcel; only an account has it. */
  setEmailMuted?(id: string, muted: boolean): Promise<ParcelWithEvents>;
  /** Soft-delete an active parcel so it can still be restored. */
  remove(id: string): Promise<void>;
  restore?(id: string): Promise<ParcelWithEvents>;
  /** Permanently delete an owned parcel and all of its tracking history. */
  deletePermanently?(id: string): Promise<void>;
  /** Re-sync tracking; in demo mode this advances the simulation. */
  refresh(): Promise<ParcelWithEvents[]>;
  /** Re-sync one parcel without waiting for every active carrier. */
  refreshParcel?(id: string): Promise<ParcelWithEvents>;
  /** Optional shared-data polling. Returns unsubscribe. */
  subscribe?(onChange: () => void | Promise<void>): () => void;
  /** Last successfully loaded API snapshot for read-only offline fallback. */
  cachedList?(): ParcelWithEvents[] | null;
}
