import { isAmazonTrackingNumber } from '../../../../src/lib/amazon';
import { checkAmazonShipping } from '../../../../src/server/amazonShippingEligibility';
import { apiRoute, HttpError, json, readJsonObject } from '../../../../src/server/api';
import { DPDTracker } from '@carriers/carriers/dpd/adapter';
import { GLSGermanyTracker } from '@carriers/carriers/gls-de/adapter';
import { recordDetection } from '../../../../src/server/metrics';
import { detectCarrierMatch, normalizeTrackingNumber } from '../../../../src/lib/carriers';
import type { ApiCarrierDetectionResponse } from '../../../../src/generated/apiContract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One instance per server process keeps DPD's guest token warm between lookups.
const dpd = new DPDTracker({ timeoutMs: 4_000, trawl: null });
const DPD_LOOKUP_BUDGET_MS = 6_000;

async function withinBudget<T>(task: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Carrier lookup timed out')), budgetMs);
    })]);
  } finally { clearTimeout(timer); }
}

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
  const detected = detectCarrierMatch(trackingNumber);
  let { carrier, confidence } = detected;
  // Numeric shapes overlap between carriers. Only promote GLS after its own
  // service returns a matching shipment; do not guess from a numeric prefix.
  if (carrier === 'unknown' && /^\d{11,12}$/.test(trackingNumber)) {
    try {
      if (await new GLSGermanyTracker(5_000).recognizes(trackingNumber)) { carrier = 'gls-de'; confidence = 'high'; }
    } catch {
      throw new HttpError(502, 'Carrier lookup is temporarily unavailable');
    }
  }
  // 14 digits are shared by several carriers. DPD's own guest API settles
  // whether DPD has the parcel, unless the number points to another carrier
  // first (a DPD France depot). Only a positive answer promotes it.
  if (carrier === 'unknown' && /^\d{14}$/.test(trackingNumber) && detected.candidates.includes('dpd')
    && (detected.preferred.length === 0 || detected.preferred.includes('dpd'))) {
    try {
      if (await withinBudget(dpd.recognizes(trackingNumber), DPD_LOOKUP_BUDGET_MS)) { carrier = 'dpd'; confidence = 'high'; }
    } catch {
      throw new HttpError(502, 'Carrier lookup is temporarily unavailable');
    }
  }
  recordDetection(confidence);
  return json({ trackingNumber, carrier } satisfies ApiCarrierDetectionResponse);
}, { loadService: false });
