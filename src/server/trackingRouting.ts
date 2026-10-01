import 'server-only';
import { trackingFailureCode } from './trackingFailure';

import { DateTime } from 'luxon';
import { detectCarrierMatch } from '../lib/carriers';
import { AUTOMATIC_CARRIER_IDS, carrierAdapter, carrierTimezone, requiredRequirements } from './carriers';
import { normalizeCarrierResult, type CarrierResult } from '@carriers/core/result';
import { isRecord, type JsonObject } from './types';
import { priorityUniversalSource, universalPlan, universalSourceBudget } from '@carriers/providers/universal';
import type { UniversalSource } from '@carriers/providers/shared/result';
import { isKnownCarrierName } from '@carriers/providers/shared/hints';
import { brandCarrierIds, carrierBrand, carrierIdFromName } from '@carriers/core/catalog/hints';
import { errorType, reportRoutingEvent } from './observability';
import { CarrierError, carrierErrorKind, IndeterminateError, retryAfterMsOf } from '@carriers/core/errors';
import { captureDirectLocalHistory, directHistoryNumber, directLocalHistory, hasUnresolvedDirectCurrent, hasUnresolvedDirectHistory } from './directLocalHistory';
import { latestResultTime } from './eventTime';
import type { Recognition } from '@carriers/core/adapter';
import { MAX_RECOGNITIONS, recognitionCandidates, recognizeAll, settleRecognition } from './carrierRecognition';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// no_history: a universal provider answered for this number without any history.
export type RoutingFailureKind = 'rate_limited' | 'not_found' | 'no_history' | 'verification' | 'schema' | 'transport';
export interface ProviderHealth {
  acquireTrackingProvider(provider: string): Promise<{ token: string | null; retry_at: string }>;
  finishTrackingProvider(provider: string, token: string, kind: Exclude<RoutingFailureKind, 'no_history'> | null, retryAfterMs: number, durationMs: number): Promise<void>;
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
interface Failure { count: number; retry_at: string; kind: RoutingFailureKind; user_error?: string }
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
  /** Per-candidate schedule of the recognitions that ask carriers the number points to. */
  candidate_probes?: Record<string, { count: number; retry_at: string }>;
  /** A carrier that knows the number but cannot track it without the user's input. */
  input_needed?: { carrier: string; field: string };
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
/**
 * An adapter's own inconclusive verdict (17TRACK code 400, ParcelsApp NO_DATA,
 * Postal Ninja's empty lookup) describes the number; an HTTP 5xx describes the provider.
 */
function answeredWithoutHistory(error: unknown): boolean {
  let current = error;
  for (let i = 0; i < 8 && current instanceof Error; i++, current = current.cause) {
    if (current instanceof CarrierError) return current instanceof IndeterminateError;
  }
  return false;
}
/** A parcel carrier's own zone, when its catalog names one. */
function carrierZone(carrier: string): string | null {
  try {
    const zone = carrierTimezone(carrier);
    return zone === 'UTC' ? null : zone;
  } catch { return null; }
}
function usable(value: CarrierResult): boolean {
  return Boolean(value.events?.length || value.status && !['unknown', 'pending'].includes(value.status)
    || value.current_stage && value.current_stage !== 'pending');
}
/** The newest instant of a routed result, read in its source's zone exactly as its events are persisted. */
function latest(value: RoutedResult): number {
  return latestResultTime(value.result, value.sourceCarrierId);
}
// Numbers are reused, and carriers' number spaces overlap (a 12-digit Yamato
// number can be an old FedEx parcel). A universal history that ended a month
// before the parcel was added and names only other catalog carriers is not it.
const FOREIGN_HISTORY_GAP = 30 * DAY;
/** Whether a reported name can mean this carrier: its id, a brand network of it, or a name the catalog doesn't know. */
function mayNameCarrier(name: string, carrier: string): boolean {
  const id = carrierIdFromName(name);
  if (id) return id === carrier;
  const networks = brandCarrierIds(name);
  if (networks.length) return networks.includes(carrier);
  const brand = carrierBrand(carrier);
  if (brand && name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(brand)) return true;
  return !isKnownCarrierName(name);
}
function foreignHistory(result: CarrierResult, carrier: string, addedAt: unknown): boolean {
  if (carrier === 'unknown' || carrier === 'intl-post' || typeof addedAt !== 'string') return false;
  const names = Array.isArray(result.reported_carriers)
    ? result.reported_carriers.filter((name): name is string => typeof name === 'string') : [];
  if (!names.length || names.some((name) => mayNameCarrier(name, carrier))) return false;
  const newest = latestResultTime(result, 'unknown');
  return newest > 0 && newest < millis(addedAt) - FOREIGN_HISTORY_GAP;
}
function directCarrier(carrier: string): boolean {
  return AUTOMATIC_CARRIER_IDS.has(carrier) && carrierAdapter(carrier) !== 'universal';
}

const CANDIDATE_PROBE_WINDOW = 30 * DAY;
/** Every recognition answer a sync waits for; later answers are ignored. */
const RECOGNITION_BUDGET_MS = 15_000;

export class RoutingDeferred extends Error {
  /** `attempted` counts providers actually contacted; zero means every tier was still cooling down. */
  constructor(readonly routing: RoutingState, readonly stale: boolean, readonly attempted = 0) {
    super(stale ? 'Tracking providers are temporarily unavailable. Previous progress has been kept; another check is scheduled.'
      : 'Recent tracking has been kept while the provider cools down.');
    // Ends in "Error" so the audit trail records it instead of a bare "Error".
    this.name = 'RoutingDeferredError';
  }
}

/** Per-parcel affinity lives in carrier_data; provider protection is shared in Postgres. */
export class TrackingRouter {
  constructor(readonly options: {
    direct: (parcel: JsonObject, carrier: string) => Promise<RoutedResult>;
    // postcode is the parcel's stored delivery postcode, if the user supplied
    // one; providers receive it in their track input but submit it nowhere yet.
    // timezone is the parcel carrier's catalog zone; when that is UTC, the zone
    // of the carrier confirmed for the same number, else null.
    universal: (source: UniversalSource, number: string, timeoutMs: number, postcode: string | null, timezone: string | null) => Promise<CarrierResult>;
    health: ProviderHealth;
    /** A carrier's cheap check of whether it knows a number; without it, no recognition runs. */
    recognize?: (carrier: string, number: string) => Promise<Recognition>;
    now?: () => Date;
    enablePostalNinja?: boolean;
  }) {}

