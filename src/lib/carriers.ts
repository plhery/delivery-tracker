/** Browser-safe carrier data and detection come from the scraper's public API. */
import {
  carrierInfo,
  carrierRequirements as scraperRequirements,
  type CarrierId,
  type CarrierInputField as ScraperInputField,
  type CarrierInputRequirement as ScraperInputRequirement,
  recognitionCandidates,
} from 'universal-parcel-scraper';
import {
  activeTrackingCarrierId,
  displayedCarrierId,
  parcelTrackingLinks as scraperTrackingLinks,
  parcelTrackingNumbers as scraperTrackingNumbers,
  type ParcelTrackingLink,
} from 'universal-parcel-scraper/app';

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
  localizedCarrierUrl,
  requirementSatisfied,
  tracksAutomatically,
} from 'universal-parcel-scraper';
export {
  activeTrackingCarrierId,
  carrierTrackingHintKey,
  displayedCarrierId,
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
 * Each carrier's page under its own number: the followed page under the first number, and an earlier or a named
 * delivering carrier's under the number it gave the parcel. A page with no number of its own is `loose`, and follows them.
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

/** What the followed carrier says about who delivers: a catalog carrier, and the number it gave the parcel. */
interface NamedDelivery {
  deliveryCarrier?: CarrierId;
  deliveryTrackingNumber?: string;
}

/**
 * The carrier the followed one names as delivering, while the parcel is not followed there yet. Once it is, the parcel
 * has been handed over and the scraper's helpers describe both carriers.
 */
function namedDelivery(parcel: Parameters<typeof displayedCarrierId>[0] & NamedDelivery) {
  const carrier = parcel.deliveryCarrier;
  if (!carrier || parcel.originalCarrier || carrier === displayedCarrierId(parcel) || carrierInfo(carrier).id !== carrier) return null;
  const number = parcel.deliveryTrackingNumber;
  return { carrier, number: number && number !== parcel.trackingNumber ? number : undefined };
}

/** Who delivers when it isn't the carrier shown: the one the parcel was handed to, else the one its carrier names. */
export function deliveringCarrierId(parcel: Parameters<typeof namedDelivery>[0]): CarrierId | null {
  const active = activeTrackingCarrierId(parcel);
  return active !== displayedCarrierId(parcel) ? active : namedDelivery(parcel)?.carrier ?? null;
}

/** Distinct numbers, the followed one first, and then the named delivering carrier's own. */
export function parcelTrackingNumbers(parcel: Parameters<typeof scraperTrackingNumbers>[0] & NamedDelivery) {
  const numbers = scraperTrackingNumbers(parcel);
  const named = namedDelivery(parcel);
  return named?.number ? [...numbers, { carrier: named.carrier, number: named.number }] : numbers;
}

/** The followed carrier's page first, and then the named delivering carrier's, for its own number. */
export function parcelTrackingLinks(parcel: Parameters<typeof scraperTrackingLinks>[0] & NamedDelivery, locale?: string): ParcelTrackingLink[] {
  const links = scraperTrackingLinks(parcel, locale);
  const named = namedDelivery(parcel);
  if (!named?.number) return links;
  // The parcel is not followed there yet.
  return [...links, ...scraperTrackingLinks({ carrier: named.carrier, trackingNumber: named.number }, locale)
    .filter((link) => link.carrier.id === named.carrier)
    .map((link) => ({ ...link, active: false, ready: false, role: 'waiting' as const }))];
}
