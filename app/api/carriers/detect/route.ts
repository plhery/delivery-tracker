import { isAmazonTrackingNumber } from '../../../../src/lib/amazon';
import { checkAmazonShipping } from '../../../../src/server/amazonShippingEligibility';
import { apiRoute, HttpError, json, readJsonObject } from '../../../../src/server/api';
import { GLSGermanyTracker } from '@carriers/carriers/gls-de/adapter';
import { recordDetection } from '../../../../src/server/metrics';
import { detectCarrierMatch, normalizeTrackingNumber } from '../../../../src/lib/carriers';
import type { ApiCarrierDetectionResponse } from '../../../../src/generated/apiContract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = apiRoute(async ({ request }) => {
  const body = await readJsonObject(request);
  if (typeof body.trackingNumber !== 'string' || body.trackingNumber.length > 80) {
    throw new HttpError(400, 'Invalid tracking number');
  }
  const trackingNumber = normalizeTrackingNumber(body.trackingNumber);
  if (!/^(?=.*\d)[A-Z0-9]{4,40}$/.test(trackingNumber)) {
    throw new HttpError(400, 'Invalid tracking number');
  }
  if (isAmazonTrackingNumber(trackingNumber)) {
    const amazonShippingStatus = await checkAmazonShipping(trackingNumber);
    recordDetection('high');
    return json({ trackingNumber, carrier: ['available', 'expired'].includes(amazonShippingStatus) ? 'amazon-shipping' : 'amazon-logistics', amazonShippingStatus } satisfies ApiCarrierDetectionResponse);
  }
  let { carrier, confidence } = detectCarrierMatch(trackingNumber);
  // Numeric shapes overlap between carriers. Only promote GLS after its own
  // service returns a matching shipment; do not guess from a numeric prefix.
  if (carrier === 'unknown' && /^\d{11,12}$/.test(trackingNumber)) {
    try {
      if (await new GLSGermanyTracker(5_000).recognizes(trackingNumber)) { carrier = 'gls-de'; confidence = 'high'; }
    } catch {
      throw new HttpError(502, 'Carrier lookup is temporarily unavailable');
    }
  }
  recordDetection(confidence);
  return json({ trackingNumber, carrier } satisfies ApiCarrierDetectionResponse);
}, { loadService: false });
