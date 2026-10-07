import 'server-only';
import { carrierErrorKind, retryAfterMsOf, normalizeCarrierResult, universalPlan, type CarrierResult, type UniversalSource } from 'universal-parcel-scraper';
import { UniversalTracker } from 'universal-parcel-scraper/node';
import { hostAdapterEnvironment } from './adapterRegistry';
import type { ProviderHealth } from './trackingRouting';
import type { ApiCarrierId } from '../generated/apiContract';
import { providerCarrier } from './providerCarrier';
import { normalizedLookupCountry } from './lookupCountry';

export type PreflightOutcome = { provider: UniversalSource; outcome: 'history' | 'no_history' | 'input_required' | 'unavailable' | 'deferred' };
const BUDGET_MS = 8_000;
const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 500;
interface PreflightAnswer { providers: PreflightOutcome[]; trackingFound?: boolean; carrier?: ApiCarrierId }
interface State {
  histories: Map<string, { at: number; result: CarrierResult }>;
  answers: Map<string, { at: number; answer: PreflightAnswer }>;
  pending: Map<string, { controller: AbortController; users: number; promise: Promise<PreflightAnswer> }>;
}
const key = Symbol.for('peek.trackingPreflight');
const scope = globalThis as typeof globalThis & { [key]?: State };
const state: State = scope[key] ??= { histories: new Map(), answers: new Map(), pending: new Map() };
let tracker: UniversalTracker | undefined;
function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key); map.set(key, value);
  if (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!);
}

function withinSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then((value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

function lookupKey(number: string, countryHint?: string | null): string {
  return `${number}:${normalizedLookupCountry(countryHint) ?? ''}`;
}

async function lookup(number: string, health: ProviderHealth, signal: AbortSignal, countryHint: string | null): Promise<PreflightAnswer> {
  const controller = new AbortController();
  const bounded = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(BUDGET_MS)]);
  const deadline = performance.now() + BUDGET_MS;
  const sources = universalPlan({ trackingNumber: number }).sources.filter((source) => source === 'Ship24' || source === 'ParcelsApp');
  const identities = new Set<ApiCarrierId | undefined>();
  const providers = await Promise.all(sources.map(async (provider): Promise<PreflightOutcome> => {
    let lease: Awaited<ReturnType<ProviderHealth['acquireTrackingProvider']>>;
    try {
      bounded.throwIfAborted();
      const acquiring = health.acquireTrackingProvider(provider);
      void acquiring.then((late) => {
        if (bounded.aborted && late.token) void health.finishTrackingProvider(provider, late.token, 'not_found', 0, 0).catch(() => undefined);
      }).catch(() => undefined);
      lease = await withinSignal(acquiring, bounded);
    }
    catch { return { provider, outcome: 'unavailable' }; }
    if (!lease.token) return { provider, outcome: 'deferred' };
    const started = performance.now();
    let retryAfterMs = 0;
    let kind: Parameters<ProviderHealth['finishTrackingProvider']>[2] = null;
    try {
      bounded.throwIfAborted();
      tracker ??= new UniversalTracker({ providers: ['Ship24', 'ParcelsApp'], environment: hostAdapterEnvironment() });
      const result = normalizeCarrierResult(await withinSignal(tracker.fetchSource(provider, number, Math.max(1, Math.floor(deadline - performance.now())), null, null, bounded, countryHint), bounded));
      bounded.throwIfAborted();
      if (!result.events?.length && (!result.status || ['unknown', 'pending'].includes(result.status))) {
        kind = 'not_found'; return { provider, outcome: 'no_history' };
      }
      remember(state.histories, `${provider}:${lookupKey(number, countryHint)}`, { at: Date.now(), result: structuredClone(result) });
      identities.add(providerCarrier(result, number));
      return { provider, outcome: 'history' };
    } catch (error) {
      if (signal.aborted) { kind = 'not_found'; return { provider, outcome: 'unavailable' }; }
      const failure = carrierErrorKind(error);
      retryAfterMs = Math.max(0, Math.min(7 * 86_400_000, retryAfterMsOf(error) ?? 0));
      // Missing recipient data is an answer about one parcel, never an upstream outage.
      if (failure === 'input_required') { kind = 'not_found'; return { provider, outcome: 'input_required' }; }
      if (failure === 'not_found' || failure === 'indeterminate') { kind = 'not_found'; return { provider, outcome: 'no_history' }; }
      kind = failure === 'rate_limited' ? 'rate_limited' : failure === 'challenge' ? 'verification' : failure === 'schema' ? 'schema' : 'transport';
      return { provider, outcome: 'unavailable' };
    } finally {
      await withinSignal(health.finishTrackingProvider(provider, lease.token, kind, retryAfterMs, performance.now() - started), bounded).catch(() => undefined);
    }
  }));
  signal.throwIfAborted();
  controller.abort();
  const carrier = identities.size === 1 ? [...identities][0] : undefined;
  return { providers, ...(providers.some(({ outcome }) => outcome === 'history') ? { trackingFound: true } : {}),
    ...(carrier ? { carrier } : {}) };
}

/** Bounded anonymous checks, shared by concurrent Add requests and reused by the first sync. */
export async function preflightTracking(number: string, health: ProviderHealth, signal?: AbortSignal, countryHint?: string | null): Promise<PreflightAnswer> {
  signal?.throwIfAborted();
  const country = normalizedLookupCountry(countryHint);
  const cacheKey = lookupKey(number, country);
  const cached = state.answers.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.answer.trackingFound ? TTL_MS : 30_000)) return structuredClone(cached.answer);
  let active = state.pending.get(cacheKey);
  if (!active) {
    if (state.pending.size >= 20) return { providers: [] };
    const controller = new AbortController();
    const promise = lookup(number, health, controller.signal, country).then((answer) => {
      remember(state.answers, cacheKey, { at: Date.now(), answer }); return answer;
    }).finally(() => { if (state.pending.get(cacheKey)?.controller === controller) state.pending.delete(cacheKey); });
    active = { controller, promise, users: 0 }; state.pending.set(cacheKey, active);
  }
  const job = active; job.users++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (answer?: PreflightAnswer, error?: unknown) => {
      if (finished) return; finished = true; signal?.removeEventListener('abort', abort);
      if (--job.users === 0 && state.pending.get(cacheKey) === job) job.controller.abort();
      if (error !== undefined) reject(error); else resolve(structuredClone(answer!));
    };
    const abort = () => finish(undefined, signal?.reason ?? new Error('Preflight cancelled'));
    signal?.addEventListener('abort', abort, { once: true });
    job.promise.then((answer) => finish(answer), (error: unknown) => finish(undefined, error));
    if (signal?.aborted) abort();
  });
}

/** Consume only anonymous, number-bound history; recipient credentials bypass this cache. */
export function takePreflightHistory(source: UniversalSource, number: string, postcode: string | null, countryHint?: string | null): CarrierResult | undefined {
  if (postcode) return undefined;
  const key = `${source}:${lookupKey(number, countryHint)}`; const entry = state.histories.get(key);
  if (!entry || Date.now() - entry.at >= TTL_MS) return undefined;
  state.histories.delete(key); return structuredClone(entry.result);
}

export function preflightInputNeeded(number: string, countryHint?: string | null) {
  const entry = state.answers.get(lookupKey(number, countryHint));
  if (!entry || Date.now() - entry.at >= TTL_MS || entry.answer.trackingFound) return undefined;
  const input = entry.answer.providers.find(({ outcome }) => outcome === 'input_required');
  return input ? { provider: input.provider, field: 'dpdPostcode' as const } : undefined;
}
