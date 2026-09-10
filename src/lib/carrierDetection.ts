import { authenticatedFetch, type ApiAuth } from './apiClient';
import type { ApiCarrierDetectionResponse } from '../generated/apiContract';
import { CARRIERS } from './carriers';

export async function lookupCarrier(trackingNumber: string, auth: ApiAuth, signal?: AbortSignal) {
  const response = await authenticatedFetch('/api/carriers/detect', auth, {
    method: 'POST', body: JSON.stringify({ trackingNumber }), signal,
  });
  if (!response.ok) throw new Error('Carrier lookup unavailable');
  const result = await response.json() as ApiCarrierDetectionResponse;
  if (result.trackingNumber !== trackingNumber || !Object.hasOwn(CARRIERS, result.carrier)) {
    throw new Error('Invalid carrier lookup response');
  }
  if (result.carrier === 'amazon-shipping' && !['available', 'expired'].includes(result.amazonShippingStatus ?? '')) throw new Error('Unverified Amazon Shipping response');
  return result;
}
