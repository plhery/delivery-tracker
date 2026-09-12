import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LookupRecord, StepRecord } from '@carriers/core/telemetry';
import type { JsonObject } from './types';

export interface HealthSample extends JsonObject {
  kind: 'refresh' | 'provider' | 'direct';
  subject: string;
  healthy: boolean;
  details: JsonObject;
}
const observations = new AsyncLocalStorage<Map<string, HealthSample>>();
const excluded = new Set(['not_found', 'input_required']);

function details(record: StepRecord | LookupRecord): JsonObject {
  let status: number | null = null;
  let current = record.error;
  for (let depth = 0; current instanceof Error && depth < 8; depth++, current = current.cause) {
    const value = (current as Error & { status?: unknown }).status;
    if (typeof value === 'number' && value >= 100 && value <= 599) status = value;
  }
  return { error_type: record.errorType, category: record.outcome, http_status: status,
    step: 'step' in record ? record.step : record.finalStep };
}
function save(kind: 'provider' | 'direct', record: StepRecord | LookupRecord): void {
  const store = observations.getStore();
  if (!store || excluded.has(record.outcome)) return;
  const key = `${kind}:${record.carrier}`;
  const previous = store.get(key);
  // A retry cannot count as another lookup or erase the original failed direct attempt.
  if (previous && !previous.healthy) return;
  store.set(key, { kind, subject: record.carrier.slice(0, 100), healthy: record.outcome === 'ok', details: details(record) });
}
export const healthStepRecorder = {
  step(record: StepRecord) { if (record.step === 'direct') save('direct', record); },
  lookup(record: LookupRecord) { save('provider', record); },
};
export function observeTrackingHealth<T>(samples: Map<string, HealthSample>, operation: () => Promise<T>): Promise<T> {
  return observations.run(samples, operation);
}

export function healthMessage(incident: JsonObject): { title: string; nextSteps: string; impact: string } {
  const subject = String(incident.subject);
  const refresh = incident.kind === 'refresh';
  const recovered = incident.state === 'recovered';
  const evidence = incident.evidence as JsonObject | undefined;
  const scope = refresh ? 'Shipment refreshes' : incident.kind === 'direct' ? 'Direct tracking' : 'Provider lookups';
  const title = recovered ? `${scope} recovered: ${subject}`
    : `${scope} repeatedly failing: ${subject} (${incident.failures}/${incident.attempts} in ${incident.window_hours}h${incident.consecutive_failures ? '; 3 consecutive checks failed for a parcel' : ''})`;
  let nextSteps = 'Inspect the carrier scraper dashboard and the latest error type. Check the provider response and adapter parsing; retain the working fallback and scheduled backoff.';
  if (evidence?.http_status === 429) nextSteps = 'Honor Retry-After and inspect provider cooldowns. Reduce request frequency; do not increase retries or browser parallelism.';
  else if (['input_required','not_found'].includes(String(evidence?.category))) nextSteps = 'Check whether the shipment has been announced and whether its required postcode or tracking credentials were supplied. Do not retry invalid inputs immediately.';
  else if (evidence?.http_status === 403 || evidence?.category === 'challenge') nextSteps = 'Check for carrier maintenance or a verification challenge. Use the browser or alternate provider, keep the cooldown, and inspect the direct adapter if the refusal persists.';
  else if (subject === 'ups' && incident.kind === 'direct') nextSteps = 'Check UPS direct API reachability and session refresh. Keep browser fallback enabled; direct access is periodically probed during its cooldown.';
  else if (['trawl','browser','page'].includes(String(evidence?.step))) nextSteps = 'Check TRAWL health, container memory/OOM events and browser availability. A closed browser needs replacement before retrying; keep concurrency bounded.';
  else if (Number(evidence?.http_status) >= 500) nextSteps = 'Check the upstream service for maintenance. Inspect the bounded retry and fallback results; allow scheduled backoff rather than adding more retries.';
  return { title, nextSteps: recovered ? 'Three recent checks succeeded. No action needed; threshold monitoring remains active.' : nextSteps,
    impact: refresh ? recovered ? 'Scheduled shipment refreshes are succeeding again.' : 'Scheduled shipment refreshes failed after routing and fallback. Previous saved progress is retained.'
      : 'This describes one provider or direct transport, not the final shipment refresh. Check refresh incidents to determine user impact.' };
}
