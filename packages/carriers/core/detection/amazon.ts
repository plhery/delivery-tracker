/**
 * Amazon tracking-number recognition.
 *
 * What it is: the Amazon number shape, read from the catalog so the pattern has
 * exactly one source of truth, and the predicate built on it.
 * What it is not: no Amazon account state, no eligibility check, no provider
 * I/O; whether a parcel needs the customer's Amazon account is a catalog
 * concern and lives in `core/catalog/amazon`.
 */
import { CARRIER_CATALOG } from '../../generated/catalog';

export const AMAZON_NUMBER_PATTERN = CARRIER_CATALOG['amazon-logistics'].detectionRules[0].pattern;

export function isAmazonTrackingNumber(raw: string): boolean {
  return new RegExp(AMAZON_NUMBER_PATTERN).test(raw.replace(/[\s.-]/g, '').toUpperCase());
}
