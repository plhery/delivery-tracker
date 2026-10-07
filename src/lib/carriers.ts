/** Browser-safe carrier data and detection come from the scraper's public API. */
import {
  carrierRequirements as scraperRequirements,
  type CarrierId,
  type CarrierInputField as ScraperInputField,
  type CarrierInputRequirement as ScraperInputRequirement,
  recognitionCandidates,
} from 'universal-parcel-scraper';
import type { ParcelTrackingLink, parcelTrackingNumbers } from 'universal-parcel-scraper/app';

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

/** The HTTP candidates followed by the bounded, optional browser candidates. */
export function discoveryAskedCarriers(number: string): string[] {
  return [...new Set([
    ...recognitionCandidates(number).slice(0, 5),
    ...recognitionCandidates(number, { phase: 'browser' }).slice(0, 2),
  ].map(({ carrier }) => carrier))];
}

/**
 * Each carrier's page under its own number: the delivery page under the first number, and an earlier carrier's under
 * the number it gave the parcel. A page with no number of its own is `loose`, and follows them.
 */
export function trackingLinksByNumber(numbers: ReturnType<typeof parcelTrackingNumbers>, links: readonly ParcelTrackingLink[]) {
  const rows = numbers.map((entry) => ({ ...entry, links: [] as ParcelTrackingLink[] }));
  const loose: ParcelTrackingLink[] = [];
  for (const link of links) {
    const row = link.role === 'active' ? rows[0] : rows.slice(1).find((entry) => entry.carrier === link.carrier.id);
    (row?.links ?? loose).push(link);
  }
  return { numbers: rows, loose };
}

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

/**
 * What a form keeps of a typed value: the digits of a numeric field, single
 * spaces in a postcode. Letters keep their case, so the caret stays in place.
 */
export function typedRequirementValue(
  requirement: Pick<CarrierInputRequirement, 'field' | 'inputMode' | 'maxLength'>,
  raw: string,
): string {
  if (requirement.inputMode === 'numeric') return raw.replace(/\D/g, '').slice(0, requirement.maxLength);
  return requirement.field === 'dpdPostcode' ? raw.replace(/\s+/g, ' ').trimStart() : raw;
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
  validTrackingNumber,
} from 'universal-parcel-scraper';
