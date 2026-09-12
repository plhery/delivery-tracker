/**
 * The carrier catalog and tracking-number detection now live in the carrier
 * package (`@carriers/core/catalog` and `@carriers/core/detection`). This
 * module stays as the import path the application already uses.
 */
export type {
  CarrierCapabilities,
  CarrierInfo,
  CarrierInputField,
  CarrierInputRequirement,
  CarrierTrackingMode,
  ParcelTrackingLink,
} from '@carriers/core/catalog';
export {
  CARRIERS,
  SELECTABLE_CARRIERS,
  activeTrackingCarrierId,
  carrierInfo,
  carrierRequirements,
  carrierTrackingHintKey,
  displayedCarrierId,
  parcelTrackingLinks,
  parcelTrackingNumbers,
  tracksAutomatically,
} from '@carriers/core/catalog';
export type {
  CarrierDetection,
  DetectionConfidence,
  TrackingInputMatch,
} from '@carriers/core/detection';
export {
  detectCarrier,
  detectCarrierMatch,
  formatTrackingNumber,
  isPlanzerSharedTrackingNumber,
  isValidS10TrackingNumber,
  normalizeTrackingNumber,
  parseTrackingInput,
  supportsSwissPostHandoff,
} from '@carriers/core/detection';
