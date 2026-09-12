import 'server-only';

import { DateTime } from 'luxon';
import { detectCarrierMatch } from '../lib/carriers';
import { activeRequirements, AUTOMATIC_CARRIER_IDS, carrierAdapter } from './carriers';
import { normalizeCarrierResult, type CarrierResult } from './carrierResult';
import { isRecord, type JsonObject } from './types';
import { universalSources } from './universalTracking';
import type { UniversalSource } from './universalTrackingResult';
import { errorType, reportRoutingEvent } from './observability';
import { carrierErrorKind, retryAfterMsOf } from '@carriers/core/errors';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export type RoutingFailureKind = 'rate_limited' | 'not_found' | 'verification' | 'schema' | 'transport';
export interface ProviderHealth {
  acquireTrackingProvider(provider: string): Promise<{ token: string | null; retry_at: string }>;
  finishTrackingProvider(provider: string, token: string, kind: RoutingFailureKind | null, retryAfterMs: number, durationMs: number): Promise<void>;
}
export interface RoutedResult {
  correction?: { carrier: string; trackingUrl: string | null; postcode: string | null };
  result: CarrierResult;
  sourceCarrierId: string;
  swissPostReady: boolean | null;
  handoffFallbackErrorType: string | null;
  earlierResult?: CarrierResult;
  earlierCarrierId?: string;
}
interface Failure { count: number; retry_at: string; kind: RoutingFailureKind }
export interface RoutingState extends JsonObject {
  version: 1;
  configured_carrier: string;
  preferred_provider?: UniversalSource;
  preferred_number?: string;
  confirmed_carrier?: string;
  confirmed_number?: string;
  confirmed_tracking_url?: string | null;
  confirmed_postcode?: string | null;
  discovered_carrier?: string;
  last_success_at?: string;
  last_event_at?: string;
  next_check_at?: string;
  direct_retry_at?: string;
  last_probe_at?: string;
  probe_cursor: number;
  discovery_cursor: number;
  failures: Record<string, Failure>;
}

export function routingState(parcel: JsonObject): RoutingState {
  const data = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
  const old = isRecord(data.routing) && data.routing.version === 1 ? data.routing : {};
  const state = structuredClone(old) as Partial<RoutingState>;
  const changed = state.configured_carrier !== parcel.carrier;
  return {
    ...state, version: 1, configured_carrier: String(parcel.carrier),
    failures: isRecord(state.failures) ? state.failures : {},
    probe_cursor: Number.isSafeInteger(state.probe_cursor) ? state.probe_cursor! : 0,
    discovery_cursor: Number.isSafeInteger(state.discovery_cursor) ? state.discovery_cursor! : 0,
    ...(changed ? { direct_retry_at: undefined, next_check_at: undefined } : {}),
    // Migration compatibility: an ok fetch is a success; failed attempts are not.
    last_success_at: typeof state.last_success_at === 'string' ? state.last_success_at
      : parcel.sync_status === 'ok' && typeof parcel.last_synced_at === 'string' ? parcel.last_synced_at : undefined,
  };
}

