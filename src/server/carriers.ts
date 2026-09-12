/**
 * The catalog lookups and the S10 checksum now live in the carrier package.
 * Input validation stays here because it depends on the carrier-specific
 * validators in `./dachser` and `./planzerShared`.
 */
import { activeRequirements, carrierDefinition, type CarrierRequirementRule } from '@carriers/core/catalog';
import { isValidMondialRelayBarcode } from '@carriers/core/detection';
import { validateDachserTrackingUrl } from './dachser';
import { validatePlanzerSharedUrl } from './planzerShared';

export {
  AUTOMATIC_CARRIER_IDS,
  CARRIER_NAMES,
  activeRequirements,
  carrierAdapter,
  carrierDefinition,
  carrierTimezone,
} from '@carriers/core/catalog';
export {
  isValidS10TrackingNumber,
  supportsSwissPostHandoff,
} from '@carriers/core/detection';

export function normalizeCarrierInputs(
  carrierId: string,
  trackingNumber: string,
  trackingUrl: string,
  dpdPostcode: string,
): { trackingUrl: string | null; dpdPostcode: string | null } {
  const supplied: Record<'trackingUrl' | 'dpdPostcode', string | null> = {
    trackingUrl: trackingUrl.trim() || null,
    dpdPostcode: dpdPostcode.trim() || null,
  };
  const mondialBarcode = carrierId === 'mondial-relay' && /^\d{26}$/.test(trackingNumber);
  if (mondialBarcode && !isValidMondialRelayBarcode(trackingNumber)) {
    throw new TypeError('Invalid Mondial Relay barcode');
  }
  const requirements = new Map<'trackingUrl' | 'dpdPostcode', CarrierRequirementRule>(
    activeRequirements(carrierId, trackingNumber).map((item) => [item.field, item]),
  );
  // Older clients may still supply a postcode for label barcodes. Validate it
  // when present, while allowing the public alias to work without one.
  if (mondialBarcode && supplied.dpdPostcode) {
    requirements.set('dpdPostcode', { field: 'dpdPostcode', validator: 'francePostcode' });
  }
  for (const [field, value] of Object.entries(supplied) as Array<[
    'trackingUrl' | 'dpdPostcode',
    string | null,
  ]>) {
    if (value !== null && !requirements.has(field)) {
      if (field === 'trackingUrl') {
        throw new TypeError('A tracking URL is not used for this carrier or tracking number');
      }
      throw new TypeError('A delivery postcode is not used for this carrier');
    }
  }
  for (const [field, requirement] of requirements) {
    const value = supplied[field];
    if (!value) {
      if (field === 'trackingUrl') {
        throw new TypeError(`${carrierDefinition(carrierId).displayName} requires its complete tracking URL`);
      }
      if (requirement.validator === 'swissPostcode') {
        throw new TypeError(
          `${carrierDefinition(carrierId).displayName} requires the four-digit delivery postcode`,
        );
      }
      if (requirement.validator === 'francePostcode') {
        throw new TypeError(
          `${carrierDefinition(carrierId).displayName} requires the five-digit delivery postcode`,
        );
      }
      if (requirement.validator === 'swissOrFrancePostcode') {
        throw new TypeError(
          `${carrierDefinition(carrierId).displayName} requires a four- or five-digit delivery postcode`,
        );
      }
      if (requirement.validator === 'paackPostcode') {
        throw new TypeError('Paack requires the delivery postcode');
      }
      throw new TypeError(`${carrierDefinition(carrierId).displayName} requires the delivery postcode`);
    }
    switch (requirement.validator) {
      case 'planzerSharedUrl':
        supplied[field] = validatePlanzerSharedUrl(value, trackingNumber);
        break;
      case 'dachserCapabilityUrl':
        supplied[field] = validateDachserTrackingUrl(value, trackingNumber);
        break;
      case 'swissPostcode':
        if (!/^\d{4}$/.test(value)) {
          throw new TypeError(
            `${carrierDefinition(carrierId).displayName} requires the four-digit delivery postcode`,
          );
        }
        break;
      case 'francePostcode':
        if (!/^\d{5}$/.test(value)) {
          throw new TypeError(
            `${carrierDefinition(carrierId).displayName} requires the five-digit delivery postcode`,
          );
        }
        break;
      case 'swissOrFrancePostcode':
        if (!/^\d{4,5}$/.test(value)) {
          throw new TypeError(
            `${carrierDefinition(carrierId).displayName} requires a four- or five-digit delivery postcode`,
          );
        }
        break;
      case 'paackPostcode': {
        const rawPostcode = value.toLocaleUpperCase('en-US');
        if (!/^(?=.{3,10}$)(?=.*\d)[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/.test(rawPostcode)) {
          throw new TypeError('Paack requires a valid delivery postcode');
        }
        supplied[field] = rawPostcode.replace(/\s+/g, '');
        break;
      }
      default:
        requirement.validator satisfies never;
    }
  }
  return supplied;
}
