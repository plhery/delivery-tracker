import 'server-only';
import { normalizeCarrierInputs as normalizeScraperInputs } from 'universal-parcel-scraper';

export { AUTOMATIC_CARRIER_IDS, CARRIER_NAMES, activeRequirements, carrierAdapter, carrierDefinition, carrierTimezone, requiredRequirements, isValidS10TrackingNumber, supportsSwissPostHandoff } from 'universal-parcel-scraper';

/** The scraper's checked inputs, under the names the app stores them by. */
export function normalizeCarrierInputs(
  carrierId: string,
  trackingNumber: string,
  trackingUrl: string,
  dpdPostcode: string,
): { trackingUrl: string | null; dpdPostcode: string | null } {
  const inputs = normalizeScraperInputs(carrierId, trackingNumber, trackingUrl, dpdPostcode);
  return { trackingUrl: inputs.trackingUrl, dpdPostcode: inputs.postcode };
}