export function freshnessWindow(now: Date): number {
  const hour = DateTime.fromJSDate(now, { zone: 'Europe/Zurich' }).hour;
  return hour >= 8 && hour < 22 ? HOUR : 3 * HOUR;
}
const millis = (value: unknown): number => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const iso = (value: number): string => new Date(value).toISOString();
export function routingFailure(error: unknown): { kind: RoutingFailureKind; retryAfterMs: number } {
  // Errors from the carrier package carry their kind; classify those first so
  // a wrong shipment or malformed payload keeps its hourly retry, and only fall
  // back to status sniffing for errors raised outside the taxonomy.
  const kind = carrierErrorKind(error);
  if (kind !== null) {
    const retryAfterMs = Math.max(0, Math.min(7 * DAY, retryAfterMsOf(error) ?? 0));
    if (kind === 'rate_limited') return { kind: 'rate_limited', retryAfterMs };
    if (kind === 'not_found') return { kind: 'not_found', retryAfterMs: 0 };
    if (kind === 'challenge') return { kind: 'verification', retryAfterMs: 0 };
    if (kind === 'schema' || kind === 'input_required') return { kind: 'schema', retryAfterMs: 0 };
    return { kind: 'transport', retryAfterMs };
  }
  let current = error;
  for (let i = 0; i < 8 && current instanceof Error; i++, current = current.cause) {
    const details = current as Error & { status?: number; retryAfterMs?: number };
    if (details.status === 429) return { kind: 'rate_limited', retryAfterMs: Number.isFinite(details.retryAfterMs) ? Math.max(0, Math.min(7 * DAY, details.retryAfterMs!)) : 0 };
    if (details.status === 404) return { kind: 'not_found', retryAfterMs: 0 };
    if (details.status === 401 || details.status === 403 || /Challenge|Verification/.test(current.name)) return { kind: 'verification', retryAfterMs: 0 };
  }
  return { kind: error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError ? 'schema' : 'transport', retryAfterMs: 0 };
}
function usable(value: CarrierResult): boolean {
  return Boolean(value.events?.length || value.status && !['unknown', 'pending'].includes(value.status)
    || value.current_stage && value.current_stage !== 'pending');
}
function latest(value: CarrierResult): number {
  return Math.max(millis(value.last_update), ...(value.events ?? []).map((event) => millis(event.time)), 0);
}
function directCarrier(carrier: string): boolean {
  return AUTOMATIC_CARRIER_IDS.has(carrier) && carrierAdapter(carrier) !== 'universal';
}

export class RoutingDeferred extends Error {
  constructor(readonly routing: RoutingState, readonly stale: boolean) {
    super(stale ? 'Tracking providers are temporarily unavailable. Previous progress has been kept; another check is scheduled.'
      : 'Recent tracking has been kept while the provider cools down.');
    this.name = 'RoutingDeferred';
  }
}

/** Per-parcel affinity lives in carrier_data; provider protection is shared in Postgres. */
export class TrackingRouter {
  constructor(readonly options: {
    direct: (parcel: JsonObject, carrier: string) => Promise<RoutedResult>;
    universal: (source: UniversalSource, number: string, timeoutMs: number) => Promise<CarrierResult>;
    health: ProviderHealth;
    now?: () => Date;
    enablePostalNinja?: boolean;
  }) {}

