import 'server-only';

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics, type LabelValues } from '@prometheus-io/client';
import { METRICS, type LookupRecord, type StepRecord, type StepRecorder } from 'universal-parcel-scraper/node';

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
 *
 * The parcel-link series count lookups without an account, link reads, kept
 * parcels and forgotten ones by outcome only: never by number, link or client.
 */

/** Bump when the series or their labels change, so a hot-reloaded copy does not reuse an older shape. */
const RUNTIME_VERSION = 4;

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
  publicLookupTotal: Counter<'outcome'>;
  publicParcelReadTotal: Counter<'outcome'>;
  parcelClaimTotal: Counter<'outcome'>;
  parcelForgottenTotal: Counter<'kind' | 'reason'>;
  publicLookupClients: Gauge;
  publicLookupsPerClient: Gauge<'stat'>;
  /** Series a scrape has shown; they count at once. */
  scraped: Set<string>;
  /** Series created at 0 since the last scrape, with the updates they wait to apply. */
  held: Map<string, Array<() => void>>;
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
    publicLookupTotal: new Counter({
      name: 'public_lookup_total',
      help: 'Lookups without an account by outcome (created, reused, limited_burst, limited_daily, limited_global).',
      labelNames: ['outcome'] as const,
      registers: [registry],
    }),
    publicParcelReadTotal: new Counter({
      name: 'public_parcel_read_total',
      help: 'Reads of a parcel link by outcome (ok, not_found).',
      labelNames: ['outcome'] as const,
      registers: [registry],
    }),
    parcelClaimTotal: new Counter({
      name: 'parcel_claim_total',
      help: 'Parcel links kept in an account by outcome (kept, already, quota, unavailable).',
      labelNames: ['outcome'] as const,
      registers: [registry],
    }),
    parcelForgottenTotal: new Counter({
      name: 'parcel_forgotten_total',
      help: 'Forgotten parcel links and one-off parcels (kind) by reason (asked, expired).',
      labelNames: ['kind', 'reason'] as const,
      registers: [registry],
    }),
    publicLookupClients: new Gauge({
      name: 'public_lookup_clients',
      help: 'Clients (hashed addresses) that made a lookup without an account yesterday (UTC).',
      registers: [registry],
    }),
    publicLookupsPerClient: new Gauge({
      name: 'public_lookups_per_client',
      help: 'Lookups without an account per client yesterday (UTC): median, 90th percentile and maximum.',
      labelNames: ['stat'] as const,
      registers: [registry],
    }),
    scraped: new Set(),
    held: new Map(),
  };
}

const runtime = globalMetrics.__deliveryPrometheus?.version === RUNTIME_VERSION
  ? globalMetrics.__deliveryPrometheus
  : globalMetrics.__deliveryPrometheus = createRuntime();

export const registry = runtime.registry;

/**
 * Every deploy restarts the counters, and a series whose first scrape already
 * shows 1 gives `increase()` nothing to count from, so an error seen once per
 * container never reached a dashboard. A new series is created at 0 and its
 * updates wait until a scrape has shown it; later updates apply at once.
 */
function afterFirstScrape(key: string, create: () => void, update: () => void): void {
  const held = runtime.held.get(key);
  if (held) held.push(update);
  else if (runtime.scraped.has(key)) update();
  else {
    create();
    runtime.held.set(key, [update]);
  }
}

function count<L extends string>(counter: Counter<L>, name: string, labels: LabelValues<L>): void {
  afterFirstScrape(name + JSON.stringify(labels), () => counter.inc(labels, 0), () => counter.inc(labels));
}

