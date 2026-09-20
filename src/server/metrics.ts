import 'server-only';

import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { METRICS, type LookupRecord, type StepRecord, type StepRecorder } from '@carriers/core/telemetry';

/**
 * Prometheus sink for carrier telemetry. Labels are deliberately
 * low-cardinality: carrier ids, step ids, outcome kinds and error class names
 * only. Nothing here can carry a tracking number or provider wording.
 *
 * `carrier_lookup_total{final_step}` is the one series that answers whether a
 * fallback tier is worth keeping: a tier that never serves a result can go.
 * Its `attempts` label says how many step attempts that took, so an in-adapter
 * retry that never serves on its last attempt can go too.
 * `carrier_refresh_total{served_by}` answers the question one level up: how
 * often a parcel of a carrier with its own adapter ended up on a universal
 * provider instead.
 */

/** Bump when the series or their labels change, so a hot-reloaded copy does not reuse an older shape. */
const RUNTIME_VERSION = 2;

interface PrometheusRuntime {
  version: number;
  registry: Registry;
  stepDuration: Histogram<'carrier' | 'step' | 'outcome'>;
  stepTotal: Counter<'carrier' | 'step' | 'outcome' | 'error_type'>;
  lookupTotal: Counter<'carrier' | 'final_step' | 'outcome' | 'attempts'>;
  fallbackTotal: Counter<'carrier' | 'from_step' | 'to_step' | 'reason'>;
  statusMappingTotal: Counter<'carrier' | 'stage_source'>;
  detectionTotal: Counter<'result'>;
  refreshTotal: Counter<'carrier' | 'served_by' | 'outcome'>;
}

// Next compiles instrumentation, the route handlers and the scrape endpoint
// into separate bundles, and each bundle evaluates its own copy of this module.
// The scheduled sync records in one copy while Prometheus reads another, so the
// series live on globalThis: one registry per process, whichever copy loads first.
const globalMetrics = globalThis as typeof globalThis & {
  __deliveryPrometheus?: PrometheusRuntime;
};

function createRuntime(): PrometheusRuntime {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  return {
    version: RUNTIME_VERSION,
    registry,
    stepDuration: new Histogram({
      name: METRICS.stepDuration,
      help: 'Duration of one adapter step attempt in seconds.',
      labelNames: ['carrier', 'step', 'outcome'] as const,
      buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60, 120],
      registers: [registry],
    }),
    stepTotal: new Counter({
      name: METRICS.stepTotal,
      help: 'Adapter step attempts by outcome and error class.',
      labelNames: ['carrier', 'step', 'outcome', 'error_type'] as const,
      registers: [registry],
    }),
    lookupTotal: new Counter({
      name: METRICS.lookupTotal,
      help: 'Carrier lookups by the step that produced the result and the step attempts it took.',
      labelNames: ['carrier', 'final_step', 'outcome', 'attempts'] as const,
      registers: [registry],
    }),
    fallbackTotal: new Counter({
      name: METRICS.fallbackTotal,
      help: 'Recovery steps run after an earlier step failed.',
      labelNames: ['carrier', 'from_step', 'to_step', 'reason'] as const,
      registers: [registry],
    }),
    statusMappingTotal: new Counter({
      name: METRICS.statusMappingTotal,
      help: 'Persisted events by how their stage was decided (carrier_map, wording, none).',
      labelNames: ['carrier', 'stage_source'] as const,
      registers: [registry],
    }),
    detectionTotal: new Counter({
      name: METRICS.detectionTotal,
      help: 'Tracking-number detections served to clients, by confidence.',
      labelNames: ['result'] as const,
      registers: [registry],
    }),
    refreshTotal: new Counter({
      name: METRICS.refreshTotal,
      help: 'Parcel refreshes by configured carrier, who served them (adapter, other_adapter, provider, none) and outcome.',
      labelNames: ['carrier', 'served_by', 'outcome'] as const,
      registers: [registry],
    }),
  };
}

const runtime = globalMetrics.__deliveryPrometheus?.version === RUNTIME_VERSION
  ? globalMetrics.__deliveryPrometheus
  : globalMetrics.__deliveryPrometheus = createRuntime();

export const registry = runtime.registry;

export const prometheusStepRecorder: StepRecorder = {
  step(record: StepRecord) {
    runtime.stepDuration.observe({ carrier: record.carrier, step: record.step, outcome: record.outcome }, record.durationMs / 1000);
    runtime.stepTotal.inc({ carrier: record.carrier, step: record.step, outcome: record.outcome, error_type: record.errorType ?? 'none' });
    if (record.fallbackFrom) {
      runtime.fallbackTotal.inc({
        carrier: record.carrier, from_step: record.fallbackFrom, to_step: record.step, reason: record.fallbackReason ?? 'error',
      });
    }
  },
  lookup(record: LookupRecord) {
    runtime.lookupTotal.inc({
      carrier: record.carrier, final_step: record.finalStep ?? 'none', outcome: record.outcome,
      attempts: String(Math.min(Math.max(Math.trunc(record.attempts) || 0, 0), 9)),
    });
  },
};

export type RefreshSource = 'adapter' | 'other_adapter' | 'provider' | 'none';

/** Who produced a refresh: the router reports every universal provider as the source `unknown`. */
export function refreshSource(carrier: string, source: string | null | undefined): RefreshSource {
  if (!source) return 'none';
  if (source === 'unknown') return 'provider';
  return source === carrier ? 'adapter' : 'other_adapter';
}

/** Called once per finished sync attempt; carrier ids and outcome names only. */
export function recordRefresh(carrier: string, source: string | null | undefined, outcome: string): void {
  runtime.refreshTotal.inc({ carrier, served_by: refreshSource(carrier, source), outcome });
}

/** Called by the sync for every persisted event; the source family keeps cardinality small. */
export function recordStatusMapping(carrier: string, stageSource: string): void {
  const family = stageSource === 'carrier_map' || stageSource === 'none' ? stageSource
    : stageSource.startsWith('wording:') ? 'wording' : 'other';
  runtime.statusMappingTotal.inc({ carrier, stage_source: family });
}

export function recordDetection(result: 'high' | 'low' | 'none'): void {
  runtime.detectionTotal.inc({ result });
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
