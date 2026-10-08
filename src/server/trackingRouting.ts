import 'server-only';
import { setTimeout as sleep } from 'node:timers/promises';
import { trackingFailureCode } from './trackingFailure';

import { DateTime } from 'luxon';
import { appInputField, detectCarrierMatch } from '../lib/carriers';
import { AUTOMATIC_CARRIER_IDS, carrierAdapter, carrierTimezone, requiredRequirements } from './carriers';
import { checksumRejections, inferStage, normalizeCarrierResult, resultStage, STAGES, type CarrierResult } from 'universal-parcel-scraper';
import { isRecord, type JsonObject } from './types';
import { priorityUniversalSource, universalPlan, universalSourceBudget } from 'universal-parcel-scraper';
import type { UniversalSource } from 'universal-parcel-scraper';
import { isCarrierFeedName, isKnownCarrierName } from 'universal-parcel-scraper/app';
import { brandCarrierIds, carrierBrand, carrierIdFromName } from 'universal-parcel-scraper/app';
import { errorType, reportRoutingEvent } from './observability';
import { recordChecksumRejection, recordProviderInput } from './metrics';
import { CarrierError, carrierErrorKind, IndeterminateError, retryAfterMsOf } from 'universal-parcel-scraper';
import { captureDirectLocalHistory, directHistoryNumber, directLocalHistory, hasUnresolvedDirectCurrent, hasUnresolvedDirectHistory } from './directLocalHistory';
import { latestResultTime } from 'universal-parcel-scraper/app';
import type { Recognition, TrackingContext } from 'universal-parcel-scraper/node';
import { MAX_RECOGNITIONS, recognitionCandidates, recognizeAll, settleRecognition } from 'universal-parcel-scraper';
import { BROWSER_RECOGNITION_BUDGET_MS, MAX_BROWSER_RECOGNITIONS } from './browserRecognition';
import { providerCarrier } from './providerCarrier';
import { normalizedLookupCountry } from './lookupCountry';
import { getRecognitionPriorities } from './recognitionRanking';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// no_history: a universal provider answered for this number without any history.
export type RoutingFailureKind = 'rate_limited' | 'not_found' | 'no_history' | 'input_required' | 'verification' | 'schema' | 'transport';
export interface ProviderHealth {
  acquireTrackingProvider(provider: string): Promise<{ token: string | null; retry_at: string }>;
  finishTrackingProvider(provider: string, token: string, kind: Exclude<RoutingFailureKind, 'no_history' | 'input_required'> | null, retryAfterMs: number, durationMs: number): Promise<void>;
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
  consecutive_failures: number;
  last_event_at?: string;
  next_check_at?: string;
  direct_retry_at?: string;
  last_probe_at?: string;
  /** Per-candidate schedule of the recognitions that ask carriers the number points to. */
  candidate_probes?: Record<string, { count: number; retry_at: string }>;
  /** A carrier that knows the number but cannot track it without the user's input. */
  input_needed?: { carrier: string; field: string };
  provider_input_needed?: { provider: string; field: 'dpdPostcode' };
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
    consecutive_failures: !changed && Number.isSafeInteger(state.consecutive_failures) && state.consecutive_failures! > 0
      ? Math.min(20, state.consecutive_failures!) : 0,
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
    if (kind === 'input_required') return { kind: 'input_required', retryAfterMs: 0 };
    // A number the carrier does not issue waits as a missing input does: no sooner retry can succeed.
    if (kind === 'schema' || kind === 'invalid_input') return { kind: 'schema', retryAfterMs: 0 };
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
const PROGRESS_STAGES = new Set<string>(STAGES.filter((stage) => !['pending', 'registered'].includes(stage)));
/** Movement worth retaining a provider for; registration alone only establishes the label. */
export function hasRoutingProgress(result: CarrierResult): boolean {
  return PROGRESS_STAGES.has(resultStage(result) ?? '') || (result.events ?? []).some((event) =>
    PROGRESS_STAGES.has(event.stage ?? '') || PROGRESS_STAGES.has(inferStage(event.description ?? '', 'pending')));
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
/** Whether a carrier has an adapter of its own for the router to ask. */
export function directCarrier(carrier: string): boolean {
  return AUTOMATIC_CARRIER_IDS.has(carrier) && carrierAdapter(carrier) !== 'universal';
}
/**
 * Whether detection alone names this carrier for the number. Correcting a
 * parcel to it, such as one filed before the rule existed, is the designed
 * outcome and shows no gap in the detection rules.
 */
export function detectionNames(number: string, carrier: string): boolean {
  const detected = detectCarrierMatch(number);
  return detected.confidence === 'high' && detected.carrier === carrier;
}

const CANDIDATE_PROBE_WINDOW = 30 * DAY;
/** Every recognition answer a sync waits for; later answers are ignored. */
const RECOGNITION_BUDGET_MS = 15_000;
/**
 * A provider busy for no longer than this is only spaced after another check
 * (5 s after a healthy call): it is waited for, at most twice per provider.
 */
const PACING_WAIT_MS = 6_000;
const PACING_ROUNDS = 2;

export class RoutingDeferred extends Error {
  /** `attempted` counts providers actually contacted; zero means every tier was still cooling down. */
  constructor(readonly routing: RoutingState, readonly stale: boolean, readonly attempted = 0) {
    super(stale ? 'Tracking providers are temporarily unavailable. Previous progress has been kept; another check is scheduled.'
      : 'Previous tracking has been kept; another check is scheduled.');
    // Ends in "Error" so the audit trail records it instead of a bare "Error".
    this.name = 'RoutingDeferredError';
  }
}

/** Per-parcel affinity lives in carrier_data; provider protection is shared in Postgres. */
export class TrackingRouter {
  constructor(readonly options: {
    direct: (parcel: JsonObject, carrier: string) => Promise<RoutedResult>;
    // postcode is the parcel's stored delivery postcode, if the user supplied
    // one; ParcelsApp submits it with its direct lookup.
    // timezone is the parcel carrier's catalog zone; when that is UTC, the zone
    // of the carrier confirmed for the same number, else null.
    universal: (source: UniversalSource, number: string, timeoutMs: number, postcode: string | null, timezone: string | null) => Promise<CarrierResult>;
    health: ProviderHealth;
    preflightInputNeeded?: (number: string) => { provider: string; field: 'dpdPostcode' } | undefined;
    takePrefetchedUniversal?: (source: UniversalSource, number: string, postcode: string | null) => CarrierResult | undefined;
    /**
     * The answer another check of the same run already got, or awaits, for
     * exactly this lookup. Reusing it contacts nobody, so it takes no lease.
     */
    reusedUniversal?: (source: UniversalSource, number: string, postcode: string | null, timezone: string | null) => Promise<CarrierResult> | undefined;
    /** A carrier's cheap check of whether it knows a number; without it, no recognition runs. */
    recognize?: (carrier: string, number: string, context?: TrackingContext) => Promise<Recognition>;
    recognizeBrowser?: (carrier: string, number: string, context?: TrackingContext, previousError?: unknown) => Promise<Recognition>;
    now?: () => Date;
    /** Waits out a provider's spacing; tests replace the timer. */
    wait?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
    enablePostalNinja?: boolean;
  }) {}

  async fetch(parcel: JsonObject, scheduled: boolean, signal?: AbortSignal, addition = false): Promise<RoutedResult> {
    const now = () => this.options.now?.() ?? new Date();
    const state = routingState(parcel);
    const previousFailures = state.consecutive_failures;
    const declared = String(parcel.carrier);
    const number = String(parcel.tracking_number ?? '');
    const metadata = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
    const countryHint = normalizedLookupCountry(metadata.lookup_country_hint);
    let localDirectFallback: { value: RoutedResult; carrier: string } | undefined;
    let localHistory: JsonObject | undefined;
    const universalNumber = metadata.original_carrier && metadata.active_tracking_carrier
      && typeof metadata.active_tracking_number === 'string' ? metadata.active_tracking_number : number;
    // The owner's answer to a provider's postcode request, for this number only.
    const providerInput = isRecord(metadata.universal_input) && metadata.universal_input.number === universalNumber
      && typeof metadata.universal_input.postcode === 'string' ? metadata.universal_input.postcode : null;
    if (!metadata.universal_input && !state.provider_input_needed) {
      state.provider_input_needed = this.options.preflightInputNeeded?.(universalNumber);
      if (state.provider_input_needed) recordProviderInput(state.provider_input_needed.provider, 'asked');
    }
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
    const prefetchedUniversal = new Map<UniversalSource, CarrierResult>();
    // Show an Add preflight's history immediately; speculative confirmation can wait for the next check.
    if (declared === 'unknown' && !state.confirmed_carrier && !metadata.original_carrier
      && !parcel.dpd_postcode && !metadata.universal_input && String(parcel.current_stage ?? 'pending') === 'pending') {
      for (const source of sources) {
        const result = this.options.takePrefetchedUniversal?.(source, universalNumber, null);
        if (result && usable(result)) { prefetchedUniversal.set(source, result); break; }
      }
    }
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
      if (universalSource && kind === 'input_required') {
        // Counted when a parcel starts asking; a supplied postcode that is refused counts as still_required.
        if (!state.provider_input_needed && !providerInput) recordProviderInput(provider, 'asked');
        state.provider_input_needed = { provider, field: 'dpdPostcode' };
      }
      // Called before another provider is attempted, including recovered failures.
      report(kind === 'input_required' ? 'carrier_input_required' : 'provider_failed', provider, kind, error);
      return failure;
    };
    const persistResult = (value: RoutedResult, provider: string, withoutProgress = false): RoutedResult => {
      if (state.failures[provider]) report('provider_recovered', provider);
      delete state.failures[provider];
      // A carrier tracks the parcel directly: nothing is left to ask the user.
      if (directCarrier(provider)) delete state.input_needed;
      if (!withoutProgress) delete state.provider_input_needed;
      if (!withoutProgress) state.last_success_at = now().toISOString();
      // A thin answer cannot reset a universal-only parcel's missed-check
      // streak. Count this check once even if a later rate limit deferred it.
      state.consecutive_failures = withoutProgress && !directCarrier(declared)
        ? Math.min(20, previousFailures + 1) : 0;
      // A future-dated scan must not make every later real update look older.
      const eventTime = Math.min(now().getTime(), Math.max(latest(value),
        value.earlierResult ? latestResultTime(value.earlierResult, value.earlierCarrierId ?? value.sourceCarrierId) : 0));
      state.last_event_at = eventTime && !withoutProgress && value.result.direct_local_fallback !== true ? iso(eventTime) : state.last_event_at;
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
      // A provider can name an unknown parcel without pretending the carrier answered.
      const identified = declared === 'unknown' && !withoutProgress && !state.confirmed_carrier
        && !metadata.original_carrier && universalNumber === number && sources.includes(provider as UniversalSource)
        ? providerCarrier(value.result, number) : undefined;
      if (identified) {
        state.configured_carrier = identified;
        value.correction = { carrier: identified, trackingUrl: null, postcode: null };
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
    const defer = (stale = !recent()): never => {
      const contacts = attempted();
      // A cooldown-only check supplies no new evidence of failure.
      if (contacts > 0) state.consecutive_failures = Math.min(20, state.consecutive_failures + 1);
      throw new RoutingDeferred(state, stale && state.consecutive_failures >= 2, contacts);
    };
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
        // outcome, not a detection gap: log it without raising an alert. The
        // same holds when detection already names the confirming carrier.
        if (carrier !== declared && state.confirmed_carrier !== carrier) {
          report(probe ? 'candidate_probe_confirmed'
            : detectionNames(number, carrier) ? 'detected_carrier_confirmed' : 'carrier_mismatch_confirmed', carrier);
        }
        // The carrier's own answer for this very number, the first time: count
        // the rules whose failed check digit kept it out of detection's
        // suggestions. The carrier and rule ids are recorded, never the number.
        if (value.sourceCarrierId === carrier && !metadata.original_carrier
          && (state.confirmed_carrier !== carrier || state.confirmed_number !== number)) {
          for (const rejection of checksumRejections(number)) {
            if (rejection.carrier === carrier) recordChecksumRejection(carrier, rejection.rule);
          }
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
        // The carrier does not issue this number (a failed check digit): a
        // provider's name for it, saved by an older check, stops being asked.
        if (carrierErrorKind(error) === 'invalid_input' && state.discovered_carrier === carrier) delete state.discovered_carrier;
        state.direct_retry_at = failure.retry_at;
        if (failure.kind === 'rate_limited' && recent()) {
          state.next_check_at = iso(Math.min(millis(failure.retry_at), millis(state.last_success_at) + freshnessWindow(now())));
          report('fallback_deferred_fresh', carrier, failure.kind);
          defer(false);
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
    // number (a forwarder such as Asendia, a wrong label). A low-confidence
    // shape that excludes the filed carrier also permits verified recognition,
    // even when that carrier returned a transport error. A transient failure
    // for a matching shape is not that, nor is a not-found for a number the
    // carrier already confirmed. Before the universals, ask the carriers the number could
    // belong to whether they know it, never another network of the filed
    // carrier's own brand, for open parcels in their first month.
    const confirmed = state.confirmed_carrier === primary && state.confirmed_number === number;
    const differentShape = detected.confidence === 'low' && !detected.candidates.includes(primary as never);
    const filedCannotTrack = !confirmed && (!directCarrier(primary)
      || state.failures[primary]?.kind === 'not_found' || differentShape);
    const open = !['delivered', 'returned'].includes(String(parcel.current_stage));
    const young = typeof parcel.created_at !== 'string' || now().getTime() - millis(parcel.created_at) < CANDIDATE_PROBE_WINDOW;
    const recognize = this.options.recognize;
    if (!prefetchedUniversal.size && (recognize || this.options.recognizeBrowser) && filedCannotTrack && open && young && universalNumber === number && !metadata.original_carrier) {
      const brand = carrierBrand(primary) ?? carrierBrand(declared);
      const skip = (candidate: string) => candidate === primary || candidate === declared
          || Boolean(brand && carrierBrand(candidate) === brand) || attemptedDirect.has(candidate)
          || millis(state.candidate_probes?.[candidate]?.retry_at) > now().getTime()
          || millis(state.failures[candidate]?.retry_at) > now().getTime();
      const ordering = { hint: state.discovered_carrier, countryHint, priorities: getRecognitionPriorities(number), skip };
      const eligible = recognize ? recognitionCandidates(number, ordering) : [];
      const due = eligible.slice(0, MAX_RECOGNITIONS);
      const next = addition ? eligible.slice(MAX_RECOGNITIONS, 2 * MAX_RECOGNITIONS) : [];
      const recognitionDeadline = performance.now() + RECOGNITION_BUDGET_MS;
      const errors = new Map<string, unknown>();
      const ask = async (candidate: string, context: TrackingContext) => {
        try { return await recognize!(candidate, number, context); }
        catch (error) { errors.set(candidate, error); throw error; }
      };
      const outcomes = due.length ? await recognizeAll(due, ask,
        next.length ? Math.floor(RECOGNITION_BUDGET_MS / 2) : RECOGNITION_BUDGET_MS, signal) : [];
      const first = settleRecognition(outcomes, now());
      const remaining = Math.floor(recognitionDeadline - performance.now());
      if (next.length && !first.carrier && !first.choices.length && remaining > 0) {
        outcomes.push(...await recognizeAll(next, ask, remaining, signal));
      }
      const cheap = settleRecognition(outcomes, now());
      if (this.options.recognizeBrowser && !cheap.carrier && !cheap.choices.length) {
        const browserDue = recognitionCandidates(number, { ...ordering, phase: 'browser',
          skip: (candidate) => skip(candidate) || outcomes.some((outcome) => outcome.carrier === candidate && outcome.status !== 'failed'),
        }).slice(0, MAX_BROWSER_RECOGNITIONS);
        outcomes.push(...await recognizeAll(browserDue, (candidate, context) => this.options.recognizeBrowser!(candidate, number, context, errors.get(candidate)),
          BROWSER_RECOGNITION_BUDGET_MS, signal));
      }
      signal?.throwIfAborted();
      // A carrier that knows the number and needs no input gets a full
      // lookup, adopted only on real progress (a pre-advice is not enough).
      for (const outcome of outcomes) {
        if (outcome.needsInput || settleRecognition([outcome], now()).carrier !== outcome.carrier) continue;
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
        state.input_needed = { carrier: needing, field: appInputField(field) };
      } else if (outcomes.some((outcome) => outcome.carrier === state.input_needed?.carrier && outcome.status !== 'failed')) {
        // Asked again, it no longer knows the number (or only an old parcel with it).
        delete state.input_needed;
      }
      // Nothing adopted: ask again after 1, 2, 4, then 6 hours, since a parcel
      // shows up once it is handed over, and daily after six misses. These
      // answers decide neither the parcel's status nor the filed carrier's retry.
      for (const carrier of new Set(outcomes.map((outcome) => outcome.carrier))) {
        const count = Math.min(20, (state.candidate_probes?.[carrier]?.count ?? 0) + 1);
        state.candidate_probes = { ...state.candidate_probes, [carrier]: {
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
    // The discovery cursor rotates which aggregator a check starts with.
    // Postal Ninja and UPU keep their place after the others.
    const rotation: UniversalSource[] = richerSources.filter((source) => source !== 'Postal Ninja');
    const offset = state.discovery_cursor % Math.max(1, rotation.length);
    const ordered = [...new Set<UniversalSource>([...(priority ? [priority] : []), ...fuller, ...(preferred ? [preferred] : []), ...rotation.slice(offset), ...rotation.slice(0, offset),
      ...sources])];
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
      const postcode = providerInput ?? (typeof parcel.dpd_postcode === 'string' ? parcel.dpd_postcode : null);
      const prefetched = prefetchedUniversal.get(source) ?? this.options.takePrefetchedUniversal?.(source, universalNumber, postcode);
      if (prefetched) {
        const result = normalizeCarrierResult(prefetched);
        if (usable(result) && !foreignHistory(result, universalCarrier, parcel.created_at)) {
          delete state.failures[source];
          return { result: { ...result, tracking_provider: source }, sourceCarrierId: 'unknown', swissPostReady: null, handoffFallbackErrorType: null };
        }
      }
      const reused = this.options.reusedUniversal?.(source, universalNumber, postcode, zone);
      const acquire = async () => {
        try { return await this.options.health.acquireTrackingProvider(source); }
        catch {
          report('health_store_unavailable', source, 'transport');
          state.failures[source] = { count: 0, kind: 'transport', retry_at: iso(now().getTime() + 15 * 60_000) };
          return null;
        }
      };
      let token: string | null = null;
      if (!reused) {
        let lease = await acquire();
        for (let round = 0; lease && !lease.token && round < PACING_ROUNDS; round++) {
          // Spacing after another check frees the provider within seconds: wait
          // when the call keeps its full lookup budget. A cooldown is not waited for.
          const wait = millis(lease.retry_at) - now().getTime();
          if (!millis(lease.retry_at) || wait > PACING_WAIT_MS
            || universalDeadline - performance.now() - Math.max(0, wait) - 5_000 < universalSourceBudget(source)) break;
          report('provider_paced', source);
          await (this.options.wait ?? ((ms, abort) => sleep(ms, undefined, { signal: abort })))(Math.max(250, wait), signal);
          lease = await acquire();
        }
        if (!lease) return null; // Fail closed: do not flood upstreams when coordination is down.
        if (!lease.token) {
          state.failures[source] = { count: state.failures[source]?.count ?? 0, kind: 'rate_limited', retry_at: lease.retry_at };
          report('provider_cooldown', source); return null;
        }
        token = lease.token;
      }
      attempts++;
      const before = performance.now();
      let kind: RoutingFailureKind | null = null;
      let retryAfterMs = 0;
      try {
        const result = normalizeCarrierResult(await (reused ?? this.options.universal(source, universalNumber,
          Math.max(1, Math.min(universalSourceBudget(source), Math.floor(universalDeadline - performance.now()) - 5_000)), postcode, zone)));
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
          defer(false);
        }
        return null;
      } finally {
        // A reused answer was counted, and its lease released, by the check that asked.
        if (token) {
          if (providerInput) {
            // Every provider receives the postcode; supported sources can submit it.
            const step = kind === null ? 'history' : kind === 'input_required' ? 'still_required'
              : kind === 'not_found' || kind === 'no_history' ? 'no_history' : 'failed';
            recordProviderInput(source, step);
            report('provider_input_lookup', source, step);
          }
          // An answer about this number keeps the provider's circuit closed, like not-found.
          try { await this.options.health.finishTrackingProvider(source, token, kind === 'no_history' || kind === 'input_required' ? 'not_found' : kind, retryAfterMs, performance.now() - before); }
          catch { report('health_store_unavailable', source, 'transport'); }
        }
      }
    };

    // A label-only answer must not stop discovery or displace a source that
    // supplied progress. Keep it only if no eligible provider has progress.
    const needsProgress = PROGRESS_STAGES.has(String(parcel.current_stage ?? ''));
    let thinAnswer: { value: RoutedResult; source: UniversalSource } | undefined;
    let selected: { value: RoutedResult; source: UniversalSource } | undefined;
    for (const source of ordered) {
      const value = await universal(source).catch((error: unknown) => {
        // A later cooldown cannot erase an answer already available to preserve.
        if (thinAnswer && error instanceof RoutingDeferred) return null;
        throw error;
      });
      if (!value) continue;
      if (needsProgress && !hasRoutingProgress(value.result)) {
        thinAnswer ??= { value, source };
        continue;
      }
      selected = { value, source };
      break;
    }
    const withoutProgress = !selected && Boolean(thinAnswer);
    selected ??= thinAnswer;
    if (selected) {
      let { value } = selected;
      const { source } = selected;
      let chosen = source;
      // Scheduled-only shadow check. Keep affinity unless the alternative has
      // strictly newer progress; never merge contradictory provider summaries.
      if (!withoutProgress && scheduled && source !== priority && preferred === source && now().getTime() - millis(state.last_probe_at) >= DAY && attempts < 2) {
        // Only providers with at least as full a history for the carrier are worth the comparison.
        const alternatives = richerSources.filter((item) => item !== source && plan.rank(item) <= plan.rank(source));
        const alternative = alternatives[state.probe_cursor % alternatives.length];
        state.probe_cursor++;
        state.last_probe_at = now().toISOString();
        const probe = alternative ? await universal(alternative).catch((error: unknown) => {
          if (!(error instanceof RoutingDeferred)) throw error;
          return null;
        }) : null;
        if (probe && (!hasRoutingProgress(value.result) || hasRoutingProgress(probe.result)) && latest(probe) > latest(value) && latest(probe) >= millis(state.last_event_at)
          && !['delivered', 'returned'].includes(String(value.result.current_stage))) {
          value = probe; chosen = alternative;
          report('fresher_provider_found', chosen);
        }
      }
      if (!withoutProgress && preferred !== chosen) report('provider_selected', chosen);
      // Evidence to refresh the coverage comparison: a provider it found empty for
      // the carrier has this parcel, or one it found with history does not.
      // UPU is ordered by its role, not by evidence.
      if (plan.carrier) {
        if (chosen !== 'UPU' && plan.tier(chosen) === 'empty') report('coverage_contradicted', chosen, 'history');
        for (const source of answeredEmpty) {
          if (source !== 'UPU' && ['full', 'partial'].includes(plan.tier(source))) report('coverage_contradicted', source, 'no_history');
        }
      }
      if (!withoutProgress && !directCarrier(declared) && declared !== 'unknown' && declared !== 'intl-post' && !preferred) report('direct_support_opportunity', declared);
      state.preferred_provider = withoutProgress || chosen === 'UPU' ? preferred : chosen;
      state.preferred_number = state.preferred_provider ? universalNumber : undefined;
      if (typeof value.result.discovered_carrier === 'string') {
        state.discovered_carrier = value.result.discovered_carrier;
        if (directCarrier(state.discovered_carrier) && state.discovered_carrier !== state.confirmed_carrier) {
          state.direct_retry_at = now().toISOString();
          report('direct_carrier_discovered', state.discovered_carrier);
        } else if (!withoutProgress && !directCarrier(state.discovered_carrier)) report('direct_support_opportunity', state.discovered_carrier);
      }
      // Confirm a newly reported carrier immediately. Preserve universal data if
      // confirmation fails, needs credentials, or only returned older history.
      if (!prefetchedUniversal.has(chosen) && state.discovered_carrier && universalNumber === number && !metadata.original_carrier) {
        const watermark = state.last_event_at;
        // Progress the parcel hasn't had yet: a carrier that said "not found"
        // may know the parcel now, so it is asked without waiting its turn.
        const missed = state.failures[state.discovered_carrier];
        if (missed?.kind === 'not_found' && !attemptedDirect.has(state.discovered_carrier) && latest(value) > millis(watermark)) {
          missed.retry_at = now().toISOString();
        }
        state.last_event_at = withoutProgress ? watermark : iso(Math.max(millis(watermark), latest(value)));
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
          // Nor is the postal union's feed, which names no carrier.
          if (typeof name === 'string' && !value.result.discovered_carrier && !seen.includes(name)
            && !isKnownCarrierName(name) && !isCarrierFeedName(name)) report('carrier_coverage_discovered', name);
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
      return persistResult(value, chosen, withoutProgress);
    }
    if (localDirectFallback) {
      const { value, carrier } = localDirectFallback;
      value.result = { ...value.result, direct_local_fallback: true };
      return persistResult(value, carrier);
    }
    state.discovery_cursor = (offset + Math.max(1, [...attemptedUniversal].filter((source) => rotation.includes(source)).length)) % Math.max(1, rotation.length);
    const deadlines = Object.values(state.failures).map((failure) => millis(failure.retry_at)).filter((time) => time > now().getTime());
    state.next_check_at = iso(Math.max(now().getTime() + 15 * 60_000, Math.min(...deadlines, now().getTime() + HOUR)));
    report('all_providers_unavailable', preferred ?? 'none');
    return defer();
  }
}