export const prometheusStepRecorder: StepRecorder = {
  step(record: StepRecord) {
    const timing = { carrier: record.carrier, step: record.step, outcome: record.outcome };
    afterFirstScrape(METRICS.stepDuration + JSON.stringify(timing), () => runtime.stepDuration.zero(timing),
      () => runtime.stepDuration.observe(timing, record.durationMs / 1000));
    count(runtime.stepTotal, METRICS.stepTotal, { ...timing, error_type: record.errorType ?? 'none' });
    if (record.fallbackFrom) {
      count(runtime.fallbackTotal, METRICS.fallbackTotal, {
        carrier: record.carrier, from_step: record.fallbackFrom, to_step: record.step, reason: record.fallbackReason ?? 'error',
      });
    }
  },
  lookup(record: LookupRecord) {
    count(runtime.lookupTotal, METRICS.lookupTotal, {
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
  count(runtime.refreshTotal, METRICS.refreshTotal, { carrier, served_by: refreshSource(carrier, source), outcome });
}

/** Called by the sync for every persisted event; the source family keeps cardinality small. */
export function recordStatusMapping(carrier: string, stageSource: string): void {
  const family = stageSource === 'carrier_map' || stageSource === 'none' ? stageSource
    : stageSource.startsWith('wording:') ? 'wording' : 'other';
  count(runtime.statusMappingTotal, METRICS.statusMappingTotal, { carrier, stage_source: family });
}

export function recordDetection(result: 'high' | 'low' | 'none'): void {
  count(runtime.detectionTotal, METRICS.detectionTotal, { result });
}

export type PublicLookupOutcome = 'created' | 'reused' | 'limited_burst' | 'limited_daily' | 'limited_global';

export function recordPublicLookup(outcome: PublicLookupOutcome): void {
  count(runtime.publicLookupTotal, 'public_lookup_total', { outcome });
}

export function recordPublicParcelRead(outcome: 'ok' | 'not_found'): void {
  count(runtime.publicParcelReadTotal, 'public_parcel_read_total', { outcome });
}

export function recordParcelClaim(outcome: 'kept' | 'already' | 'quota' | 'unavailable'): void {
  count(runtime.parcelClaimTotal, 'parcel_claim_total', { outcome });
}

/** Links and one-off parcels forgotten on request (`asked`) or past their forget date (`expired`). */
export function recordParcelsForgotten(reason: 'asked' | 'expired', forgotten: { links: number; packages: number }): void {
  for (const [kind, total] of [['link', forgotten.links], ['package', forgotten.packages]] as const) {
    if (total > 0) afterFirstScrape(`parcel_forgotten_total${JSON.stringify({ kind, reason })}`,
      () => runtime.parcelForgottenTotal.inc({ kind, reason }, 0),
      () => runtime.parcelForgottenTotal.inc({ kind, reason }, total));
  }
}

/** Yesterday's lookups per client, set by the maintenance pass; the p90 tells whether the daily allowance pinches. */
export function recordPublicLookupUsage(summary: { buckets: number; p50: number; p90: number; max: number }): void {
  runtime.publicLookupClients.set(summary.buckets);
  runtime.publicLookupsPerClient.set({ stat: 'p50' }, summary.p50);
  runtime.publicLookupsPerClient.set({ stat: 'p90' }, summary.p90);
  runtime.publicLookupsPerClient.set({ stat: 'max' }, summary.max);
}

/** Renders the registry for Prometheus, then releases what the series it showed at 0 held back. */
export async function metricsText(): Promise<string> {
  // A series created while this reply renders may be missing from it: it waits for the next.
  const shown = [...runtime.held.keys()];
  const text = await registry.metrics();
  for (const key of shown) {
    for (const update of runtime.held.get(key) ?? []) update();
    runtime.held.delete(key);
    runtime.scraped.add(key);
  }
  return text;
}

export const metricsContentType = registry.contentType;

/** Whether the metrics endpoint is exposed; the token protects it because it names carriers and error classes. */
export function metricsToken(env: Record<string, string | undefined> = process.env): string | null {
  const token = env.METRICS_TOKEN?.trim();
  return token && token.length >= 16 ? token : null;
}
