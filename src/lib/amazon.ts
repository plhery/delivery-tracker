import { CARRIER_CAPABILITIES } from '../generated/apiContract';

export const AMAZON_HISTORY_EXPIRED = 'amazon_shipping_history_expired';

export const AMAZON_ACCOUNT_MESSAGE = 'Amazon Logistics deliveries usually need your Amazon account. Public Amazon Shipping tracking must be confirmed before adding this parcel.';
export const AMAZON_CHECK_UNAVAILABLE_MESSAGE = 'Amazon Shipping could not be checked right now. Please try again shortly or track this delivery in your Amazon account.';

export const AMAZON_NUMBER_PATTERN = CARRIER_CAPABILITIES['amazon-logistics'].detectionRules[0].pattern;

export function isAmazonTrackingNumber(raw: string): boolean {
  return new RegExp(AMAZON_NUMBER_PATTERN).test(raw.replace(/[\s.-]/g, '').toUpperCase());
}

export function requiresAmazonAccount(carrier: string, trackingNumber = ''): boolean {
  return carrier !== 'amazon-shipping' && (carrier === 'amazon-logistics' || isAmazonTrackingNumber(trackingNumber));
}

export function amazonMarketplace(raw: string): string {
  const prefix = raw.replace(/[\s.-]/g, '').toUpperCase().slice(0, 2);
  const marketplaces: Record<string, string> = {
    FR: 'fr', DE: 'de', AT: 'de', BE: 'com.be', UK: 'co.uk', GB: 'co.uk',
    IT: 'it', ES: 'es', PT: 'es', NL: 'nl', IE: 'ie', PL: 'pl', SE: 'se', TR: 'com.tr',
  };
  return marketplaces[prefix] ?? 'com';
}

export function amazonOrdersUrl(raw: string): string {
  return `https://www.amazon.${amazonMarketplace(raw)}/gp/your-account/order-history`;
}

// These public portals share Amazon's European tracker; DE/BE have no portal of their own.
export function amazonShippingOrigin(raw: string): string {
  const prefix = raw.replace(/[\s.-]/g, '').toUpperCase().slice(0, 2);
  const domains: Record<string, string> = { IT: 'it', ES: 'es', UK: 'co.uk', GB: 'co.uk', TB: 'com' };
  return `https://track.amazon.${domains[prefix] ?? 'fr'}`;
}

export function amazonShippingUrl(raw: string): string {
  return `${amazonShippingOrigin(raw)}/tracking/${encodeURIComponent(raw.replace(/[\s.-]/g, '').toUpperCase())}`;
}