  async fetch(parcel: JsonObject, scheduled: boolean, signal?: AbortSignal): Promise<RoutedResult> {
    const now = () => this.options.now?.() ?? new Date();
    const state = routingState(parcel);
    const declared = String(parcel.carrier);
    const number = String(parcel.tracking_number ?? '');
    const metadata = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
    const universalNumber = metadata.original_carrier && metadata.active_tracking_carrier
      && typeof metadata.active_tracking_number === 'string' ? metadata.active_tracking_number : number;
    if (state.preferred_number && state.preferred_number !== universalNumber) state.preferred_provider = undefined;
    const sources = universalSources(this.options.enablePostalNinja);
    const recent = () => millis(state.last_success_at) > 0 && now().getTime() - millis(state.last_success_at) < freshnessWindow(now());
    const report = (code: string, provider: string, kind?: string, error?: unknown) => reportRoutingEvent(code, {
      carrier: declared, provider, category: kind, trackingNumber: number,
      ...(error ? { errorClass: errorType(error), error } : {}),
    });
    const fail = (provider: string, error: unknown): Failure => {
      const { kind, retryAfterMs } = routingFailure(error);
      const count = Math.min(20, (state.failures[provider]?.count ?? 0) + 1);
      const base = kind === 'not_found' ? DAY : kind === 'verification' || kind === 'schema' ? HOUR : 15 * 60_000;
      const failure = { count, kind, retry_at: iso(now().getTime() + Math.max(retryAfterMs, Math.min(kind === 'not_found' ? DAY : 6 * HOUR, base * 2 ** (count - 1)))) };
      state.failures[provider] = failure;
      // Called before another provider is attempted, including recovered failures.
      report('provider_failed', provider, kind, error);
      return failure;
    };
    const persistResult = (value: RoutedResult, provider: string): RoutedResult => {
      if (state.failures[provider]) report('provider_recovered', provider);
      delete state.failures[provider];
      state.last_success_at = now().toISOString();
      state.last_event_at = latest(value.result) ? iso(latest(value.result)) : state.last_event_at;
      // Universal checks are deliberately less frequent than direct in-transit polls.
      state.next_check_at = sources.includes(provider as UniversalSource)
        ? iso(now().getTime() + (freshnessWindow(now()) === HOUR ? 15 * 60_000 : HOUR)) : undefined;
      // A correction changes the selected carrier, not merely its display source.
      // Delivery-leg handoffs remain separate from correcting an incorrect label.
      const swap = provider !== declared && directCarrier(provider) && value.sourceCarrierId === provider
        && state.confirmed_number === number && !metadata.original_carrier;
      if (swap) {
        state.configured_carrier = provider;
        value.correction = { carrier: provider, trackingUrl: state.confirmed_tracking_url ?? null,
          postcode: state.confirmed_postcode ?? null };
      }
      return { ...value, result: { ...value.result, routing: state,
        ...(directCarrier(provider) ? { active_tracking_carrier: value.sourceCarrierId } : {}),
        ...(swap ? { auto_changed_from: declared, auto_changed_to: provider, auto_changed_at: now().toISOString() } : {}),
      } };
    };
    const attemptedDirect = new Set<string>();
    const tryDirect = async (carrier: string, candidate = false, terminalStage?: string): Promise<RoutedResult | null> => {
      signal?.throwIfAborted();
      if (!directCarrier(carrier) || attemptedDirect.has(carrier)) return null;
      // Never borrow a postcode/capability from another carrier or guess missing input.
      const ownInputs = state.confirmed_carrier === carrier && state.confirmed_number === number;
      if (candidate && !ownInputs && activeRequirements(carrier, number).length) {
        report('carrier_input_required', carrier); return null;
      }
      if (millis(state.failures[carrier]?.retry_at) > now().getTime()) return null;
      attemptedDirect.add(carrier);
      try {
        const value = await this.options.direct(candidate ? { ...parcel, carrier,
          tracking_url: ownInputs ? state.confirmed_tracking_url : null,
          dpd_postcode: ownInputs ? state.confirmed_postcode : null,
          carrier_data: {} } : parcel, carrier);
        value.result = normalizeCarrierResult(value.result);
        if (!usable(value.result)) throw Object.assign(new Error('No confirmed shipment progress'), { status: 404 });
        if (candidate && ![value.result.status, value.result.current_stage, ...(value.result.events ?? []).map((event) => event.stage)]
          .some((stage) => stage && stage !== 'pending' && stage !== 'unknown')) return null;
        if (candidate && latest(value.result) < millis(state.last_event_at)) return null;
        if (terminalStage && ['delivered', 'returned'].includes(terminalStage)
          && value.result.current_stage !== terminalStage) return null;
        if (carrier !== declared && state.confirmed_carrier !== carrier) report('carrier_mismatch_confirmed', carrier);
        state.confirmed_carrier = carrier;
        state.confirmed_number = number;
        if (candidate && !ownInputs) {
          state.confirmed_tracking_url = null;
          state.confirmed_postcode = null;
        } else if (!candidate) {
          state.confirmed_tracking_url = typeof parcel.tracking_url === 'string' ? parcel.tracking_url : null;
          state.confirmed_postcode = typeof parcel.dpd_postcode === 'string' ? parcel.dpd_postcode : null;
        }
        state.direct_retry_at = undefined;
        return value;
      } catch (error) {
        signal?.throwIfAborted();
        const failure = fail(carrier, error);
        state.direct_retry_at = failure.retry_at;
        if (failure.kind === 'rate_limited' && recent()) {
          state.next_check_at = iso(Math.min(millis(failure.retry_at), millis(state.last_success_at) + freshnessWindow(now())));
          report('fallback_deferred_fresh', carrier, failure.kind);
          throw new RoutingDeferred(state, false);
        }
        return null;
      }
    };

    // Try a new manual selection first; revalidate earlier confirmed corrections.
    const old = isRecord(parcel.carrier_data) && isRecord(parcel.carrier_data.routing) ? parcel.carrier_data.routing : {};
    const changed = old.configured_carrier !== undefined && old.configured_carrier !== declared;
    if (changed) { delete state.failures[declared]; report('manual_carrier_change', declared); }
    const primary = !changed && state.confirmed_number === number && state.confirmed_carrier
      ? state.confirmed_carrier : declared;
    if (!state.preferred_provider || changed || millis(state.direct_retry_at) <= now().getTime()) {
      const value = await tryDirect(primary, primary !== declared);
      if (value) return persistResult(value, primary);
    }

    // One evidence-based correction, not a fan-out to every matching number shape.
    const detected = detectCarrierMatch(number);
    const candidates = [...new Set([
      detected.confidence === 'high' ? detected.carrier : undefined,
      changed && state.confirmed_number === number ? state.confirmed_carrier : state.discovered_carrier,
    ])].filter((candidate): candidate is string => Boolean(candidate) && candidate !== primary);
    for (const candidate of candidates) {
      const value = await tryDirect(candidate, true);
      if (value) return persistResult(value, candidate);
    }

    const preferred = sources.includes(state.preferred_provider!) ? state.preferred_provider : undefined;
    const offset = state.discovery_cursor % sources.length;
    const ordered = [...new Set([...(preferred ? [preferred] : []), ...sources.slice(offset), ...sources.slice(0, offset)])];
    // Reserve one 30s lookup plus transport allowance for every enabled source.
    // Start after direct attempts so a slow carrier cannot starve discovery.
    const universalDeadline = performance.now() + sources.length * 35_000;
    const attemptedUniversal = new Set<UniversalSource>();
    let attempts = 0;
    const universal = async (source: UniversalSource): Promise<RoutedResult | null> => {
      signal?.throwIfAborted();
      // Node's AbortSignal.timeout requires integer milliseconds.
      const remaining = Math.floor(universalDeadline - performance.now());
      if (attemptedUniversal.has(source) || remaining <= 5_000 || millis(state.failures[source]?.retry_at) > now().getTime()) return null;
      attemptedUniversal.add(source);
      let lease: { token: string | null; retry_at: string };
      try { lease = await this.options.health.acquireTrackingProvider(source); }
      catch {
        report('health_store_unavailable', source, 'transport');
        state.failures[source] = { count: 0, kind: 'transport', retry_at: iso(now().getTime() + 15 * 60_000) };
        return null; // Fail closed: do not flood upstreams when coordination is down.
      }
      if (!lease.token) {
        state.failures[source] = { count: state.failures[source]?.count ?? 0, kind: 'rate_limited', retry_at: lease.retry_at };
        report('provider_cooldown', source); return null;
      }
      attempts++;
      const before = performance.now();
      let kind: RoutingFailureKind | null = null;
      let retryAfterMs = 0;
      try {
        const result = normalizeCarrierResult(await this.options.universal(source, universalNumber, Math.min(30_000, remaining - 5_000)));
        if (!usable(result)) throw new TypeError('No usable universal progress');
        const previousFailure = state.failures[source];
        if (previousFailure) report('provider_recovered', source);
        delete state.failures[source];
        return { result: { ...result, tracking_provider: source }, sourceCarrierId: 'unknown', swissPostReady: null, handoffFallbackErrorType: null };
      } catch (error) {
        const failure = fail(source, error);
        kind = failure.kind;
        retryAfterMs = millis(failure.retry_at) - now().getTime();
        if (kind === 'rate_limited' && recent()) {
          state.next_check_at = iso(Math.min(millis(failure.retry_at), millis(state.last_success_at) + freshnessWindow(now())));
          throw new RoutingDeferred(state, false);
        }
        return null;
      } finally {
        try { await this.options.health.finishTrackingProvider(source, lease.token, kind, retryAfterMs, performance.now() - before); }
        catch { report('health_store_unavailable', source, 'transport'); }
      }
    };

    for (const source of ordered) {
      let value = await universal(source);
      if (!value) continue;
      let chosen = source;
      // Scheduled-only shadow check. Keep affinity unless the alternative has
      // strictly newer progress; never merge contradictory provider summaries.
      if (scheduled && preferred === source && now().getTime() - millis(state.last_probe_at) >= DAY && attempts < 2) {
        const alternatives = sources.filter((item) => item !== source);
        const alternative = alternatives[state.probe_cursor % alternatives.length];
        state.probe_cursor++;
        state.last_probe_at = now().toISOString();
        const probe = alternative ? await universal(alternative).catch((error: unknown) => {
          if (!(error instanceof RoutingDeferred)) throw error;
          return null;
        }) : null;
        if (probe && latest(probe.result) > latest(value.result) && latest(probe.result) >= millis(state.last_event_at)
          && !['delivered', 'returned'].includes(String(value.result.current_stage))) {
          value = probe; chosen = alternative;
          report('fresher_provider_found', chosen);
        }
      }
      if (preferred !== chosen) report('provider_selected', chosen);
      if (!directCarrier(declared) && declared !== 'unknown' && declared !== 'intl-post' && !preferred) report('direct_support_opportunity', declared);
      state.preferred_provider = chosen;
      state.preferred_number = universalNumber;
      if (typeof value.result.discovered_carrier === 'string') {
        state.discovered_carrier = value.result.discovered_carrier;
        if (directCarrier(state.discovered_carrier) && state.discovered_carrier !== state.confirmed_carrier) {
          state.direct_retry_at = now().toISOString();
          report('direct_carrier_discovered', state.discovered_carrier);
        } else if (!directCarrier(state.discovered_carrier)) report('direct_support_opportunity', state.discovered_carrier);
      }
      // Confirm a newly reported carrier immediately. Preserve universal data if
      // confirmation fails, needs credentials, or only returned older history.
      if (state.discovered_carrier && universalNumber === number && !metadata.original_carrier) {
        const watermark = state.last_event_at;
        state.last_event_at = iso(Math.max(millis(watermark), latest(value.result)));
        const direct = await tryDirect(state.discovered_carrier, state.discovered_carrier !== declared,
          value.result.current_stage ?? value.result.status).catch((error: unknown) => {
          if (!(error instanceof RoutingDeferred)) throw error;
          return null;
        });
        state.last_event_at = watermark;
        if (direct) return persistResult(direct, state.discovered_carrier);
      }
      if (Array.isArray(value.result.reported_carriers)) {
        const seen = Array.isArray(state.reported_carriers_seen) ? state.reported_carriers_seen : [];
        for (const name of value.result.reported_carriers) {
          if (typeof name === 'string' && !value.result.discovered_carrier && !seen.includes(name)) report('carrier_coverage_discovered', name);
        }
        state.reported_carriers_seen = [...new Set([...seen, ...value.result.reported_carriers])].slice(-20);
      }
      state.direct_retry_at ??= iso(now().getTime() + 6 * HOUR);
      state.last_probe_at ??= now().toISOString();
      state.discovery_cursor = 0;
      return persistResult(value, chosen);
    }
    state.discovery_cursor = (offset + Math.max(1, attempts)) % sources.length;
    const deadlines = Object.values(state.failures).map((failure) => millis(failure.retry_at)).filter((time) => time > now().getTime());
    state.next_check_at = iso(Math.max(now().getTime() + 15 * 60_000, Math.min(...deadlines, now().getTime() + HOUR)));
    report('all_providers_unavailable', preferred ?? 'none');
    throw new RoutingDeferred(state, !recent());
  }
}
