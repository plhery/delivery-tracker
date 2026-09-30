/**
 * Live coverage probe: each case's number through its carrier's own adapter and
 * through every universal provider separately, with no stop at the first
 * success. Driven by coverage-probe.mjs, which documents the inputs.
 *
 * Records keep counts, times and stages only: no number, event text or
 * location, so a record cannot carry recipient data.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { AdapterRegistry, type AdapterEnvironment } from '../core/adapter';
import { carrierErrorKind, NoHistoryError } from '../core/errors';
import { NOOP_RECORDER } from '../core/telemetry';
import { TrawlClient } from '../core/transport';
import { isValidS10TrackingNumber } from '../core/detection/s10';
import { normalizeTrackingNumber } from '../core/detection/normalize';
import type { CarrierResult } from '../core/result';
import { CARRIER_CATALOG } from '../generated/catalog';
import { REGISTRY } from '../generated/registry';
import { BROWSER_SOURCES, UniversalTracker } from '../providers/universal';
import { COVERAGE_SOURCES } from '../providers/coverage';
import type { UniversalSource } from '../providers/shared/result';

interface ProbeCase { carrier: string; number: string; postcode?: string | null; reference?: number }
type Source = 'direct' | UniversalSource;

const TRAWL_URL = process.env.COVERAGE_PROBE_TRAWL_URL ?? '';
const SOURCES: Source[] = ['direct', ...COVERAGE_SOURCES];

function environment(): AdapterEnvironment {
  return {
    trawl: TRAWL_URL ? new TrawlClient(TRAWL_URL) : null,
    browserExecutablePath: process.env.TRACKING_CHROMIUM_PATH ?? null,
    recorder: NOOP_RECORDER,
    env: { ...process.env, TRACKING_ENABLE_POSTAL_NINJA: 'true' },
  };
}

/** The catalog zone universal providers get for the carrier in production. */
function zoneOf(carrier: string): string | null {
  const zone = (CARRIER_CATALOG as Record<string, { timezone?: string }>)[carrier]?.timezone;
  return zone && zone !== 'UTC' ? zone : null;
}

function answer(error: unknown): { outcome: string; error: string } {
  const kind = carrierErrorKind(error);
  const outcome = kind === 'not_found' || error instanceof NoHistoryError ? 'no_history'
    : kind === 'input_required' ? 'postcode_prompt'
      : kind === 'challenge' ? 'blocked' : 'error';
  const chain: string[] = [];
  for (let current = error, depth = 0; current instanceof Error && depth < 4; current = current.cause, depth++) {
    const reason = (current as Error & { reason?: unknown }).reason;
    chain.push(`${current.name}${kind && depth === 0 ? `(${kind})` : ''}${typeof reason === 'string' ? `[${reason}]` : ''}`);
  }
  return { outcome, error: chain.join(' <- ') || String(error).slice(0, 80) };
}

function summary(result: CarrierResult) {
  const events = result.events ?? [];
  const dated = events.filter((event) => typeof event.time === 'string' && Number.isFinite(Date.parse(event.time)));
  const newest = dated.reduce<typeof dated[number] | undefined>((best, event) =>
    !best || Date.parse(event.time!) > Date.parse(best.time!) ? event : best, undefined);
  return {
    rows: events.length, undated: events.length - dated.length,
    latest: newest?.time ?? null, latestStage: newest?.stage ?? result.current_stage ?? null,
    reported: Array.isArray(result.reported_carriers) ? result.reported_carriers.slice(0, 6) : [],
  };
}

async function probe(item: ProbeCase, source: Source, registry: AdapterRegistry, tracker: UniversalTracker) {
  const base = { carrier: item.carrier, reference: item.reference ?? 0, source };
  const started = Date.now();
  try {
    let result: CarrierResult;
    if (source === 'direct') {
      const adapter = registry.for(item.carrier);
      if (!adapter) return { ...base, outcome: 'no_adapter', ms: 0 };
      result = await adapter.track({ number: normalizeTrackingNumber(item.number), postcode: item.postcode ?? null, timezone: null });
    } else if (source === 'UPU' && !isValidS10TrackingNumber(item.number)) {
      return { ...base, outcome: 'n/a', ms: 0 };
    } else {
      result = await tracker.fetchSource(source, item.number, source === 'UPU' ? undefined : 45_000, item.postcode ?? null, zoneOf(item.carrier));
    }
    const counted = summary(result);
    return { ...base, outcome: counted.rows ? 'history' : 'summary_only', ...counted, ms: Date.now() - started };
  } catch (error) {
    return { ...base, ...answer(error), ms: Date.now() - started };
  }
}

it('probes every case through every source', async () => {
  const cases = JSON.parse(readFileSync(process.env.COVERAGE_PROBE_CASES!, 'utf8')) as ProbeCase[];
  const output = process.env.COVERAGE_PROBE_OUT!;
  const only = process.env.COVERAGE_PROBE_SOURCES ? new Set(process.env.COVERAGE_PROBE_SOURCES.split(',')) : null;
  const env = environment();
  const registry = new AdapterRegistry(REGISTRY, env);
  const tracker = new UniversalTracker({ enablePostalNinja: true, environment: env, ...(TRAWL_URL ? {} : { trawlUrl: '' }) });
  // Browser-service lookups run one at a time, beside the HTTP ones.
  const lane = async (browser: boolean) => {
    for (const item of cases) {
      for (const source of SOURCES) {
        if ((only && !only.has(source)) || BROWSER_SOURCES.has(source as UniversalSource) !== browser) continue;
        const record = await probe(item, source, registry, tracker);
        appendFileSync(output, `${JSON.stringify(record)}\n`);
        console.log(`${item.carrier} ${source} ${record.ms} ms ${record.outcome}${'rows' in record ? ` ${record.rows}` : ''}${'error' in record ? ` ${record.error}` : ''}`);
      }
    }
  };
  await Promise.all([lane(true), lane(false)]);
}, 3_600_000);
