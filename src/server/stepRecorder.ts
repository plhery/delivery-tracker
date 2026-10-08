import 'server-only';

import * as Sentry from '@sentry/node';
import type { LookupRecord, StepRecord, StepRecorder } from 'universal-parcel-scraper/node';
import { combineRecorders } from 'universal-parcel-scraper/node';
import { healthStepRecorder } from './trackingHealth';
import { prometheusStepRecorder, stepOutcome } from './metrics';
import { initObservability, logOperationalEvent, reportRoutingEvent, trackingAttemptId } from './observability';

/**
 * The host's telemetry sinks for the scraper's `StepRecorder`.
 *
 * Metric and log names are the ones the Sentry "Scraper Health" dashboard
 * reads: a step is a `phase`, a lookup is `phase:total`, and a recovery step
 * also counts a fallback and records a `transport_fallback` breadcrumb before
 * the result is known.
 */

function metric(operation: () => void): void {
  try {
    if (!initObservability()) return;
    operation();
  } catch { /* Telemetry must never change a tracking result. */ }
}

/** Answers about the number rather than failures: the carrier or provider was reached and replied. */
const ANSWERS = new Set(['not_found', 'no_history', 'input_required', 'invalid_input']);

function outcomeLabel(record: StepRecord | LookupRecord): string {
  if (record.outcome === 'ok') return 'success';
  const outcome = stepOutcome(record.outcome, record.error);
  return ANSWERS.has(outcome) ? outcome : 'error';
}

export const sentryStepRecorder: StepRecorder = {
  step(record: StepRecord) {
    const attributes = {
      carrier: record.carrier, phase: record.step, outcome: outcomeLabel(record), error_type: record.errorType ?? 'none',
    };
    if (record.fallbackFrom) {
      // Report before-fallback evidence even when the recovery ultimately succeeds.
      try {
        reportRoutingEvent('transport_fallback', {
          carrier: record.carrier, provider: record.carrier, category: record.step,
          errorClass: record.fallbackErrorType ?? 'none', error: record.fallbackError,
        });
      } catch { /* Recovery reporting is best effort. */ }
      metric(() => Sentry.metrics.count('tracking.scrape.fallbacks', 1, {
        attributes: { carrier: record.carrier, from_phase: record.fallbackFrom!, to_phase: record.step, error_type: record.fallbackErrorType ?? 'none' },
      }));
    }
    try {
      logOperationalEvent('tracking_scrape', {
        ...attributes, duration_ms: Math.round(record.durationMs), attempt_id: trackingAttemptId(),
      });
    } catch { /* Preserve the result even if logging fails. */ }
    metric(() => {
      Sentry.metrics.distribution('tracking.scrape.duration', record.durationMs, { unit: 'millisecond', attributes });
      Sentry.metrics.count('tracking.scrape.attempts', 1, { attributes });
    });
  },
  lookup(record: LookupRecord) {
    const attributes = {
      carrier: record.carrier, phase: 'total', outcome: outcomeLabel(record), error_type: record.errorType ?? 'none',
    };
    try {
      logOperationalEvent('tracking_scrape', {
        ...attributes, duration_ms: Math.round(record.durationMs), final_step: record.finalStep ?? 'none', attempts: record.attempts,
        attempt_id: trackingAttemptId(),
      });
    } catch { /* Preserve the result even if logging fails. */ }
    metric(() => {
      Sentry.metrics.distribution('tracking.scrape.duration', record.durationMs, { unit: 'millisecond', attributes });
      Sentry.metrics.count('tracking.scrape.attempts', 1, { attributes });
    });
  },
};

const extraRecorders: StepRecorder[] = [];

/** Register another sink once at startup. */
export function addStepRecorder(recorder: StepRecorder): void {
  extraRecorders.push(recorder);
}

/**
 * The recorder handed to every adapter: health, Sentry and Prometheus plus any
 * registered sinks, each failure-isolated. Prometheus is wired here rather than
 * registered from a side-effect import, because every bundle that records a
 * lookup evaluates its own copy of this module and must reach the sink.
 */
export function hostStepRecorder(): StepRecorder {
  return combineRecorders(healthStepRecorder, sentryStepRecorder, prometheusStepRecorder, ...extraRecorders);
}
