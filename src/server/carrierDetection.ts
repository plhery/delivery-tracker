import 'server-only';

import type { AdapterRegistry } from 'universal-parcel-scraper/node';
import type { ApiCarrierDetectionResponse, ApiCarrierId } from '../generated/apiContract';
import { isAmazonTrackingNumber } from '../lib/amazon';
import { detectCarrierMatch, normalizeTrackingNumber, validTrackingNumber } from '../lib/carriers';
import { createAdapterRegistry } from './adapterRegistry';
import { BROWSER_RECOGNITION_BUDGET_MS, MAX_BROWSER_RECOGNITIONS, recognizeBrowser } from './browserRecognition';
import { checkAmazonShipping } from './amazonShippingEligibility';
import { HttpError } from './api';
import { MAX_RECOGNITIONS, recognitionCandidates, recognizeAll, settleRecognition } from 'universal-parcel-scraper';
import { preflightTracking } from './trackingPreflight';
import { recordDetection } from './metrics';
import { logOperationalEvent } from './observability';
import type { SupabaseServiceClient } from './supabase';
import { retainDetectionSupport } from './trackingSupport';
import type { JsonObject } from './types';
import { getRecognitionPriorities } from './recognitionRanking';

/** The Add sheet waits this long for the carriers it asks; the first sync asks again after saving. */
const RECOGNITION_BUDGET_MS = 3_000;
/** A focus-out repeated on the same number reuses the answer instead of asking the carriers again. */
const ANSWER_TTL_MS = 10 * 60_000;
const MAX_ANSWERS = 500;

// One registry per server process keeps carrier sessions (DPD's guest token) warm.
let registry: AdapterRegistry | undefined;
const answers = new Map<string, { at: number; answer: ApiCarrierDetectionResponse }>();

async function recognize(trackingNumber: string, beforeAsking?: () => Promise<void>, signal?: AbortSignal, health?: SupabaseServiceClient, countryHint?: string | null): Promise<ApiCarrierDetectionResponse> {
  const priorities = getRecognitionPriorities(trackingNumber);
  const ordering = { countryHint, priorities };
  const cacheKey = `${trackingNumber}:${countryHint ?? ''}:${JSON.stringify(priorities ?? {})}`;
  const cached = answers.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.answer.carrier === 'unknown' ? 30_000 : ANSWER_TTL_MS)) return cached.answer;
  const candidates = recognitionCandidates(trackingNumber, ordering).slice(0, MAX_RECOGNITIONS);
  const browserCandidates = recognitionCandidates(trackingNumber, { ...ordering, phase: 'browser' }).slice(0, MAX_BROWSER_RECOGNITIONS);
  const deadline = performance.now() + 25_000;
  await beforeAsking?.();
  const errors = new Map<string, unknown>();
  const outcomes = await recognizeAll(candidates, async (carrier, context) => {
    const adapter = (registry ??= createAdapterRegistry()).for(carrier);
    if (!adapter?.recognize) throw new RangeError(`${carrier} cannot recognize a number`);
    try { return await adapter.recognize(trackingNumber, context); }
    catch (error) { errors.set(carrier, error); throw error; }
  }, RECOGNITION_BUDGET_MS, signal);
  const cheap = settleRecognition(outcomes);
  const preflight = !cheap.carrier && !cheap.choices.length && health
    ? await preflightTracking(trackingNumber, health, signal, countryHint) : undefined;
  if (!cheap.carrier && !cheap.choices.length && !preflight?.trackingFound) {
    const due = browserCandidates.filter(({ carrier }) => !outcomes.some((outcome) => outcome.carrier === carrier && outcome.status !== 'failed'));
    outcomes.push(...await recognizeAll(due, (carrier, context) => recognizeBrowser(carrier, trackingNumber, context, errors.get(carrier)),
      Math.max(1, Math.min(BROWSER_RECOGNITION_BUDGET_MS, Math.floor(deadline - performance.now()))), signal));
  }
  const { carrier, choices } = settleRecognition(outcomes);
  // Who was asked, and who could not answer, tells "nobody knows it yet" from "could not check".
  const asked = [...new Set(outcomes.map((candidate) => candidate.carrier as ApiCarrierId))];
  const unanswered = asked.filter((carrier) => outcomes.filter((outcome) => outcome.carrier === carrier).every((outcome) => outcome.status === 'failed'));
  const answer: ApiCarrierDetectionResponse = {
    trackingNumber,
    ...preflight,
    carrier: (carrier ?? preflight?.carrier ?? 'unknown') as ApiCarrierId,
    ...(!carrier && choices.length > 1 ? { recognized: choices as ApiCarrierId[] } : {}),
    ...(asked.length ? { asked } : {}),
    ...(unanswered.length ? { unanswered } : {}),
  };
  if (outcomes.length) {
    logOperationalEvent('carrier_recognition', {
      asked: asked.length,
      known: outcomes.filter((outcome) => outcome.status === 'known').length,
      failed: unanswered.length,
      settled: carrier ?? preflight?.carrier ?? (choices.length > 1 ? 'choice' : 'none'),
    });
  }
  // A carrier that could not answer may answer on the next focus-out.
  if (unanswered.length === 0 && !preflight?.providers.some(({ outcome }) => outcome === 'unavailable' || outcome === 'deferred')) {
    answers.delete(cacheKey);
    answers.set(cacheKey, { at: Date.now(), answer });
    if (answers.size > MAX_ANSWERS) answers.delete(answers.keys().next().value!);
  }
  return answer;
}