  async fetch(parcel: JsonObject, scheduled: boolean, signal?: AbortSignal): Promise<RoutedResult> {
    const now = () => this.options.now?.() ?? new Date();
    const state = routingState(parcel);
    const declared = String(parcel.carrier);
    const number = String(parcel.tracking_number ?? '');
    const metadata = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
    let localDirectFallback: { value: RoutedResult; carrier: string } | undefined;
    let localHistory: JsonObject | undefined;
    const universalNumber = metadata.original_carrier && metadata.active_tracking_carrier
      && typeof metadata.active_tracking_number === 'string' ? metadata.active_tracking_number : number;
    if (state.preferred_number && state.preferred_number !== universalNumber) state.preferred_provider = undefined;
    // The delivery leg's own carrier when its number is the one looked up.
    const universalCarrier = universalNumber !== number && typeof metadata.active_tracking_carrier === 'string'
      ? metadata.active_tracking_carrier : declared;
    // Ordered by that carrier's coverage evidence, else by the carrier confirmed
    // or discovered for the number, else the default order.
    const plan = universalPlan({
      carriers: [universalCarrier, state.confirmed_number === universalNumber ? state.confirmed_carrier : undefined, state.discovered_carrier],
      trackingNumber: universalNumber, enablePostalNinja: this.options.enablePostalNinja,
    });
    const sources = plan.sources;
    // Sparse postal fallback must never become sticky, including saved state.
    if (state.preferred_provider === 'UPU') state.preferred_provider = undefined;
    const recent = () => millis(state.last_success_at) > 0 && now().getTime() - millis(state.last_success_at) < freshnessWindow(now());
    const report = (code: string, provider: string, kind?: string, error?: unknown) => reportRoutingEvent(code, {
      carrier: declared, provider, category: kind, trackingNumber: number,
      ...(error ? { errorClass: errorType(error), error } : {}),
    });
    const fail = (provider: string, error: unknown, universalSource = false): Failure => {
      const classified = routingFailure(error);
      const kind = universalSource && classified.kind === 'transport' && answeredWithoutHistory(error)
        ? 'no_history' : classified.kind;
      const { retryAfterMs } = classified;
      const count = Math.min(20, (state.failures[provider]?.count ?? 0) + 1);
      // A provider's "not found" holds for a day. A carrier often doesn't know a
      // label before its first scan, so its own "not found" is asked again within hours.
      const daily = kind === 'not_found' && universalSource;
      const base = daily ? DAY : kind === 'verification' || kind === 'schema' || kind === 'not_found' ? HOUR : 15 * 60_000;
      const userError = trackingFailureCode(error);
      const failure = { count, kind, ...(userError ? { user_error: userError } : {}), retry_at: iso(now().getTime() + Math.max(retryAfterMs, Math.min(daily ? DAY : 6 * HOUR, base * 2 ** (count - 1)))) };
      state.failures[provider] = failure;
      // Called before another provider is attempted, including recovered failures.
      report('provider_failed', provider, kind, error);
      return failure;
    };
    const persistResult = (value: RoutedResult, provider: string): RoutedResult => {
      if (state.failures[provider]) report('provider_recovered', provider);
      delete state.failures[provider];
      // A carrier tracks the parcel directly: nothing is left to ask the user.
      if (directCarrier(provider)) delete state.input_needed;
      state.last_success_at = now().toISOString();
      // A future-dated scan must not make every later real update look older.
      const eventTime = Math.min(now().getTime(), Math.max(latest(value),
        value.earlierResult ? latestResultTime(value.earlierResult, value.earlierCarrierId ?? value.sourceCarrierId) : 0));
      state.last_event_at = eventTime && value.result.direct_local_fallback !== true ? iso(eventTime) : state.last_event_at;
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
        ...(localHistory ? { direct_local_history: localHistory } : {}),
        ...(directCarrier(provider) ? { active_tracking_carrier: value.sourceCarrierId } : {}),
        ...(swap ? { auto_changed_from: declared, auto_changed_to: provider, auto_changed_at: now().toISOString() } : {}),
      } };
    };
    const attemptedDirect = new Set<string>();
    let attempts = 0;
    // Probes are this parcel's own guesses: they are no evidence of provider health.
    let probeContacts = 0;
    const attempted = () => attemptedDirect.size - probeContacts + attempts;
    const tryDirect = async (carrier: string, candidate = false, terminalStage?: string, probe = false): Promise<RoutedResult | null> => {
      signal?.throwIfAborted();
      if (!directCarrier(carrier) || attemptedDirect.has(carrier)) return null;
      // Never borrow a postcode/capability from another carrier or guess missing
      // input. An optional input (DPD's postcode) only adds detail, so a
      // candidate that needs nothing else is looked up without it.
      const ownInputs = state.confirmed_carrier === carrier && state.confirmed_number === number;
      if (candidate && !ownInputs && requiredRequirements(carrier, number).length) {
        report('carrier_input_required', carrier); return null;
      }
      if (millis(state.failures[carrier]?.retry_at) > now().getTime()) return null;
      attemptedDirect.add(carrier);
      try {
        const lookupParcel = candidate ? { ...parcel, carrier,
          tracking_url: ownInputs ? state.confirmed_tracking_url : null,
          dpd_postcode: ownInputs ? state.confirmed_postcode : null,
          carrier_data: {} } : parcel;
        const value = await this.options.direct(lookupParcel, carrier);
        value.result = normalizeCarrierResult(value.result);
        if (!usable(value.result)) throw Object.assign(new Error('No confirmed shipment progress'), { status: 404 });
        // An empty summary archive binds the fallback to this parcel without
        // creating a scan; earlier real scans survive when it is merged.
        const capturedHistory = hasUnresolvedDirectHistory(value.sourceCarrierId, value.result)
          || (value.result.summary_only === true && hasUnresolvedDirectCurrent(value.sourceCarrierId, value.result))
          ? captureDirectLocalHistory(value.sourceCarrierId, String(directHistoryNumber(lookupParcel, value.result)), value.result)
          : undefined;
        if (hasUnresolvedDirectCurrent(value.sourceCarrierId, value.result)) {
          // Preserve the direct evidence, but let timestamped or richer
          // providers supply the normal timeline and freshness watermark.
          // A discovered candidate with no instants cannot displace a source
          // whose dated progress already established the carrier.
          if (!candidate) {
            localDirectFallback = { value, carrier };
            localHistory = capturedHistory;
          } else if (!localHistory && !directLocalHistory(parcel, {})) {
            // An unconfirmed candidate may add evidence for an unknown parcel,
            // but cannot replace history from the parcel's own carrier.
            localHistory = capturedHistory;
          }
          return null;
        }
        // A probe needs movement: a pre-advice ("Order created") proves the
        // label, not that this carrier has the parcel yet.
        const notYet = probe ? ['pending', 'unknown', 'registered'] : ['pending', 'unknown'];
        if (candidate && ![value.result.status, value.result.current_stage, ...(value.result.events ?? []).map((event) => event.stage)]
          .some((stage) => stage && !notYet.includes(stage))) return null;
        if (candidate && latest(value) < millis(state.last_event_at)) return null;
        if (terminalStage && ['delivered', 'returned'].includes(terminalStage)
          && value.result.current_stage !== terminalStage) return null;
        if (capturedHistory) localHistory = capturedHistory;
        // A probe finding the carrier its number points to is the expected
        // outcome, not a detection gap: log it without raising an alert.
        if (carrier !== declared && state.confirmed_carrier !== carrier) {
          report(probe ? 'candidate_probe_confirmed' : 'carrier_mismatch_confirmed', carrier);
        }
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
          throw new RoutingDeferred(state, false, attempted());
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

    // The filed carrier cannot track this number: it has no adapter of its own
    // (unknown, a universal-only carrier) or its adapter does not know the
    // number (a forwarder such as Asendia, a wrong label). A transient failure
    // is not that. Before the universals, ask the carriers the number could
    // belong to whether they know it, never another network of the filed
    // carrier's own brand, for open parcels in their first month.
    const filedCannotTrack = !directCarrier(primary) || state.failures[primary]?.kind === 'not_found';
    const open = !['delivered', 'returned'].includes(String(parcel.current_stage));
    const young = typeof parcel.created_at !== 'string' || now().getTime() - millis(parcel.created_at) < CANDIDATE_PROBE_WINDOW;
    const recognize = this.options.recognize;
    if (recognize && filedCannotTrack && open && young && universalNumber === number && !metadata.original_carrier) {
      const brand = carrierBrand(primary) ?? carrierBrand(declared);
      const due = recognitionCandidates(number, {
        hint: state.discovered_carrier,
        skip: (candidate) => candidate === primary || candidate === declared
          || Boolean(brand && carrierBrand(candidate) === brand) || attemptedDirect.has(candidate)
          || millis(state.candidate_probes?.[candidate]?.retry_at) > now().getTime()
          || millis(state.failures[candidate]?.retry_at) > now().getTime(),
      }).slice(0, MAX_RECOGNITIONS);
      const outcomes = due.length ? await recognizeAll(due, (candidate) => recognize(candidate, number), RECOGNITION_BUDGET_MS) : [];
      signal?.throwIfAborted();
      // A carrier that knows the number and needs no input gets a full
      // lookup, adopted only on real progress (a pre-advice is not enough).
      for (const outcome of outcomes) {
        if (outcome.status !== 'known' || outcome.needsInput) continue;
        const failure = state.failures[outcome.carrier];
        const retry = state.direct_retry_at;
        const value = await tryDirect(outcome.carrier, true, undefined, true).catch((error: unknown) => {
          if (!(error instanceof RoutingDeferred)) throw error;
          return null;
        });
        if (attemptedDirect.has(outcome.carrier)) probeContacts++;
        if (value) {
          if (state.candidate_probes) delete state.candidate_probes[outcome.carrier];
          return persistResult(value, outcome.carrier);
        }
        // Not adopted: the parcel's own schedule, not the carrier's failure.
        if (failure) state.failures[outcome.carrier] = failure;
        else delete state.failures[outcome.carrier];
        state.direct_retry_at = retry;
      }
      // A carrier that knows the number but needs the user's input (GLS's
      // postcode) is offered to the user instead.
      const needing = settleRecognition(outcomes.filter((outcome) => outcome.needsInput), now()).carrier;
      const field = outcomes.find((outcome) => outcome.carrier === needing)?.needsInput;
      if (needing && field) {
        if (state.input_needed?.carrier !== needing) report('carrier_input_needed', needing);
        state.input_needed = { carrier: needing, field };
      } else if (outcomes.some((outcome) => outcome.carrier === state.input_needed?.carrier && outcome.status !== 'failed')) {
        // Asked again, it no longer knows the number (or only an old parcel with it).
        delete state.input_needed;
      }
      // Nothing adopted: ask again after 1, 2, 4, then 6 hours, since a parcel
      // shows up once it is handed over, and daily after six misses. These
      // answers decide neither the parcel's status nor the filed carrier's retry.
      for (const outcome of outcomes) {
        const count = Math.min(20, (state.candidate_probes?.[outcome.carrier]?.count ?? 0) + 1);
        state.candidate_probes = { ...state.candidate_probes, [outcome.carrier]: {
          count, retry_at: iso(now().getTime() + Math.min(count > 6 ? DAY : 6 * HOUR, HOUR * 2 ** (count - 1))),
        } };
      }
    }

    const richerSources = sources.filter((source) => source !== 'UPU');
    const preferred = richerSources.includes(state.preferred_provider!) ? state.preferred_provider : undefined;
    // A cheaper fallback must not stay pinned after the richer route recovers.
    const priority = priorityUniversalSource(universalNumber);
    // Providers with fuller history for this carrier come before the one the parcel stays with.
    const fuller = preferred ? richerSources.filter((source) => plan.rank(source) < plan.rank(preferred)) : [];
    const offset = state.discovery_cursor % richerSources.length;
    const ordered = [...new Set<UniversalSource>([...(priority ? [priority] : []), ...fuller, ...(preferred ? [preferred] : []), ...richerSources.slice(offset), ...richerSources.slice(0, offset),
      ...sources.filter((source) => source === 'UPU')])];
    // Reserve each source’s lookup budget plus transport allowance (UPU needs only 8s).
    // Start after direct attempts so a slow carrier cannot starve discovery.
    const universalDeadline = performance.now() + sources.reduce((sum, source) => sum + universalSourceBudget(source) + 5_000, 0);
    // A label without a local clock (asendia, unknown) defers to the carrier a
    // direct lookup confirmed for this same number.
    const zone = carrierZone(universalCarrier)
      ?? (state.confirmed_carrier && state.confirmed_number === universalNumber ? carrierZone(state.confirmed_carrier) : null);
    const attemptedUniversal = new Set<UniversalSource>();
    // Providers that answered without history for this number in this check.
    const answeredEmpty: UniversalSource[] = [];
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
        const postcode = typeof parcel.dpd_postcode === 'string' ? parcel.dpd_postcode : null;
        const result = normalizeCarrierResult(await this.options.universal(source, universalNumber, Math.min(universalSourceBudget(source), remaining - 5_000), postcode, zone));
        if (!usable(result)) throw new TypeError('No usable universal progress');
        if (foreignHistory(result, universalCarrier, parcel.created_at)) {
          report('foreign_history_rejected', source);
          throw new IndeterminateError(source, `${source} returned an older parcel of another carrier for this number`);
        }
        const previousFailure = state.failures[source];
        if (previousFailure) report('provider_recovered', source);
        delete state.failures[source];
        return { result: { ...result, tracking_provider: source }, sourceCarrierId: 'unknown', swissPostReady: null, handoffFallbackErrorType: null };
      } catch (error) {
        const failure = fail(source, error, true);
        kind = failure.kind;
        if (kind === 'not_found' || kind === 'no_history') answeredEmpty.push(source);
        retryAfterMs = millis(failure.retry_at) - now().getTime();
        if (kind === 'rate_limited' && recent() && !localDirectFallback) {
          state.next_check_at = iso(Math.min(millis(failure.retry_at), millis(state.last_success_at) + freshnessWindow(now())));
          throw new RoutingDeferred(state, false, attempted());
        }
        return null;
      } finally {
        // An answer about this number keeps the provider's circuit closed, like not-found.
        try { await this.options.health.finishTrackingProvider(source, lease.token, kind === 'no_history' ? 'not_found' : kind, retryAfterMs, performance.now() - before); }
        catch { report('health_store_unavailable', source, 'transport'); }
      }
    };

