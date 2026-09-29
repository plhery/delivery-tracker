import type { AdapterRegistry } from '@carriers/core/adapter';
import { isAmazonTrackingNumber } from '../../../../src/lib/amazon';
import { checkAmazonShipping } from '../../../../src/server/amazonShippingEligibility';
import { createAdapterRegistry } from '../../../../src/server/adapterRegistry';
import { apiRoute, HttpError, json, readJsonObject } from '../../../../src/server/api';
import { MAX_RECOGNITIONS, recognitionCandidates, recognizeAll, settleRecognition } from '../../../../src/server/carrierRecognition';
import { recordDetection } from '../../../../src/server/metrics';
import { logOperationalEvent } from '../../../../src/server/observability';
import { detectCarrierMatch, normalizeTrackingNumber } from '../../../../src/lib/carriers';
import type { ApiCarrierDetectionResponse, ApiCarrierId } from '../../../../src/generated/apiContract';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The Add sheet waits this long for the carriers it asks; the first sync asks again after saving. */
const RECOGNITION_BUDGET_MS = 3_000;
/** A focus-out repeated on the same number reuses the answer instead of asking the carriers again. */
const ANSWER_TTL_MS = 10 * 60_000;
const MAX_ANSWERS = 500;

// One registry per server process keeps carrier sessions (DPD's guest token) warm.
let registry: AdapterRegistry | undefined;
const answers = new Map<string, { at: number; answer: ApiCarrierDetectionResponse }>();

async function recognize(trackingNumber: string): Promise<ApiCarrierDetectionResponse> {
  const cached = answers.get(trackingNumber);
  if (cached && Date.now() - cached.at < ANSWER_TTL_MS) return cached.answer;
  const candidates = recognitionCandidates(trackingNumber).slice(0, MAX_RECOGNITIONS);
  const outcomes = await recognizeAll(candidates, async (carrier) => {
    const adapter = (registry ??= createAdapterRegistry()).for(carrier);
    if (!adapter?.recognize) throw new RangeError(`${carrier} cannot recognize a number`);
    return await adapter.recognize(trackingNumber);
  }, RECOGNITION_BUDGET_MS);
  const { carrier, choices } = settleRecognition(outcomes);
  // Who was asked, and who could not answer, tells "nobody knows it yet" from "could not check".
  const asked = candidates.map((candidate) => candidate.carrier as ApiCarrierId);
  const unanswered = outcomes.filter((outcome) => outcome.status === 'failed').map((outcome) => outcome.carrier as ApiCarrierId);
  const answer: ApiCarrierDetectionResponse = {
    trackingNumber,
    carrier: (carrier ?? 'unknown') as ApiCarrierId,
    ...(!carrier && choices.length > 1 ? { recognized: choices as ApiCarrierId[] } : {}),
    ...(asked.length ? { asked } : {}),
    ...(unanswered.length ? { unanswered } : {}),
  };
  if (candidates.length) {
    logOperationalEvent('carrier_recognition', {
      asked: candidates.length,
      known: outcomes.filter((outcome) => outcome.status === 'known').length,
      failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
      settled: carrier ?? (choices.length > 1 ? 'choice' : 'none'),
    });
  }
  // A carrier that could not answer may answer on the next focus-out.
  if (outcomes.every((outcome) => outcome.status !== 'failed')) {
    answers.delete(trackingNumber);
    answers.set(trackingNumber, { at: Date.now(), answer });
    if (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value!);
  }
  return answer;
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
  // A shape shared by several carriers: ask the ones that can answer cheaply.
  // Only a carrier that knows the number is returned; the rest stay suggestions.
  const answer = detected.confidence === 'low' ? await recognize(trackingNumber)
    : { trackingNumber, carrier: detected.carrier } satisfies ApiCarrierDetectionResponse;
  recordDetection(answer.carrier !== 'unknown' ? 'high' : detected.confidence);
  return json(answer);
}, { loadService: false });
