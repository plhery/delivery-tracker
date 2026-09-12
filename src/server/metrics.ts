import 'server-only';

import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { METRICS, type LookupRecord, type StepRecord, type StepRecorder } from '@carriers/core/telemetry';
import { addStepRecorder } from './stepRecorder';

/**
 * Prometheus sink for carrier telemetry. Labels are deliberately
 * low-cardinality: carrier ids, step ids, outcome kinds and error class names
 * only. Nothing here can carry a tracking number or provider wording.
 *
 * `carrier_lookup_total{final_step}` is the one series that answers whether a
 * fallback tier is worth keeping: a tier that never serves a result can go.
 */

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

const stepDuration = new Histogram({
  name: METRICS.stepDuration,
  help: 'Duration of one adapter step attempt in seconds.',
  labelNames: ['carrier', 'step', 'outcome'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
  registers: [registry],
});
const stepTotal = new Counter({
  name: METRICS.stepTotal,
  help: 'Adapter step attempts by outcome and error class.',
  labelNames: ['carrier', 'step', 'outcome', 'error_type'] as const,
  registers: [registry],
});
const lookupTotal = new Counter({
  name: METRICS.lookupTotal,
  help: 'Carrier lookups by the step that produced the result.',
  labelNames: ['carrier', 'final_step', 'outcome'] as const,
  registers: [registry],
});
const fallbackTotal = new Counter({
  name: METRICS.fallbackTotal,
  help: 'Recovery steps run after an earlier step failed.',
  labelNames: ['carrier', 'from_step', 'to_step', 'reason'] as const,
  registers: [registry],
});
const statusMappingTotal = new Counter({
  name: METRICS.statusMappingTotal,
  help: 'Persisted events by how their stage was decided (carrier_map, wording, none).',
  labelNames: ['carrier', 'stage_source'] as const,
  registers: [registry],
});
const detectionTotal = new Counter({
  name: METRICS.detectionTotal,
  help: 'Tracking-number detections served to clients, by confidence.',
  labelNames: ['result'] as const,
  registers: [registry],
});

export const prometheusStepRecorder: StepRecorder = {
  step(record: StepRecord) {
    stepDuration.observe({ carrier: record.carrier, step: record.step, outcome: record.outcome }, record.durationMs / 1000);
    stepTotal.inc({ carrier: record.carrier, step: record.step, outcome: record.outcome, error_type: record.errorType ?? 'none' });
    if (record.fallbackFrom) {
      fallbackTotal.inc({
        carrier: record.carrier, from_step: record.fallbackFrom, to_step: record.step, reason: record.fallbackReason ?? 'error',
      });
    }
  },
  lookup(record: LookupRecord) {
    lookupTotal.inc({ carrier: record.carrier, final_step: record.finalStep ?? 'none', outcome: record.outcome });
  },
};

/** Called by the sync for every persisted event; the source family keeps cardinality small. */
export function recordStatusMapping(carrier: string, stageSource: string): void {
  const family = stageSource === 'carrier_map' || stageSource === 'none' ? stageSource
    : stageSource.startsWith('wording:') ? 'wording' : 'other';
  statusMappingTotal.inc({ carrier, stage_source: family });
}

export function recordDetection(result: 'high' | 'low' | 'none'): void {
  detectionTotal.inc({ result });
}

export async function metricsText(): Promise<string> {
  return registry.metrics();
}

export const metricsContentType = registry.contentType;

/** Whether the metrics endpoint is exposed; the token protects it because it names carriers and error classes. */
export function metricsToken(env: Record<string, string | undefined> = process.env): string | null {
  const token = env.METRICS_TOKEN?.trim();
  return token && token.length >= 16 ? token : null;
}

const globalRuntime = globalThis as typeof globalThis & { __deliveryPrometheusInstalled?: boolean };
if (!globalRuntime.__deliveryPrometheusInstalled) {
  addStepRecorder(prometheusStepRecorder);
  globalRuntime.__deliveryPrometheusInstalled = true;
}
