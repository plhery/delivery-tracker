/** Browser-safe carrier data and detection come from the scraper's public API. */
import {
  carrierRequirements as scraperRequirements,
  type CarrierId,
  type CarrierInputField as ScraperInputField,
  type CarrierInputRequirement as ScraperInputRequirement,
} from 'universal-parcel-scraper';

export type {
  CarrierCapabilities,
  CarrierInfo,
  CarrierTrackingMode,
} from 'universal-parcel-scraper';
export type { ParcelTrackingLink } from 'universal-parcel-scraper/app';
export {
  CARRIERS,
  SELECTABLE_CARRIERS,
  carrierInfo,
  requirementSatisfied,
  tracksAutomatically,
} from 'universal-parcel-scraper';
export {
  activeTrackingCarrierId,
  carrierTrackingHintKey,
  displayedCarrierId,
  parcelTrackingLinks,
  parcelTrackingNumbers,
  recognitionAskedCarriers,
} from 'universal-parcel-scraper/app';
export { MAX_RECOGNITIONS } from 'universal-parcel-scraper';

/**
 * The app's API, database and clients call a carrier's postcode input `dpdPostcode`:
 * DPD was the first carrier to ask for one. The scraper calls it `postcode`.
 */
export type CarrierInputField = Exclude<ScraperInputField, 'postcode'> | 'dpdPostcode';
export type CarrierInputRequirement = Omit<ScraperInputRequirement, 'field'> & { field: CarrierInputField };

export function appInputField(field: ScraperInputField): CarrierInputField {
  return field === 'postcode' ? 'dpdPostcode' : field;
}

// One object per catalog requirement, as the scraper returns: callers may compare them.
const appRequirements = new WeakMap<ScraperInputRequirement, CarrierInputRequirement>();

/** What the forms ask for with this carrier and number, under the app's field names. */
export function carrierRequirements(carrierId: CarrierId, trackingNumber: string): CarrierInputRequirement[] {
  return scraperRequirements(carrierId, trackingNumber).map((requirement) => {
    let named = appRequirements.get(requirement);
    if (!named) {
      named = { ...requirement, field: appInputField(requirement.field) };
      appRequirements.set(requirement, named);
    }
    return named;
  });
}
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
