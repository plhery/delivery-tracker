/**
 * Catalog vocabulary.
 *
 * What it is: the shape of a merged `carrier.json` entry and the typed views
 * the application consumes (carrier info, capabilities, input requirements,
 * tracking links).
 * What it is not: no data, no behaviour and no provider I/O; every declaration
 * here is erased at build time.
 */
import type { CarrierId } from '../../generated/catalog';
import type { DetectionConfidence } from '../detection/types';

export type CarrierTrackingMode = 'automatic' | 'link-only';
export type CarrierInputField = 'trackingUrl' | 'dpdPostcode';
export type CarrierInputValidator =
  | 'planzerSharedUrl'
  | 'dachserCapabilityUrl'
  | 'swissPostcode'
  | 'francePostcode'
  | 'swissOrFrancePostcode'
  | 'paackPostcode';

/** What the "add a parcel" forms render for a carrier that needs extra input. */
export interface CarrierInputRequirement {
  field: CarrierInputField;
  whenTrackingNumber?: string;
  label: string;
  type: 'text' | 'url';
  placeholder?: string;
  help?: string;
  pattern?: string;
  maxLength?: number;
  inputMode?: 'numeric' | 'text' | 'url';
  autoComplete?: string;
}

/** What the server checks that extra input against. */
export interface CarrierRequirementRule {
  field: CarrierInputField;
  validator: CarrierInputValidator;
  whenTrackingNumber?: string;
}

export interface CarrierCatalogRequirement
  extends CarrierInputRequirement, CarrierRequirementRule {}

export interface CarrierCapabilities {
  tracking: {
    mode: CarrierTrackingMode;
    adapter: string | null;
    requirements: CarrierInputRequirement[];
  };
  selectable: boolean;
  timezone: string;
}

export interface CarrierInfo {
  id: CarrierId;
  name: string;
  trackingSiteName?: string;
  /** Accent used for the carrier chip in the UI. */
  color: string;
  trackingUrl?: (trackingNumber: string) => string;
  capabilities: CarrierCapabilities;
}

export interface DetectionRule {
  pattern: string;
  confidence: Exclude<DetectionConfidence, 'none'>;
  checksum?: 's10' | 'mondial-relay';
}

/** A link rule as it is written in the catalog, before its regexes compile. */
export interface RawTrackingLinkRule {
  domains: readonly string[];
  params?: readonly string[];
  path?: string;
  pathPattern?: string;
  fragment?: string;
  detectFromNumber?: boolean;
  keepsCapabilityUrl?: boolean;
}

/** One merged catalog entry: everything the app knows about a carrier. */
export interface CarrierDefinition {
  displayName: string;
  displayNames?: Record<string, string>;
  trackingSiteName?: string;
  color: string;
  selectable: boolean;
  timezone: string;
  canaryUrl?: string;
  tracking: {
    mode: CarrierTrackingMode;
    adapter: string | null;
    upstreamName?: string;
    requirements?: readonly CarrierCatalogRequirement[];
  };
  trackingUrlTemplate?: string;
  linkRules: readonly RawTrackingLinkRule[];
  detectionRules: readonly DetectionRule[];
}

export interface ParcelTrackingLink {
  carrier: CarrierInfo;
  name: string;
  url: string;
  active: boolean;
  ready: boolean;
  role: 'active' | 'waiting' | 'history';
}

/**
 * The parcel fields the tracking-link helpers read. Structurally a subset of
 * the application's `Parcel`, restated here so the package stays independent.
 */
export interface TrackedParcel {
  carrier: CarrierId;
  trackingNumber: string;
  trackingUrl?: string;
  /** Carrier currently supplying automatic updates for a multi-carrier journey. */
  trackingSource?: CarrierId;
  trackingProvider?: string;
  activeTrackingNumber?: string;
  /** Whether Swiss Post has announced a Swiss-issued inbound shipment. */
  swissPostReady?: boolean;
  originalCarrier?: CarrierId;
  originalTrackingNumber?: string;
  originalTrackingUrl?: string;
}
