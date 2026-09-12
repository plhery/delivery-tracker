/**
 * Amazon number recognition and portal links live in the carrier package; the
 * user-facing messages below belong to the application.
 */
export {
  AMAZON_NUMBER_PATTERN,
  isAmazonTrackingNumber,
} from '@carriers/core/detection';
export {
  amazonMarketplace,
  amazonOrdersUrl,
  amazonShippingOrigin,
  amazonShippingUrl,
  requiresAmazonAccount,
} from '@carriers/core/catalog';

export const AMAZON_HISTORY_EXPIRED = 'amazon_shipping_history_expired';

export const AMAZON_ACCOUNT_MESSAGE = 'Amazon Logistics deliveries usually need your Amazon account. Public Amazon Shipping tracking must be confirmed before adding this parcel.';
export const AMAZON_CHECK_UNAVAILABLE_MESSAGE = 'Amazon Shipping could not be checked right now. Please try again shortly or track this delivery in your Amazon account.';