    for (const source of ordered) {
      let value = await universal(source);
      if (!value) continue;
      let chosen = source;
      // Scheduled-only shadow check. Keep affinity unless the alternative has
      // strictly newer progress; never merge contradictory provider summaries.
      if (scheduled && source !== priority && preferred === source && now().getTime() - millis(state.last_probe_at) >= DAY && attempts < 2) {
        // Only providers with at least as full a history for the carrier are worth the comparison.
        const alternatives = richerSources.filter((item) => item !== source && plan.rank(item) <= plan.rank(source));
        const alternative = alternatives[state.probe_cursor % alternatives.length];
        state.probe_cursor++;
        state.last_probe_at = now().toISOString();
        const probe = alternative ? await universal(alternative).catch((error: unknown) => {
          if (!(error instanceof RoutingDeferred)) throw error;
          return null;
        }) : null;
        if (probe && latest(probe) > latest(value) && latest(probe) >= millis(state.last_event_at)
          && !['delivered', 'returned'].includes(String(value.result.current_stage))) {
          value = probe; chosen = alternative;
          report('fresher_provider_found', chosen);
        }
      }
      if (preferred !== chosen) report('provider_selected', chosen);
      // Evidence to refresh the coverage comparison: a provider it found empty for
      // the carrier has this parcel, or one it found with history does not.
      // UPU is ordered by its role, not by evidence.
      if (plan.carrier) {
        if (chosen !== 'UPU' && plan.tier(chosen) === 'empty') report('coverage_contradicted', chosen, 'history');
        for (const source of answeredEmpty) {
          if (source !== 'UPU' && ['full', 'partial'].includes(plan.tier(source))) report('coverage_contradicted', source, 'no_history');
        }
      }
      if (!directCarrier(declared) && declared !== 'unknown' && declared !== 'intl-post' && !preferred) report('direct_support_opportunity', declared);
      state.preferred_provider = chosen === 'UPU' ? preferred : chosen;
      state.preferred_number = state.preferred_provider ? universalNumber : undefined;
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
        // Progress the parcel hasn't had yet: a carrier that said "not found"
        // may know the parcel now, so it is asked without waiting its turn.
        const missed = state.failures[state.discovered_carrier];
        if (missed?.kind === 'not_found' && !attemptedDirect.has(state.discovered_carrier) && latest(value) > millis(watermark)) {
          missed.retry_at = now().toISOString();
        }
        state.last_event_at = iso(Math.max(millis(watermark), latest(value)));
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
          // A catalog carrier is no discovery, even as one leg of a handoff or with a country.
          if (typeof name === 'string' && !value.result.discovered_carrier && !seen.includes(name)
            && !isKnownCarrierName(name)) report('carrier_coverage_discovered', name);
        }
        state.reported_carriers_seen = [...new Set([...seen, ...value.result.reported_carriers])].slice(-20);
      }
      // The carrier's own answer had no current instant, so this provider dates the
      // timeline: ask the carrier again in 6 h. A retry time left over from an
      // earlier failure has expired and would otherwise keep it due on every check.
      if (localDirectFallback || !state.direct_retry_at) state.direct_retry_at = iso(now().getTime() + 6 * HOUR);
      state.last_probe_at ??= now().toISOString();
      state.discovery_cursor = 0;
      // The carrier answered too: only its clock sent the result elsewhere, so links stay with it.
      if (localDirectFallback) value.result = { ...value.result, carrier_answered: true };
      return persistResult(value, chosen);
    }
    if (localDirectFallback) {
      const { value, carrier } = localDirectFallback;
      value.result = { ...value.result, direct_local_fallback: true };
      return persistResult(value, carrier);
    }
    state.discovery_cursor = (offset + Math.max(1, [...attemptedUniversal].filter((source) => source !== 'UPU').length)) % richerSources.length;
    const deadlines = Object.values(state.failures).map((failure) => millis(failure.retry_at)).filter((time) => time > now().getTime());
    state.next_check_at = iso(Math.max(now().getTime() + 15 * 60_000, Math.min(...deadlines, now().getTime() + HOUR)));
    report('all_providers_unavailable', preferred ?? 'none');
    throw new RoutingDeferred(state, !recent(), attempted());
  }
}
