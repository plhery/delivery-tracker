/**
 * What the package reports about every lookup, and the interface the host
 * implements to receive it. The package never talks to Sentry, Prometheus or a
 * database itself: the host wires a `StepRecorder` to whichever sinks it runs.
 *
 * Every attempt of every step produces one `StepRecord`; every lookup produces
 * one `LookupRecord` whose `finalStep` says which tier served the result. That
 * single field answers "is this fallback tier worth keeping".
 */
import { carrierErrorKind, errorTypeOf, type CarrierErrorKind } from '../errors';

export type StepOutcome = 'ok' | CarrierErrorKind | 'error';

export interface StepRecord {
  carrier: string;
  step: string;
  /** 1-based position of this attempt within the lookup. */
  attempt: number;
  outcome: StepOutcome;
  errorType: string | null;
  durationMs: number;
  /** The step whose failure caused this one to run, if any. */
  fallbackFrom: string | null;
  fallbackReason: StepOutcome | null;
  fallbackErrorType: string | null;
  /** The previous step's error when this step is a recovery; for sinks that report before-fallback warnings. */
  fallbackError?: unknown;
  /** The original error, for sinks that keep stacks. Never serialize it into metrics. */
  error?: unknown;
}

export interface LookupRecord {
  carrier: string;
  /** The step that produced the result, or the last step attempted when the lookup failed. */
  finalStep: string | null;
  outcome: StepOutcome;
  errorType: string | null;
  durationMs: number;
  /** Number of step attempts made. */
  attempts: number;
  error?: unknown;
}

export interface StepRecorder {
  step(record: StepRecord): void;
  lookup(record: LookupRecord): void;
}

export const NOOP_RECORDER: StepRecorder = {
  step() {},
  lookup() {},
};

/** Telemetry must never change a tracking result: every sink call is guarded. */
export function safeRecorder(recorder: StepRecorder): StepRecorder {
  return {
    step(record) {
      try { recorder.step(record); } catch { /* sink failures are not lookup failures */ }
    },
    lookup(record) {
      try { recorder.lookup(record); } catch { /* sink failures are not lookup failures */ }
    },
  };
}

/** Combine several recorders (for example Sentry, ledger and Prometheus). */
export function combineRecorders(...recorders: StepRecorder[]): StepRecorder {
  const safe = recorders.map(safeRecorder);
  return {
    step(record) { for (const recorder of safe) recorder.step(record); },
    lookup(record) { for (const recorder of safe) recorder.lookup(record); },
  };
}

export function outcomeOf(error: unknown): StepOutcome {
  return carrierErrorKind(error) ?? 'error';
}

export { errorTypeOf };

/** Metric names and labels emitted by the host's Prometheus sink; listed here so dashboards and code agree. */
export const METRICS = {
  stepDuration: 'carrier_step_duration_seconds',
  stepTotal: 'carrier_step_total',
  lookupTotal: 'carrier_lookup_total',
  fallbackTotal: 'carrier_fallback_total',
  statusMappingTotal: 'carrier_status_mapping_total',
  detectionTotal: 'carrier_detection_total',
} as const;
