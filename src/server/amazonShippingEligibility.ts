import 'server-only';

import { AMAZON_ACCOUNT_MESSAGE, AMAZON_CHECK_UNAVAILABLE_MESSAGE } from '../lib/amazon';
import { amazonShippingEligibility } from 'universal-parcel-scraper/node';
import { captureOperationalError } from './observability';
import { HttpError } from './api';

export async function checkAmazonShipping(trackingNumber: string): Promise<'available' | 'expired' | 'not-found' | 'unavailable'> {
  try {
    return await amazonShippingEligibility(trackingNumber);
  } catch (error) {
    captureOperationalError(error, {
      component: 'amazon-shipping', operation: 'eligibility', trackingNumber,
    });
    return 'unavailable';
  }
}

// Never trust a client-supplied carrier name as evidence of public tracking.
export async function verifyAmazonShippingAddition(carrier: string, trackingNumber: string): Promise<void> {
  if (carrier !== 'amazon-shipping') return;
  const status = await checkAmazonShipping(trackingNumber);
  if (status === 'not-found') throw new HttpError(400, AMAZON_ACCOUNT_MESSAGE);
  if (status === 'unavailable') throw new HttpError(503, AMAZON_CHECK_UNAVAILABLE_MESSAGE);
}
