import 'server-only';

import * as Sentry from '@sentry/node';
import type { LookupRecord, StepRecord, StepRecorder } from '@carriers/core/telemetry';
import { combineRecorders } from '@carriers/core/telemetry';
import { initObservability, logOperationalEvent, reportRoutingEvent } from './observability';

/**
 * The host's telemetry sinks for the carrier package's `StepRecorder`.
 *
 * Metric and log names stay identical to the previous `measureScrape` helper
 * so the Sentry "Scraper Health" dashboard keeps working: a step is a
 * `phase`, a lookup is `phase:total`, and a recovery step also counts a
 * fallback and emits the `transport_fallback` routing warning before the
 * result is known.
 */

function metric(operation: () => void): void {
  try {
    if (!initObservability()) return;
    operation();
  } catch { /* Telemetry must never change a tracking result. */ }
}

function outcomeLabel(outcome: StepRecord['outcome']): 'success' | 'error' {
  return outcome === 'ok' ? 'success' : 'error';
}

export const sentryStepRecorder: StepRecorder = {
  step(record: StepRecord) {
    const attributes = {
      carrier: record.carrier, phase: record.step, outcome: outcomeLabel(record.outcome), error_type: record.errorType ?? 'none',
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
    try { logOperationalEvent('tracking_scrape', { ...attributes, duration_ms: Math.round(record.durationMs) }); }
    catch { /* Preserve the result even if logging fails. */ }
    metric(() => {
      Sentry.metrics.distribution('tracking.scrape.duration', record.durationMs, { unit: 'millisecond', attributes });
      Sentry.metrics.count('tracking.scrape.attempts', 1, { attributes });
    });
  },
  lookup(record: LookupRecord) {
    const attributes = {
      carrier: record.carrier, phase: 'total', outcome: outcomeLabel(record.outcome), error_type: record.errorType ?? 'none',
    };
    try {
      logOperationalEvent('tracking_scrape', {
        ...attributes, duration_ms: Math.round(record.durationMs), final_step: record.finalStep ?? 'none', attempts: record.attempts,
      });
    } catch { /* Preserve the result even if logging fails. */ }
    metric(() => {
      Sentry.metrics.distribution('tracking.scrape.duration', record.durationMs, { unit: 'millisecond', attributes });
      Sentry.metrics.count('tracking.scrape.attempts', 1, { attributes });
    });
  },
};

const extraRecorders: StepRecorder[] = [];

/** Register another sink (for example Prometheus) once at startup. */
export function addStepRecorder(recorder: StepRecorder): void {
  extraRecorders.push(recorder);
}

/** The recorder handed to every adapter: Sentry plus any registered sinks, each failure-isolated. */
export function hostStepRecorder(): StepRecorder {
  return combineRecorders(sentryStepRecorder, ...extraRecorders);
}
