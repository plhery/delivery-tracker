/**
 * Amazon portal links.
 *
 * What it is: the marketplace mapping behind Amazon's order-history and public
 * Amazon Shipping URLs, and the rule that decides when a parcel can only be
 * followed inside the customer's Amazon account.
 * What it is not: no account state, no eligibility probe, no provider I/O; the
 * server checks public availability separately.
 */
import { isAmazonTrackingNumber } from '../detection/amazon';

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