/**
 * The carrier of a number, for the signed-in Add sheet and the front door
 * alike. `beforeAsking` runs before a carrier is asked about the number, and
 * may refuse by throwing. It does not run for an answer read from the number's
 * shape or kept from a moment ago.
 */
export async function detectCarrier(
  body: JsonObject,
  beforeAsking?: () => Promise<void>,
  signal?: AbortSignal,
  supportClient?: SupabaseServiceClient,
  countryHint?: string | null,
): Promise<ApiCarrierDetectionResponse> {
  if (signal?.aborted) throw new HttpError(499, 'Carrier check cancelled');
  if (typeof body.trackingNumber !== 'string' || body.trackingNumber.length > 80) {
    throw new HttpError(400, 'Invalid tracking number');
  }
  const trackingNumber = normalizeTrackingNumber(body.trackingNumber);
  if (!/^[A-Z0-9]{4,40}$/.test(trackingNumber) || !validTrackingNumber(body.trackingNumber)) {
    throw new HttpError(400, 'Invalid tracking number');
  }
  if (isAmazonTrackingNumber(trackingNumber)) {
    await beforeAsking?.();
    const amazonShippingStatus = await checkAmazonShipping(trackingNumber);
    recordDetection('high');
    return { trackingNumber, carrier: ['available', 'expired'].includes(amazonShippingStatus) ? 'amazon-shipping' : 'amazon-logistics', amazonShippingStatus };
  }
  const detected = detectCarrierMatch(trackingNumber);
  // Shared shapes need shipment evidence; the shape alone remains a suggestion.
  const answer = detected.carrier === 'unknown' || recognitionCandidates(trackingNumber).length > 0 || recognitionCandidates(trackingNumber, { phase: 'browser' }).length > 0
    ? await recognize(trackingNumber, beforeAsking, signal, supportClient, countryHint).catch((error: unknown) => {
      if (signal?.aborted) throw new HttpError(499, 'Carrier check cancelled');
      throw error;
    })
    : { trackingNumber, carrier: detected.carrier } satisfies ApiCarrierDetectionResponse;
  recordDetection(answer.carrier !== 'unknown' ? 'high' : detected.confidence);
  if (supportClient && !signal?.aborted) await retainDetectionSupport(supportClient, answer);
  return answer;
}
