/** Browser-safe carrier data and detection come from the scraper's public API. */
export type {
  CarrierCapabilities,
  CarrierInfo,
  CarrierInputField,
  CarrierInputRequirement,
  CarrierTrackingMode,
  ParcelTrackingLink,
} from 'universal-parcel-scraper';
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
  requirementSatisfied,
  tracksAutomatically,
} from 'universal-parcel-scraper';
export {
  MAX_RECOGNITIONS,
  recognitionAskedCarriers,
} from 'universal-parcel-scraper';
export type {
  CarrierDetection,
  DetectionConfidence,
  TrackingInputMatch,
} from 'universal-parcel-scraper';
export {
  detectCarrier,
  detectCarrierMatch,
  formatTrackingNumber,
  isPlanzerSharedTrackingNumber,
  isValidS10TrackingNumber,
  normalizeTrackingNumber,
  parseTrackingInput,
  supportsSwissPostHandoff,
} from 'universal-parcel-scraper';
