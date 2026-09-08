import { apiRoute, HttpError, json, readJsonObject } from '../../../../src/server/api';
import { GLSGermanyTracker } from '../../../../src/server/glsGermany';
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
  let carrier = detectCarrierMatch(trackingNumber).carrier;
  // Numeric shapes overlap between carriers. Only promote GLS after its own
  // service returns a matching shipment; do not guess from a numeric prefix.
  if (carrier === 'unknown' && /^\d{11,12}$/.test(trackingNumber)) {
    try {
      if (await new GLSGermanyTracker(5_000).recognizes(trackingNumber)) carrier = 'gls-de';
    } catch {
      throw new HttpError(502, 'Carrier lookup is temporarily unavailable');
    }
  }
  return json({ trackingNumber, carrier } satisfies ApiCarrierDetectionResponse);
}, { loadService: false });
