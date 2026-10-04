import 'server-only';

import { randomUUID } from 'node:crypto';
import type { CarrierResult } from 'universal-parcel-scraper';
import { latestResultTime } from 'universal-parcel-scraper/app';
import type { ApiCarrierDetectionResponse } from '../generated/apiContract';
import { detectCarrierMatch } from '../lib/carriers';
import { directHistoryNumber } from './directLocalHistory';
import { captureOperationalError, errorType, logOperationalEvent } from './observability';
import type { SupabaseServiceClient } from './supabase';
import { directCarrier, hasRoutingProgress } from './trackingRouting';
import type { JsonObject } from './types';

/** Capture a detection gap before a successful provider can hide it. */
export function trackingSupportContext(trackingNumber: string, configuredCarrier: string): JsonObject {
  const number = trackingNumber.replace(/[\s.-]/g, '').toUpperCase();
  const detection = detectCarrierMatch(number);
  const reasons: string[] = [];
  if (detection.carrier === 'unknown') {
    reasons.push(detection.candidates.length ? 'ambiguous_shape' : 'unknown_shape');
  } else if (detection.carrier === 'intl-post') {
    reasons.push('generic_postal');
  }
  if (!['unknown', 'intl-post'].includes(configuredCarrier) && !directCarrier(configuredCarrier)) {
    reasons.push('no_direct_adapter');
  }
  if (!['unknown', 'intl-post'].includes(configuredCarrier)
    && detection.carrier !== 'intl-post' && detection.candidates.length
    && !detection.candidates.some(carrier => carrier === configuredCarrier)) {
    reasons.push('carrier_mismatch');
  }
  return {
    tracking_number: number,
    configured_carrier: configuredCarrier,
    detection_carrier: detection.carrier,
    detection_confidence: detection.confidence,
    detection_candidates: detection.candidates.slice(0, 32),
    reasons,
    ...(process.env.IMAGE_COMMIT ? { app_version: process.env.IMAGE_COMMIT.slice(0, 100) } : {}),
  };
}

/** Keep unresolved submissions even when the visitor never saves a parcel. */
export async function retainDetectionSupport(
  client: SupabaseServiceClient,
  answer: ApiCarrierDetectionResponse,
): Promise<void> {
  if (answer.carrier !== 'unknown') return;
  const choice = (answer.recognized?.length ?? 0) > 1;
  const context = trackingSupportContext(answer.trackingNumber, answer.carrier);
  context.reasons = [...context.reasons as string[], choice ? 'recognition_choice' : 'recognition_unknown'];
  const outcome = choice ? 'detection_choice' : 'detection_unknown';
  logOperationalEvent('carrier_detection_support', {
    tracking_number: answer.trackingNumber, outcome,
    asked_carriers: answer.asked?.join(',') ?? '',
    unanswered_carriers: answer.unanswered?.join(',') ?? '',
    recognized_carriers: answer.recognized?.join(',') ?? '',
  });
  try {
    await client.recordTrackingSupportObservation(answer.trackingNumber, context, { outcome }, new Date(), `detection:${randomUUID()}`);
  } catch (error) {
    logOperationalEvent('tracking_support_write_failed', {
      operation: 'detection', tracking_number: answer.trackingNumber, error_type: errorType(error),
    }, 'error');
    captureOperationalError(error, {
      component: 'tracking-support', operation: 'detection', trackingNumber: answer.trackingNumber, withoutRequest: true,
    });
  }
}

/** Only accepted progress from this exact number can verify a direct fix. */
export function trackingSupportEvidence(
  parcel: JsonObject,
  result: CarrierResult,
  sourceCarrier: string,
  outcome: string,
  preserveSummary: boolean,
): JsonObject {
  const number = directHistoryNumber(parcel, result);
  const provider = typeof result.tracking_provider === 'string' ? result.tracking_provider.slice(0, 80) : null;
  return {
    support_lookup_number: typeof number === 'string' ? number : null,
    support_provider: provider,
    support_direct_progress: outcome === 'updated' && !preserveSummary && !provider
      && directCarrier(sourceCarrier) && hasRoutingProgress(result)
      && latestResultTime(result, sourceCarrier) > 0,
  };
}
