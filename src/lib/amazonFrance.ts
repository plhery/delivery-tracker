// Keep the legacy carrier ID so existing parcels and older clients remain compatible.
export const AMAZON_FRANCE_CARRIER = 'amazon-logistics';
export const AMAZON_ORDERS_URL = 'https://www.amazon.fr/gp/your-account/order-history';
export const AMAZON_ACCOUNT_MESSAGE = 'Amazon France delivery updates are available in your Amazon account. Open Your Orders, then select Track package. These deliveries cannot be added here.';

export function requiresAmazonAccount(carrier: string, trackingNumber = ''): boolean {
  return carrier === AMAZON_FRANCE_CARRIER
    || /^FR\d{10}$/.test(trackingNumber.replace(/[\s.-]/g, '').toUpperCase());
}
