import 'server-only';
import { deferredTrackingFailure, trackingFailureCode } from './trackingFailure';
import { CarrierError, inferStage, stageSource, resultStage, resultHasUpdate, CARRIER_DEFINITIONS, type CarrierId } from 'universal-parcel-scraper';
export { classifyStage, inferStage, stageSource, resultStage, resultHasUpdate } from 'universal-parcel-scraper';
import { AMAZON_ACCOUNT_MESSAGE, AMAZON_HISTORY_EXPIRED, requiresAmazonAccount } from '../lib/amazon';

import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { STAGES } from '../generated/apiContract';
import { normalizeCarrierResult, type CarrierResult } from 'universal-parcel-scraper';
import { deliveryHandoff, hasDirectHandoffAdapter, type DeliveryHandoff } from 'universal-parcel-scraper';
import {
  AUTOMATIC_CARRIER_IDS,
  supportsSwissPostHandoff,
} from './carriers';
import type { AdapterRegistry, Recognition, TrackingContext } from 'universal-parcel-scraper/node';
import { trackCarrier } from 'universal-parcel-scraper/node';
import type { StepRecorder } from 'universal-parcel-scraper/node';
import { createAdapterRegistry, hostAdapterEnvironment } from './adapterRegistry';
import { preflightInputNeeded, takePreflightHistory } from './trackingPreflight';
import { recognizeBrowser, takeBrowserHistory } from './browserRecognition';
import { hostStepRecorder } from './stepRecorder';
import { recordStatusMapping } from './metrics';
import {
  captureOperationalError,
  errorType,
  logOperationalEvent,
  reportRoutingEvent,
} from './observability';
import type { DeliveryEmailService } from './email/deliveryEmails';
import { PushDispatchError, type CompositePushNotificationService } from './push';
import { STORED_EVENT_IDENTITIES, type SupabaseServiceClient } from './supabase';
import { sameInstantIdentities, sharedScans, withIdentities, withoutCopyDrift } from './eventIdentity';
import {
  TrackingSyncAudit,
  type SyncAnomalyCode,
  type SyncRunContext,
} from './trackingAudit';
import { isRecord, type JsonObject } from './types';
import { UniversalTracker } from 'universal-parcel-scraper/node';
import type { UniversalSource } from 'universal-parcel-scraper';
import { detectionNames, directCarrier, freshnessWindow, hasRoutingProgress, RoutingDeferred, routingFailure, routingState, TrackingRouter } from './trackingRouting';
import { upuHistory } from './upuHistory';
import { directHistoryNumber, directLocalHistory, directLocalSnapshotIsOlder, hasUnresolvedDirectCurrent } from './directLocalHistory';
import { eventTimestamp, latestResultTime, resultTimezone } from 'universal-parcel-scraper/app';
import { trackingSupportEvidence } from './trackingSupport';
import { carrierLookupKey, recognitionKey, SharedLookups, universalLookupKey, type ParcelLookups } from './sharedLookups';

const MAX_PACKAGES_PER_OWNER_PER_SYNC = 5;
/** One-off parcels have no owner: a scheduled run checks this many of them, all together. */
const MAX_ONE_OFF_PACKAGES_PER_SYNC = 10;
/** A one-off parcel stays on the schedule this long after one of its links was last opened. */
const ONE_OFF_FOLLOWED_MS = 24 * 60 * 60 * 1_000;
/** A parcel no notification can reach keeps the daytime cadence this long after its account's apps or one of its links were last opened; then it is checked hourly. */
const WATCHED_AFTER_OPEN_MS = 60 * 60 * 1_000;
const VALID_STAGES = new Set<string>(STAGES);
/** Scheduled checks fall back to hourly this long after a parcel's newest carrier event, or after it was added. */
const IDLE_AFTER_MS = 48 * 60 * 60 * 1_000;
/**
 * A number nobody has seen yet is checked hourly for this long after it was
 * added, then every six hours. A one-off lookup then leaves the schedule.
 */
const UNSEEN_HOURLY_MS = 6 * 60 * 60 * 1_000;
/** After this long unseen, a number is checked daily. */
const UNSEEN_DAILY_AFTER_MS = 48 * 60 * 60 * 1_000;

/**
 * An unsuccessful partner confirmation must not double every refresh's cost.
 * Recheck when origin history advances, the partner/reference changes, or this gap passes.
 */
const DELIVERY_PROBE_INTERVAL_MS = 55 * 60 * 1_000;

interface DeliveryProbe extends JsonObject { at: string; origin_update: string | null }

function previousDeliveryProbe(parcel: JsonObject, carrier: string, number: string): DeliveryProbe | null {
  const data = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
  const stored = data.delivery_probe ?? (carrier === 'swiss-post' ? data.swiss_post_probe : undefined);
  if (!isRecord(stored) || typeof stored.at !== 'string' || !Number.isFinite(Date.parse(stored.at))) return null;
  if ((stored.carrier != null && stored.carrier !== carrier) || (stored.number != null && stored.number !== number)) return null;
  return { at: stored.at, origin_update: typeof stored.origin_update === 'string' ? stored.origin_update : null };
}

/** How many answers a check took from another copy of its number in the same run, when any. */
function sharedAnswers(checks: ParcelLookups | undefined): JsonObject {
  return checks?.shared ? { shared_answers: checks.shared } : {};
}

/** Which tiers a deferred lookup gave up on, as provider ids and failure kinds only. */
function deferredFetchDetails(error: RoutingDeferred): JsonObject {
  return {
    providers_attempted: error.attempted,
    provider_failures: Object.entries(error.routing.failures)
      .map(([provider, failure]) => `${provider}:${failure.kind}`).join(',').slice(0, 300),
  };
}

export function isTrackingSyncDue(parcel: JsonObject, now: Date): boolean {
  if (parcel.sync_status === 'unsupported' && parcel.carrier === 'amazon-shipping' && parcel.sync_error === AMAZON_HISTORY_EXPIRED) return false;
  if (parcel.sync_status === 'unsupported' && requiresAmazonAccount(String(parcel.carrier), String(parcel.tracking_number ?? ''))) return false;
  const routing = routingState(parcel);
  if (routing.next_check_at && Date.parse(routing.next_check_at) > now.getTime()) return false;
  const activeCarrier = isRecord(parcel.carrier_data) ? parcel.carrier_data.active_tracking_carrier : undefined;
  const refresh = CARRIER_DEFINITIONS[String(activeCarrier ?? parcel.carrier) as CarrierId]?.tracking.refresh;
  if (!refresh?.afterFailureMinutes) return true;
  const lastChecked = Date.parse(String(parcel.last_synced_at ?? ''));
  if (!Number.isFinite(lastChecked)) return true;
  const interval = parcel.sync_status === 'error'
    ? refresh.afterFailureMinutes * 60_000 : refresh.minMinutes * 60_000;
  return now.getTime() >= lastChecked + interval;
}

/** The newest carrier event or the parcel's creation, whichever is later; null when neither is known. */
function lastActivity(parcel: JsonObject): number | null {
  // Routing keeps the event watermark; parcels outside routing (Amazon Shipping) keep only the summary time.
  const summaryTime = isRecord(parcel.carrier_data) ? parcel.carrier_data.last_update : undefined;
  const times = [routingState(parcel).last_event_at, summaryTime, parcel.created_at]
    .map((value) => Date.parse(String(value ?? ''))).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

/**
 * How long ago a parcel was added when no carrier or provider has answered
 * for its number yet: no carrier identified or recognised, no history and
 * nothing asked of the user. Null once one has.
 */
function unseenFor(parcel: JsonObject, now: Date): number | null {
  if (!['unknown', 'intl-post'].includes(String(parcel.carrier)) || String(parcel.current_stage ?? 'pending') !== 'pending') return null;
  const data = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
  const routing = routingState(parcel);
  if (data.original_carrier || data.universal_input || routing.last_success_at || routing.last_event_at
    || routing.confirmed_carrier || routing.discovered_carrier || routing.input_needed || routing.provider_input_needed) return null;
  const added = Date.parse(String(parcel.created_at ?? ''));
  return Number.isFinite(added) ? Math.max(0, now.getTime() - added) : 0;
}

/**
 * `unwatched`: nobody is waiting for the parcel, so it is checked hourly, as an idle one is.
 * `oneOff`: a lookup without an account, which leaves the schedule when nobody has seen its number for hours.
 */
function isScheduledTrackingSyncDue(parcel: JsonObject, now: Date, unwatched = false, oneOff = false): boolean {
  if (!isTrackingSyncDue(parcel, now)) return false;
  const unseen = unseenFor(parcel, now);
  if (oneOff && unseen !== null && unseen >= UNSEEN_HOURLY_MS) return false;
  const lastChecked = Date.parse(String(parcel.last_synced_at ?? ''));
  if (!Number.isFinite(lastChecked)) return true;
  const local = DateTime.fromJSDate(now, { zone: 'Europe/Zurich' });
  if (unseen !== null) {
    // Hourly, then every 6 h, then daily, around the clock.
    const hours = unseen < UNSEEN_HOURLY_MS ? 1 : unseen < UNSEEN_DAILY_AFTER_MS ? 6 : 24;
    return lastChecked < local.startOf('hour').minus({ hours: hours - 1 }).toMillis();
  }
  const intervalMinutes = parcel.current_stage === 'out_for_delivery'
    ? 2 : Math.max(10, (CARRIER_DEFINITIONS[String(parcel.carrier) as CarrierId]?.tracking.refresh?.minMinutes ?? 0));
  const activity = lastActivity(parcel);
  const idle = unwatched || (activity !== null && now.getTime() - activity >= IDLE_AFTER_MS);
  // Compare schedule windows so request duration does not skip the next tick.
  const windowStart = !idle && local.hour >= 8 && local.hour < 22
    ? local.startOf('minute').minus({ minutes: local.minute % intervalMinutes })
    : local.startOf('hour');
  return lastChecked < windowStart.toMillis();
}

/**
 * Whether opening a one-off parcel's link should queue a check: only when the
 * schedule's cadence for the parcel has come round, including for a lookup
 * that left the schedule because nobody has seen its number. Reading a link
 * never checks a carrier more often than that, however often it is polled.
 */
export function isOpenedParcelSyncDue(parcel: JsonObject, now: Date): boolean {
  const open = !['delivered', 'returned'].includes(String(parcel.current_stage))
    || parcel.last_status_text === 'TO_BE_DELIVERED';
  return open && parcel.archived_at == null && isScheduledTrackingSyncDue(parcel, now);
}

export interface TrackingAdapter {
  fetchUniversal?(source: UniversalSource, trackingNumber: string, timeoutMs: number, dpdPostcode?: string | null, timezone?: string | null): Promise<CarrierResult>;
  /** A carrier's cheap check of whether it knows a number (carrier.json `tracking.recognition`). */
  recognize?(carrierId: string, trackingNumber: string, context?: TrackingContext): Promise<Recognition>;
  recognizeBrowser?(carrierId: string, trackingNumber: string, context?: TrackingContext, previousError?: unknown): Promise<Recognition>;
  fetch(
    carrierId: string,
    trackingNumber: string,
    trackingUrl: string | null,
    dpdPostcode?: string | null,
  ): Promise<CarrierResult>;
}

export class CarrierTrackingAdapter implements TrackingAdapter {
  constructor(
    readonly universal = new UniversalTracker({ environment: hostAdapterEnvironment(), providers: ['ParcelsApp', 'Ship24', '17TRACK', 'UPU'] }),
    readonly registry: AdapterRegistry = createAdapterRegistry(),
    readonly recorder: StepRecorder = hostStepRecorder(),
  ) {}

  async fetchUniversal(source: UniversalSource, trackingNumber: string, timeoutMs: number, dpdPostcode?: string | null, timezone?: string | null): Promise<CarrierResult> {
    return this.universal.fetchSource(source, trackingNumber, timeoutMs, dpdPostcode ?? null, timezone ?? null);
  }

  async recognize(carrierId: string, trackingNumber: string, context?: TrackingContext): Promise<Recognition> {
    const registered = this.registry.for(carrierId);
    if (!registered?.recognize) throw new RangeError(`${carrierId} cannot recognize a number`);
    return await registered.recognize(trackingNumber, context);
  }

  recognizeBrowser = recognizeBrowser;

  async fetch(
    carrierId: string,
    trackingNumber: string,
    trackingUrl: string | null,
    dpdPostcode?: string | null,
  ): Promise<CarrierResult> {
    const prefetched = !trackingUrl && !dpdPostcode ? takeBrowserHistory(carrierId, trackingNumber) : undefined;
    if (prefetched) return normalizeCarrierResult(prefetched);
    return trackCarrier(carrierId, { number: trackingNumber, trackingUrl, postcode: dpdPostcode ?? null }, {
      registry: this.registry, universal: this.universal, recorder: this.recorder,
    });
  }
}

export interface SyncSummary extends JsonObject {
  checked: number;
  updated: number;
  unchanged: number;
  waiting: number;
  errors: number;
  unsupported: number;
  superseded: number;
  notifications_sent: number;
  notification_errors: number;
  subscriptions_expired: number;
  emails_sent: number;
  email_errors: number;
}

export function emptySyncSummary(): SyncSummary {
  return {
    checked: 0,
    updated: 0,
    unchanged: 0,
    waiting: 0,
    errors: 0,
    unsupported: 0,
    superseded: 0,
    notifications_sent: 0,
    notification_errors: 0,
    subscriptions_expired: 0,
    emails_sent: 0,
    email_errors: 0,
  };
}

const UNANNOUNCED_PHRASES = [
  'did not return the requested parcel',
  'no parcel found',
  'not announced',
  'not found yet',
  'not registered',
  'shipment not found',
  'tracking number not found',
  'unknown tracking number',
];

export function isUnannouncedTrackingError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (typeof current === 'object' && current !== null) {
      const status = 'status' in current ? Number(current.status)
        : 'statusCode' in current ? Number(current.statusCode)
          : 0;
      if (status === 404) return true;
    }
    const message = String(current).toLocaleLowerCase('en-US').trim().split(/\s+/).join(' ');
    if (UNANNOUNCED_PHRASES.some((phrase) => message.includes(phrase))) return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

export function providerEventId(
  carrierId: string,
  rawTime: unknown,
  location: string,
  description: string,
): string {
  const material = JSON.stringify([
    carrierId,
    String(rawTime ?? ''),
    location.trim(),
    description.trim(),
  ]);
  return `${carrierId}:${createHash('sha256').update(material).digest('hex')}`;
}

export function buildEvents(
  parcel: JsonObject,
  result: CarrierResult,
  sourceCarrierId?: string,
  observedAt?: Date,
): JsonObject[] {
  const reportedCurrent = resultStage(result);
  const current = reportedCurrent ?? 'in_transit';
  const carrierId = sourceCarrierId ?? String(parcel.carrier ?? '');
  const timezone = resultTimezone(carrierId, result);
  const rows: JsonObject[] = [];
  // Carriers repeat a scan word for word (Chronopost logs one sort up to three
  // times in the same minute). A repeat has the same identity, and a batch that
  // holds an identity twice cannot be saved, so each scan is kept once.
  const identities = new Set<string>();
  for (const raw of result.events ?? []) {
    const description = String(raw.description ?? 'Tracking update').trim();
    const location = String(raw.location ?? '').trim();
    const occurredAt = eventTimestamp(raw.time, timezone);
    if (!occurredAt) continue;
    const identity = providerEventId(carrierId, raw.time, location, description);
    if (identities.has(identity)) continue;
    identities.add(identity);
    const declaredStage = String(raw.stage ?? '');
    rows.push({
      package_id: parcel.id,
      // Historical scans must not inherit the shipment's current/final stage.
      stage: VALID_STAGES.has(declaredStage) ? declaredStage : inferStage(description),
      description,
      location: location || null,
      occurred_at: occurredAt,
      provider_event_id: identity,
      raw_data: { ...raw, stage_source: stageSource(declaredStage, description, raw.stage_source) },
    });
  }
  if (rows.length === 0 && current && result.last_status_text) {
    const description = String(result.last_status_text);
    const occurredAt = eventTimestamp(result.last_update, timezone);
    if (occurredAt) {
      rows.push({
        package_id: parcel.id,
        stage: current,
        description,
        location: null,
        occurred_at: occurredAt,
        provider_event_id: providerEventId(carrierId, result.last_update, '', description),
        raw_data: {
          time: result.last_update,
          stage_source: stageSource(String(result.current_stage ?? ''), description, result.current_stage_source),
        },
      });
    }
  }
  const previousStage = String(parcel.current_stage ?? 'pending');
  const previousData = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
  const newUpuMilestone = result.tracking_provider === 'UPU'
    && previousData.tracking_provider === 'UPU'
    && typeof result.last_update_local === 'string'
    && result.last_update_local > String(previousData.last_update_local ?? '');
  const currentAlreadyTimed = rows.some((row) => row.stage === current);
  if (
    observedAt
    && !Number.isNaN(observedAt.getTime())
    && reportedCurrent !== null
    && (result.status !== 'pending' || rows.length === 0)
    && current !== 'pending'
    && (current !== previousStage || newUpuMilestone)
    && !currentAlreadyTimed
  ) {
    const matchingEvent = (result.events ?? []).find((raw) => {
      const declaredStage = String(raw.stage ?? '');
      const description = String(raw.description ?? '');
      return (VALID_STAGES.has(declaredStage) ? declaredStage : inferStage(description))
        === current;
    });
    const description = String(
      matchingEvent?.description ?? result.last_status_text ?? 'Tracking update',
    ).trim() || 'Tracking update';
    const location = String(matchingEvent?.location ?? '').trim();
    const occurredAt = observedAt.toISOString();
    const declaredCurrent = String(result.current_stage ?? '');
    rows.push({
      package_id: parcel.id,
      stage: current,
      description,
      location: location || null,
      occurred_at: occurredAt,
      provider_event_id: providerEventId(
        carrierId,
        result.tracking_provider === 'UPU'
          ? `UPU:observed:${String(matchingEvent?.local_time ?? '')}:${String(matchingEvent?.provider_code ?? '')}`
          : `observed:${previousStage}->${current}`,
        location,
        description,
      ),
      raw_data: {
        ...(result.tracking_provider === 'UPU' || result.direct_local_fallback === true ? matchingEvent : {}),
        observed_without_provider_timestamp: true,
        stage_source: stageSource(
          VALID_STAGES.has(declaredCurrent) ? declaredCurrent : String(matchingEvent?.stage ?? ''),
          description,
          result.current_stage_source ?? matchingEvent?.stage_source,
        ),
      },
    });
  }
  return rows;
}

// Local-clock scans can need review even though they cannot supply a timed
// timeline row. Their observation has no persisted sample event until a feed
// establishes an instant; its identity is only used by the observation lookup.
function localStatusObservationEvents(parcel: JsonObject, result: CarrierResult, carrierId: string): JsonObject[] {
  const timezone = resultTimezone(carrierId, result);
  return (result.events ?? []).flatMap((raw): JsonObject[] => {
    if (eventTimestamp(raw.time, timezone) || typeof raw.local_time !== 'string' || !raw.local_time
      || typeof raw.stage_source !== 'string') return [];
    const description = String(raw.description ?? '').trim();
    const stage = String(raw.stage ?? '');
    if (!description || !VALID_STAGES.has(stage)) return [];
    return [{
      package_id: parcel.id,
      stage,
      description,
      provider_event_id: providerEventId(carrierId, raw.local_time, String(raw.location ?? ''), description),
      raw_data: { ...raw, stage_source: stageSource(stage, description, raw.stage_source) },
    }];
  });
}

// One sync reports a bounded sample: repeated wording is already deduplicated
// by observation key, and the row's count grows on the next sync instead.
export const MAX_STATUS_OBSERVATIONS_PER_SYNC = 32;

export interface StatusObservation extends JsonObject {
  observation_key: string;
  carrier: string;
  provider_code: string | null;
  description_normalized: string;
  language_guess: string | null;
  stage_source: string;
  chosen_stage: string;
  package_id: string;
  provider_event_id: string;
}

export function normalizeObservedDescription(description: string): string {
  return description.toLocaleLowerCase('en-US').trim().split(/\s+/).join(' ').slice(0, 500);
}

/**
 * Collects the carrier wording whose stage did not come from a carrier map, so
 * an operator can map it later. The package and event identifiers travel with
 * the observation only to resolve one sample event row; they are not stored.
 */
export function collectStatusObservations(
  events: readonly JsonObject[],
  fallbackCarrierId: string,
): StatusObservation[] {
  const observations = new Map<string, StatusObservation>();
  for (const event of events) {
    const raw = isRecord(event.raw_data) ? event.raw_data : {};
    const source = typeof raw.stage_source === 'string' ? raw.stage_source : '';
    if (!source || source === 'carrier_map') continue;
    const description = normalizeObservedDescription(String(event.description ?? ''));
    const chosenStage = String(event.stage ?? '');
    if (!description || !chosenStage) continue;
    const eventId = String(event.provider_event_id ?? '');
    // Every provider event id is prefixed with the carrier that served it, so a
    // timeline merged from two carriers keeps each wording with its own.
    const carrier = (eventId.split(':')[0] || fallbackCarrierId).slice(0, 100);
    if (!carrier) continue;
    const providerCode = typeof raw.provider_code === 'string' && raw.provider_code
      ? raw.provider_code.slice(0, 100)
      : null;
    const key = createHash('sha256')
      .update(JSON.stringify([carrier, providerCode ?? '', description]))
      .digest('hex');
    if (observations.has(key)) continue;
    observations.set(key, {
      observation_key: key,
      carrier,
      provider_code: providerCode,
      description_normalized: description,
      language_guess: null,
      stage_source: source.slice(0, 100),
      chosen_stage: chosenStage,
      package_id: String(event.package_id ?? ''),
      provider_event_id: eventId,
    });
    if (observations.size >= MAX_STATUS_OBSERVATIONS_PER_SYNC) break;
  }
  return [...observations.values()];
}

/** Stages before the carrier moves the parcel, in order. */
const EARLY_STAGES = ['pending', 'registered', 'accepted'];
/** Stages a carrier reports once it moves the parcel, short of a final one. */
const MOVING_STAGES = new Set(['in_transit', 'customs', 'out_for_delivery', 'failed_attempt', 'ready_for_pickup']);

/**
 * The stage to save over the previous one. An earlier stage than the saved
 * one, up to accepted, is a notice or a reworded scan rather than a step back,
 * so the saved stage stays. Delivered and returned have their own rule, and
 * after an exception a new label can start over.
 */
export function stageToSave(previousStage: string, selectedStage: string): string {
  const selected = EARLY_STAGES.indexOf(selectedStage);
  const previous = MOVING_STAGES.has(previousStage) ? EARLY_STAGES.length : EARLY_STAGES.indexOf(previousStage);
  return selected >= 0 && previous > selected ? previousStage : selectedStage;
}

export function detectSyncAnomalies(
  parcel: JsonObject,
  result: CarrierResult,
  events: JsonObject[],
  sourceCarrierId: string,
  selectedStage: string | null,
  now: Date,
): SyncAnomalyCode[] {
  const anomalies = new Set<SyncAnomalyCode>();
  const timezone = resultTimezone(sourceCarrierId, result);
  if ((result.events ?? []).some((event) => (
    typeof event.time === 'string'
    && event.time.trim() !== ''
    && eventTimestamp(event.time, timezone) === null
  ))) {
    anomalies.add('invalid_event_timestamp');
  }
  // A local clock read in the wrong zone lands hours ahead; small upstream
  // skew (La Poste partner scans run about half an hour early) does not alert.
  const futureBoundary = now.getTime() + 60 * 60 * 1_000;
  if (events.some((event) => {
    const occurredAt = Date.parse(String(event.occurred_at ?? ''));
    return Number.isFinite(occurredAt) && occurredAt > futureBoundary;
  })) {
    anomalies.add('future_event_timestamp');
  }
  if (events.some((event) => (
    isRecord(event.raw_data)
    && event.raw_data.observed_without_provider_timestamp === true
  ))) {
    anomalies.add('observed_without_timestamp');
  }
  const previousStage = String(parcel.current_stage ?? 'pending');
  if (
    (previousStage === 'delivered' || previousStage === 'returned')
    && selectedStage !== null
    && selectedStage !== previousStage
    // A carrier may report a problem after delivery (damage, wrong address,
    // refusal). That is new information, not a rewritten history.
    && selectedStage !== 'exception'
  ) {
    anomalies.add('terminal_stage_regression');
  }
  if (result.status === 'delivered' && selectedStage !== 'delivered') {
    anomalies.add('delivered_status_conflict');
  }
  if (previousStage !== 'pending' && !(previousStage === 'registered' ? resultHasUpdate(result) : hasRoutingProgress(result))) {
    // A fallback provider that knows less than the source of the saved summary
    // contradicts nothing while the carrier's own adapter is asked again within
    // hours. That adapter, or the provider the summary came from, answering
    // without progress does. For a carrier without an adapter, routing has
    // exhausted the eligible providers before returning this thin answer.
    const savedProvider = isRecord(parcel.carrier_data) ? parcel.carrier_data.tracking_provider : undefined;
    anomalies.add(typeof result.tracking_provider === 'string' && result.tracking_provider !== savedProvider
      && directCarrier(String(parcel.carrier)) ? 'fallback_without_progress' : 'progress_disappeared');
  }
  return [...anomalies];
}

type SyncOutcome = 'updated' | 'unchanged' | 'waiting' | 'errors' | 'unsupported' | 'superseded';

class SupersededTrackingSync extends Error {}

export class TrackingSyncService {
  #tail: Promise<void> = Promise.resolve();
  #reportedObservationFailure = false;

  constructor(
    readonly client: SupabaseServiceClient,
    readonly adapter: TrackingAdapter = new CarrierTrackingAdapter(),
    readonly notifier: CompositePushNotificationService | null = null,
    readonly now: () => Date = () => new Date(),
    readonly emails: DeliveryEmailService | null = null,
  ) {}

  async sync(context: SyncRunContext = { trigger: 'scheduled' }): Promise<SyncSummary> {
    return await this.exclusive(async () => {
      context.signal?.throwIfAborted();
      const summary = emptySyncSummary();
      const now = this.now();
      const unwatched = await this.unwatchedPackages(now, context.signal);
      const due = (oneOff: boolean) => (parcel: JsonObject) => isScheduledTrackingSyncDue(parcel, now, unwatched.has(String(parcel.id)), oneOff);
      const accounts = fairSyncPackages((await this.client.listActivePackages()).filter(due(false)));
      const parcels = [...accounts, ...await this.followedOneOffPackages(due(true), now, context.signal)];
      // Copies of one number, in several accounts or followed without one, share their lookups.
      const lookups = new SharedLookups(parcels);
      for (const parcel of parcels) {
        summary.checked += 1;
        summary[await this.syncOne(parcel, context, lookups)] += 1;
      }
      await this.linkConfirmedParcels();
      await this.dispatchNotifications(summary, context.signal);
      return summary;
    });
  }

  async syncPackage(
    parcel: JsonObject,
    context: SyncRunContext = { trigger: 'package' },
  ): Promise<SyncSummary> {
    return await this.exclusive(async () => {
      context.signal?.throwIfAborted();
      const summary = emptySyncSummary();
      // Manual refreshes share the persisted cooldown with scheduled checks.
      if (isTrackingSyncDue(parcel, this.now())) {
        summary.checked = 1;
        summary[await this.syncOne(parcel, context)] += 1;
      }
      if (typeof parcel.user_id === 'string') await this.linkConfirmedParcels(parcel.user_id);
      await this.dispatchNotifications(summary, context.signal);
      return summary;
    });
  }

  /**
   * The open parcels nobody is waiting for: no notification can reach anyone
   * about them and nobody opened them in the last hour. When they cannot be
   * read, every parcel keeps the full cadence.
   */
  private async unwatchedPackages(now: Date, signal?: AbortSignal): Promise<Set<string>> {
    try {
      return new Set(await this.client.listUnwatchedPackageIds(new Date(now.getTime() - WATCHED_AFTER_OPEN_MS)));
    } catch (error) {
      signal?.throwIfAborted();
      captureOperationalError(error, { component: 'tracking', operation: 'list_unwatched_packages' });
      return new Set();
    }
  }

  /**
   * One-off parcels stay on the schedule while a link was opened lately.
   * They come after every account's share and count as one owner, the least
   * recently checked first, so lookups cannot starve accounts. Nor can they
   * stop them: when the list cannot be read, the accounts are still checked.
   */
  private async followedOneOffPackages(
    due: (parcel: JsonObject) => boolean,
    now: Date,
    signal?: AbortSignal,
  ): Promise<JsonObject[]> {
    try {
      return (await this.client.listFollowedOneOffPackages(new Date(now.getTime() - ONE_OFF_FOLLOWED_MS)))
        .filter(due).slice(0, MAX_ONE_OFF_PACKAGES_PER_SYNC);
    } catch (error) {
      signal?.throwIfAborted();
      captureOperationalError(error, { component: 'tracking', operation: 'list_one_off_packages' });
      return [];
    }
  }

  private async linkConfirmedParcels(userId?: string): Promise<void> {
    try { await this.client.autoLinkPackages(userId); }
    catch (error) {
      // A transient linking failure must not erase a successful tracking update.
      // The next scheduled or manual refresh retries reconciliation.
      captureOperationalError(error, { component: 'tracking', operation: 'auto_link_packages' });
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => { release = resolve; });
    await prior;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  /** Tells what the job found: notifications first, then the delivery emails, which need no push channel. */
  private async dispatchNotifications(summary: SyncSummary, signal?: AbortSignal): Promise<void> {
    await this.dispatchPush(summary, signal);
    await this.dispatchEmails(summary, signal);
  }

  private async dispatchEmails(summary: SyncSummary, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!this.emails) return;
    try {
      const emails = await this.emails.dispatch(signal);
      summary.emails_sent = emails.sent;
      summary.email_errors = emails.failed;
    } catch (error) {
      signal?.throwIfAborted();
      // The job's tracking work is done: an email run that could not start is tried by the next job.
      summary.email_errors += 1;
      captureOperationalError(error, { component: 'delivery-email', operation: 'dispatch' });
    }
  }

  private async dispatchPush(summary: SyncSummary, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!this.notifier) return;
    try {
      const push = await this.notifier.dispatch(signal);
      summary.notifications_sent = push.sent;
      summary.notification_errors = push.failed;
      summary.subscriptions_expired = push.expired;
      if (push.failed > 0) {
        captureOperationalError(new Error('Push dispatch returned failed deliveries'), {
          component: 'push',
          operation: 'dispatch',
          failureCount: push.failed,
        });
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof PushDispatchError) {
        summary.notifications_sent = error.summary.sent;
        summary.notification_errors = error.summary.failed;
        summary.subscriptions_expired = error.summary.expired;
      }
      summary.notification_errors += 1;
      captureOperationalError(error, { component: 'push', operation: 'dispatch' });
    }
  }

  // Unmapped carrier wording is review material, never a reason to fail a
  // refresh: a failed write is logged each time and reported to Sentry once.
  // The events keep their computed identities, whose prefix names the carrier
  // that worded them; a reused identity only locates the sample row.
  private async recordStatusObservations(
    events: JsonObject[],
    carrierId: string,
    context: SyncRunContext,
    reusedIdentities: ReadonlyMap<string, string> = new Map(),
    localEvents: JsonObject[] = [],
  ): Promise<void> {
    for (const event of events) {
      const raw = isRecord(event.raw_data) ? event.raw_data : {};
      if (typeof raw.stage_source === 'string') recordStatusMapping(carrierId, raw.stage_source);
    }
    const observations = collectStatusObservations([...events, ...localEvents], carrierId).map((observation) => {
      const stored = reusedIdentities.get(observation.provider_event_id);
      return stored ? { ...observation, provider_event_id: stored } : observation;
    });
    if (observations.length === 0) return;
    try {
      await this.client.recordTrackingStatusObservations(observations);
    } catch (error) {
      if (context.signal?.aborted) return;
      logOperationalEvent('tracking_status_observation_write_failed', {
        carrier: carrierId,
        trigger: context.trigger,
        job_id: context.jobId ?? null,
        observations: observations.length,
        error_type: errorType(error),
      }, 'error');
      if (this.#reportedObservationFailure) return;
      this.#reportedObservationFailure = true;
      captureOperationalError(error, {
        component: 'tracking-status-observations',
        operation: 'record',
        carrier: carrierId,
      });
    }
  }

  private async syncOne(parcel: JsonObject, context: SyncRunContext, lookups?: SharedLookups): Promise<SyncOutcome> {
    context.signal?.throwIfAborted();
    const id = String(parcel.id ?? '');
    const carrierId = String(parcel.carrier ?? '');
    if (!id) throw new TypeError('A package id is required for synchronization');
    const previousStage = String(parcel.current_stage ?? 'pending');
    const now = this.now();
    const audit = new TrackingSyncAudit(
      this.client,
      id,
      String(parcel.tracking_number ?? ''),
      carrierId || 'unknown',
      previousStage,
      context,
      now,
    );
    await audit.start();

    const addition = isRecord(parcel.carrier_data) && parcel.carrier_data.add_recognition_pending === true;
    let consumeAddition = addition;

    const persist = async (
      values: JsonObject,
      newEvents: JsonObject[] = [],
      deleteDescriptions: string[] = [],
    ) => {
      context.signal?.throwIfAborted();
      if (consumeAddition) {
        const data = { ...(isRecord(values.carrier_data) ? values.carrier_data : isRecord(parcel.carrier_data) ? parcel.carrier_data : {}) };
        delete data.add_recognition_pending;
        values.carrier_data = data;
      }
      const applied = context.lease
        ? await this.client.applyTrackingSync(parcel, values, newEvents, deleteDescriptions, context.lease)
        : await this.client.applyTrackingSync(parcel, values, newEvents, deleteDescriptions);
      if (!applied) {
        throw new SupersededTrackingSync('Tracking configuration changed during the check');
      }
      if (consumeAddition) {
        parcel.carrier_data = values.carrier_data;
        consumeAddition = false;
      }
    };
    const superseded = async (): Promise<SyncOutcome> => {
      await audit.finish({ outcome: 'superseded' });
      return 'superseded';
    };

    const accountRequired = requiresAmazonAccount(carrierId, String(parcel.tracking_number ?? ''));
    if (accountRequired || (!AUTOMATIC_CARRIER_IDS.has(carrierId) && !this.adapter.fetchUniversal)) {
      audit.record('selected', 'succeeded', 0, { automatic: false });
      audit.skip('fetch', 'unsupported_carrier');
      audit.skip('normalize', 'unsupported_carrier');
      audit.skip('persist_events', 'unsupported_carrier');
      try {
        await audit.step('persist_package', async () => {
          await persist({
            sync_status: 'unsupported',
            sync_error: accountRequired ? AMAZON_ACCOUNT_MESSAGE : 'Automatic updates are unavailable for this carrier. Change the carrier or check the tracking link.',
            last_synced_at: null,
          });
        });
        await audit.finish({ outcome: 'unsupported' });
        return 'unsupported';
      } catch (error) {
        context.signal?.throwIfAborted();
        if (error instanceof SupersededTrackingSync) return superseded();
        audit.reportError(error, 'persist_package');
        await audit.finish({ outcome: 'error', error });
        throw error;
      }
    }

    let operation: 'selected' | 'fetch' | 'normalize' | 'persist_events' | 'persist_package'
      = 'selected';
    let result: CarrierResult | null = null;
    let sourceCarrierId: string | null = null;
    let reportedStage: string | null = null;
    let selectedStage: string | null = null;
    let events: JsonObject[] = [];
    let anomalies: SyncAnomalyCode[] = [];
    try {
      await audit.step('selected', async () => {
        await persist({ sync_status: 'syncing', sync_error: null });
      }, () => ({ automatic: true }));

      operation = 'fetch';
      let fetched: {
        correction?: { carrier: string; trackingUrl: string | null; postcode: string | null };
        result: CarrierResult;
        sourceCarrierId: string;
        swissPostReady: boolean | null;
        handoffFallbackErrorType: string | null;
        earlierResult?: CarrierResult;
        earlierCarrierId?: string;
      };
      const fetchStartedAt = performance.now();
      // The check sees the routing its number shares with the other copies in the run.
      const checks = lookups?.for(parcel);
      const subject = checks?.parcel ?? parcel;
      const once = <T>(key: readonly unknown[], lookup: () => Promise<T>) => checks ? checks.once(key, lookup) : lookup();
      try {
        fetched = await audit.observeFetch(async () => this.adapter.fetchUniversal && carrierId !== 'amazon-shipping'
          ? await new TrackingRouter({
            direct: (candidate, carrier) => this.fetchResult(candidate, carrier, checks),
            universal: (source, number, timeout, postcode, timezone) => once(universalLookupKey(source, number, postcode, timezone),
              () => this.adapter.fetchUniversal!(source, number, timeout, postcode, timezone)),
            ...(checks ? { reusedUniversal: (source: UniversalSource, number: string, postcode: string | null, timezone: string | null) =>
              checks.reuse<CarrierResult>(universalLookupKey(source, number, postcode, timezone)) } : {}),
            health: this.client, now: this.now,
            takePrefetchedUniversal: takePreflightHistory, preflightInputNeeded,
            ...(this.adapter.recognize ? { recognize: (carrier: string, number: string, context?: TrackingContext) =>
              once(recognitionKey('http', carrier, number), () => this.adapter.recognize!(carrier, number, context)) } : {}),
            ...(this.adapter.recognizeBrowser ? { recognizeBrowser: (carrier: string, number: string, context?: TrackingContext, previousError?: unknown) =>
              once(recognitionKey('browser', carrier, number), () => this.adapter.recognizeBrowser!(carrier, number, context, previousError)) } : {}),
            enablePostalNinja: process.env.TRACKING_ENABLE_POSTAL_NINJA === 'true',
          }).fetch(subject, context.trigger === 'scheduled', context.signal, addition)
          : await this.fetchResult(subject, carrierId, checks));
      } catch (error) {
        if (carrierId === 'amazon-shipping' && error instanceof CarrierError && error.reason === 'history_expired') {
          audit.skip('normalize', 'history_expired');
          audit.skip('persist_events', 'history_expired');
          await persist({ sync_status: 'unsupported', sync_error: AMAZON_HISTORY_EXPIRED, last_synced_at: this.now().toISOString() });
          await audit.finish({ outcome: 'unsupported' });
          return 'unsupported';
        }
        const hasProgress = previousStage !== 'pending';
        // The parcel's own carrier does not know it yet: fallback providers failing on the
        // same unannounced number is not an outage, and the routing state keeps their cooldowns.
        // Without a carrier to ask, every provider answering without history means the same.
        const failures = error instanceof RoutingDeferred ? Object.values(error.routing.failures) : [];
        const routingUnannounced = error instanceof RoutingDeferred
          && (Boolean(error.routing.provider_input_needed) || error.routing.failures[carrierId]?.kind === 'not_found'
            || (failures.length > 0 && failures.every((failure) => ['not_found', 'no_history', 'input_required'].includes(failure.kind))));
        if (!hasProgress && (isUnannouncedTrackingError(error) || routingUnannounced)) {
          // A carrier saying the label has no scans is an answer, not a missed check.
          if (error instanceof RoutingDeferred) error.routing.consecutive_failures = 0;
          audit.record('fetch', 'succeeded', performance.now() - fetchStartedAt, {
            disposition: 'unannounced', ...sharedAnswers(checks),
          });
          audit.skip('normalize', 'unannounced');
          audit.skip('persist_events', 'unannounced');
          operation = 'persist_package';
          await audit.step('persist_package', async () => {
            await persist({
              last_synced_at: this.now().toISOString(),
              sync_status: 'waiting',
              sync_error: null,
              ...(error instanceof RoutingDeferred ? { carrier_data: {
                ...(isRecord(parcel.carrier_data) ? parcel.carrier_data : {}), routing: error.routing,
              } } : {}),
            });
          });
          await audit.finish({
            outcome: 'waiting',
            sourceCarrier: carrierId,
            eventsReceived: 0,
            eventsNormalized: 0,
          });
          return 'waiting';
        }
        audit.record('fetch', 'failed', performance.now() - fetchStartedAt,
          { ...(error instanceof RoutingDeferred ? deferredFetchDetails(error) : {}), ...sharedAnswers(checks) }, error);
        throw error;
      }

      ({ result, sourceCarrierId } = fetched);
      const { swissPostReady, handoffFallbackErrorType } = fetched;
      audit.record('fetch', 'succeeded', performance.now() - fetchStartedAt, {
        source_carrier: sourceCarrierId,
        swiss_post_ready: swissPostReady,
        handoff_fallback_error_type: handoffFallbackErrorType,
        ...sharedAnswers(checks),
      });

      operation = 'normalize';
      const normalized = await audit.step('normalize', () => {
        const normalizedEvents = buildEvents(parcel, result!, sourceCarrierId!, now);
        const normalizedReportedStage = resultStage(result!);
        const latestEvent = [...normalizedEvents].sort(
          (left, right) => String(right.occurred_at).localeCompare(String(left.occurred_at)),
        )[0];
        const latestEventStage = latestEvent ? String(latestEvent.stage) : null;
        // A provider's explicit non-pending summary can be newer than its last
        // timestamped milestone. Timed progress remains authoritative only
        // while the provider's summary is still pending.
        const normalizedSelectedStage = normalizedReportedStage && result!.status !== 'pending'
          ? normalizedReportedStage
          : latestEventStage ?? normalizedReportedStage;
        return {
          events: [
            ...(fetched.earlierResult && fetched.earlierCarrierId
              ? buildEvents(parcel, fetched.earlierResult, fetched.earlierCarrierId, now) : []),
            ...normalizedEvents,
          ],
          reportedStage: normalizedReportedStage,
          selectedStage: normalizedSelectedStage,
        };
      }, (value) => ({
        events_received: result?.events?.length ?? 0,
        events_normalized: value.events.length,
        provider_status: result?.status ?? 'unknown',
        reported_stage: value.reportedStage,
        selected_stage: value.selectedStage,
      }));
      events = normalized.events;
      reportedStage = normalized.reportedStage;
      selectedStage = normalized.selectedStage;
      const previousRouting = routingState(parcel);
      anomalies = detectSyncAnomalies(
        parcel,
        result,
        events,
        sourceCarrierId,
        selectedStage,
        now,
      );
      const universalProgressMissing = anomalies.includes('progress_disappeared')
        && typeof result.tracking_provider === 'string' && !directCarrier(String(parcel.carrier));
      const missedChecks = isRecord(result.routing) ? Number(result.routing.consecutive_failures) : previousRouting.consecutive_failures + 1;
      const lastSuccess = Date.parse(previousRouting.last_success_at ?? '');
      const recentProgress = Number.isFinite(lastSuccess) && now.getTime() - lastSuccess < freshnessWindow(now);
      // Thin answers use the same failure threshold as exhausted lookups.
      // They do not count as successful checks or reset the failure streak.
      if (universalProgressMissing && (missedChecks < 2 || recentProgress)) {
        anomalies = anomalies.map((code) => code === 'progress_disappeared' ? 'fallback_without_progress' : code);
      }

      const deleteDescriptions = sourceCarrierId === 'swiss-post' && (result.events?.length ?? 0) > 0
        ? [
          'TO_BE_DELIVERED', 'REPORTED', 'IN_DELIVERY', 'DELIVERED',
          'MISSED_DELIVERY', 'NOT_DELIVERED', 'RETURNED', 'CUSTOMS', 'REGISTERED',
        ] : [];
      const hasUpdate = Boolean(
        (selectedStage && selectedStage !== 'pending')
        || events.some((event) => event.stage !== 'pending'),
      );
      const handoff = supportsSwissPostHandoff(String(parcel.tracking_number ?? ''));
      const knownUpdate = hasUpdate || Boolean(handoff && swissPostReady);
      const progressDisappeared = anomalies.includes('progress_disappeared');
      // A fallback that knows less is no error: what is saved stays, as with an older snapshot.
      const fallbackWithoutProgress = anomalies.includes('fallback_without_progress');
      const keepSaved = progressDisappeared || fallbackWithoutProgress;
      // A reworded scan (DPD with and without the postcode) updates its stored row in place,
      // and a scan both a carrier and a universal provider reported is stored once.
      // A handoff's batch also carries the earlier carrier's scans, under that carrier's policy.
      const stored = storedEventIdentities(parcel);
      const reworded = sameInstantIdentities(events, stored, sourceCarrierId);
      if (fetched.earlierResult && fetched.earlierCarrierId && fetched.earlierCarrierId !== sourceCarrierId) {
        const taken = new Set(reworded.values());
        for (const [id, saved] of sameInstantIdentities(events, stored, fetched.earlierCarrierId)) {
          if (!taken.has(saved)) reworded.set(id, saved);
        }
      }
      const shared = sharedScans(events, stored, reworded);
      const matches = { reused: new Map([...reworded, ...shared.reused]), skipped: shared.skipped };
      // Copies a universal provider read in the wrong zone must not make a result
      // look fresher, or the carrier's own reply older, than it is.
      const previousEventTime = withoutCopyDrift(
        Date.parse(previousRouting.last_event_at ?? ''), events, stored, matches, { withStored: true },
      );
      // Read as routing wrote the watermark: a naive local clock in its source's zone.
      const returnedEventTime = withoutCopyDrift(
        Date.parse(eventTimestamp(result.last_update, resultTimezone(sourceCarrierId, result)) ?? ''), events, stored, matches,
      );
      const olderSnapshot = Number.isFinite(previousEventTime) && Number.isFinite(returnedEventTime)
        && returnedEventTime < previousEventTime;
      const previousData = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
      // UPU wall time cannot prove freshness against another source. It may
      // establish initial progress, or update its own saved local-time summary.
      const unprovenUpuSummary = result.tracking_provider === 'UPU' && (
        (previousStage !== 'pending' && previousData.tracking_provider !== 'UPU')
        || (previousData.tracking_provider === 'UPU' && typeof previousData.last_update_local === 'string'
          && String(result.last_update_local ?? '') < previousData.last_update_local)
      );
      const localOnlyFallback = result.direct_local_fallback === true && hasUnresolvedDirectCurrent(sourceCarrierId, result);
      const previousLocalHistory = isRecord(previousData.direct_local_history) ? previousData.direct_local_history : {};
      const sameLocalSource = previousData.direct_local_fallback === true
        && previousLocalHistory.carrier === sourceCarrierId && previousLocalHistory.number === directHistoryNumber(parcel, result);
      const unprovenLocalSummary = localOnlyFallback && (
        (previousStage !== 'pending' && !sameLocalSource)
        || (sameLocalSource && result.summary_only === true && Array.isArray(previousLocalHistory.events) && previousLocalHistory.events.length > 0)
        || (sameLocalSource && directLocalSnapshotIsOlder(previousLocalHistory, result))
      );
      const preserveSummary = keepSaved || olderSnapshot || unprovenUpuSummary || unprovenLocalSummary
        || (['delivered', 'returned'].includes(previousStage) && selectedStage !== previousStage);
      const carrierData: JsonObject = Object.fromEntries(
        Object.entries(result).filter(([key, value]) => key !== 'events' && value != null),
      );
      // The saved watermark takes the same correction, so later replies are compared with the carrier's clock.
      const routing = isRecord(result.routing) ? { ...result.routing } : null;
      if (routing) {
        // A fallback's scan that is kept out must not make the carrier's next reply look older.
        const keepWatermark = olderSnapshot || keepSaved;
        const watermark = keepWatermark ? previousEventTime : withoutCopyDrift(
          Date.parse(String(routing.last_event_at ?? '')), events, stored, matches, { also: [returnedEventTime,
            fetched.earlierResult ? latestResultTime(fetched.earlierResult, fetched.earlierCarrierId ?? sourceCarrierId) : Number.NaN] },
        );
        const saved = keepWatermark ? previousRouting.last_event_at : routing.last_event_at;
        if (Number.isFinite(watermark) && Date.parse(String(saved ?? '')) !== watermark) routing.last_event_at = new Date(watermark).toISOString();
        else if (saved !== undefined || keepWatermark) routing.last_event_at = saved;
        carrierData.routing = routing;
      }
      const postalHistory = upuHistory(parcel, result, now);
      if (postalHistory) carrierData.upu_history = postalHistory;
      const localHistory = directLocalHistory(parcel, result);
      if (localHistory) carrierData.direct_local_history = localHistory;
      // Linked journey identity belongs to the parcel, not an individual carrier response.
      if (isRecord(parcel.carrier_data)) {
        for (const key of ['lookup_country_hint', 'original_carrier', 'original_tracking_number', 'original_tracking_url', 'original_package_id', 'active_tracking_carrier', 'active_tracking_number', 'original_canonical_tracking_number', 'auto_changed_from', 'auto_changed_to', 'auto_changed_at']) {
          if (parcel.carrier_data[key] != null && carrierData[key] == null) carrierData[key] = parcel.carrier_data[key];
        }
      }
      // Some carrier endpoints omit sender details on subsequent updates.
      const previousSender = isRecord(parcel.carrier_data) ? parcel.carrier_data.sender_name : undefined;
      if (result.sender_name === undefined && typeof previousSender === 'string') {
        carrierData.sender_name = previousSender;
      }
      if (handoff) {
        carrierData.active_tracking_carrier = sourceCarrierId;
        carrierData.swiss_post_ready = swissPostReady;
      }
      const values: JsonObject = {
        last_synced_at: this.now().toISOString(),
        sync_status: progressDisappeared ? 'error' : knownUpdate || fallbackWithoutProgress ? 'ok' : 'waiting',
        sync_error: progressDisappeared
          ? 'The carrier temporarily returned no tracking progress. Previous tracking details have been kept.'
          : null,
      };
      if (routing) {
        values.carrier_data = { ...(isRecord(parcel.carrier_data) ? parcel.carrier_data : {}), routing };
      }
      // A verified partner can confirm the same completed milestone with a
      // different timestamp. Keep the saved summary/watermark, but retain the
      // newly verified route and both event histories.
      if (preserveSummary && fetched.earlierCarrierId && result.original_carrier) {
        const data = isRecord(values.carrier_data) ? values.carrier_data : isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
        const preservedData = { ...data };
        for (const key of ['lookup_country_hint', 'original_carrier', 'original_tracking_number', 'original_tracking_url',
          'original_canonical_tracking_number', 'active_tracking_carrier', 'active_tracking_number']) {
          if (carrierData[key] != null) preservedData[key] = carrierData[key];
        }
        values.carrier_data = preservedData;
      }
      if (preserveSummary && isRecord(result.delivery_probe)) {
        values.carrier_data = {
          ...(isRecord(values.carrier_data) ? values.carrier_data : isRecord(parcel.carrier_data) ? parcel.carrier_data : {}),
          delivery_probe: result.delivery_probe,
        };
      }
      if (!preserveSummary) {
        values.last_status_text = result.last_status_text || null;
        values.expected_delivery = result.expected_delivery ? String(result.expected_delivery) : null;
        values.carrier_data = carrierData;
        if (selectedStage && (hasUpdate || !swissPostReady)) {
          // A carrier the router swapped to may rightly know less than a mistaken one did.
          values.current_stage = fetched.correction ? selectedStage : stageToSave(previousStage, selectedStage);
          if (values.current_stage !== selectedStage) anomalies = [...anomalies, 'early_stage_regression'];
        }
      }
      if (preserveSummary && postalHistory) {
        values.carrier_data = {
          ...(isRecord(values.carrier_data) ? values.carrier_data : previousData), upu_history: postalHistory,
        };
      }
      if (preserveSummary && localHistory) {
        values.carrier_data = {
          ...(isRecord(values.carrier_data) ? values.carrier_data : previousData), direct_local_history: localHistory,
        };
      }
      if (fetched.correction && !preserveSummary) {
        values.carrier = fetched.correction.carrier;
        values.tracking_url = fetched.correction.trackingUrl;
        values.dpd_postcode = fetched.correction.postcode;
      } else if (fetched.correction && isRecord(values.carrier_data) && isRecord(values.carrier_data.routing)) {
        // A rejected/older summary must not advertise a swap that was not saved.
        values.carrier_data.routing.configured_carrier = carrierId;
      }
      const eventsToPersist = keepSaved || (preserveSummary && (result.tracking_provider === 'UPU' || localOnlyFallback)) ? [] : events;
      const persistedIds = new Set(eventsToPersist.map((event) => String(event.provider_event_id)));
      const persistedEvents = withIdentities(
        eventsToPersist.filter((event) => !matches.skipped.has(String(event.provider_event_id))), matches.reused,
      );
      // A scan already stored is rewritten in place, which is no news.
      const storedIds = new Set(stored.map((event) => String(event.provider_event_id)));
      const eventsNew = persistedEvents.filter((event) => !storedIds.has(String(event.provider_event_id))).length;
      const news = eventsNew > 0 || (values.current_stage !== undefined && values.current_stage !== previousStage);
      const outcome = progressDisappeared ? 'error'
        : !knownUpdate || fallbackWithoutProgress ? 'waiting' : news ? 'updated' : 'unchanged';
      operation = 'persist_package';
      await audit.step('persist_package', async () => {
        await persist(values, persistedEvents, keepSaved ? [] : deleteDescriptions);
      }, () => ({
        outcome,
        selected_stage: selectedStage,
      }));
      // A correction to the carrier detection names is expected: it is logged without an issue.
      if (values.carrier) reportRoutingEvent('carrier_auto_swapped', {
        carrier: carrierId, provider: String(values.carrier), trackingNumber: String(parcel.tracking_number ?? ''), attemptId: audit.attemptId,
        ...(detectionNames(String(parcel.tracking_number ?? ''), String(values.carrier)) ? { category: 'detected' } : {}),
      });
      audit.record('persist_events', 'succeeded', 0, {
        events_persisted: persistedEvents.length,
        events_new: eventsNew,
        identities_reused: [...matches.reused.keys()].filter((id) => persistedIds.has(id)).length,
        copies_skipped: [...matches.skipped.keys()].filter((id) => persistedIds.has(id)).length,
        atomic_with_package: true,
      });
      // One scan from two sources on clocks a zone apart: a provider's clock the scraper should fix.
      if ([...shared.shifted].some((id) => persistedIds.has(id))) anomalies = [...anomalies, 'provider_clock_offset'];
      await this.recordStatusObservations(eventsToPersist, sourceCarrierId, context, new Map([...matches.reused, ...matches.skipped]), [
        ...(fetched.earlierResult && fetched.earlierCarrierId
          ? localStatusObservationEvents(parcel, fetched.earlierResult, fetched.earlierCarrierId) : []),
        ...localStatusObservationEvents(parcel, result, sourceCarrierId),
      ]);
      const completion = {
        outcome,
        sourceCarrier: sourceCarrierId,
        providerStatus: result.status ?? 'unknown',
        reportedStage,
        selectedStage,
        statusText: result.last_status_text,
        eventsReceived: result.events?.length ?? 0,
        eventsNormalized: events.length,
        eventsNew,
        anomalyCodes: anomalies,
        supportEvidence: trackingSupportEvidence(parcel, result, sourceCarrierId, outcome, preserveSummary),
      } as const;
      await audit.finish(completion);
      audit.reportAnomalies(anomalies, completion);
      return outcome === 'error' ? 'errors' : outcome;
    } catch (error) {
      context.signal?.throwIfAborted();
      if (error instanceof SupersededTrackingSync) return superseded();
      if (error instanceof RoutingDeferred) {
        try {
          await persist({ last_synced_at: this.now().toISOString(),
            sync_status: error.stale ? 'error' : previousStage === 'pending' ? 'waiting' : 'ok',
            sync_error: error.stale ? deferredTrackingFailure(error.routing.failures, carrierId) ?? error.message : null,
            carrier_data: { ...(isRecord(parcel.carrier_data) ? parcel.carrier_data : {}), routing: error.routing },
          });
        } catch (persistenceError) {
          if (persistenceError instanceof SupersededTrackingSync) return superseded();
          audit.reportError(persistenceError, 'persist_routing_state');
          throw persistenceError;
        }
        // A check that contacted nobody says nothing about provider health.
        // Keep the failure evidence even while the parcel's error chip is suppressed.
        await audit.finish({ outcome: error.stale ? 'error' : 'waiting', sourceCarrier: carrierId,
          evaluateHealth: error.attempted > 0, error });
        return error.stale ? 'errors' : 'waiting';
      }
      let message = error instanceof Error ? error.message.trim() || error.name : String(error);
      if (error instanceof SyntaxError) {
        message = 'The carrier returned a maintenance page instead of tracking data.';
      }
      try {
        await audit.step('persist_package', async () => {
          await persist({
            last_synced_at: this.now().toISOString(),
            sync_status: 'error',
            sync_error: trackingFailureCode(error) ?? message.slice(0, 500),
          });
        }, () => ({ purpose: 'record_error' }));
      } catch (persistenceError) {
        if (persistenceError instanceof SupersededTrackingSync) return superseded();
        audit.reportError(error, operation);
        audit.reportError(persistenceError, 'persist_error_state');
        await audit.finish({
          outcome: 'error',
          sourceCarrier: sourceCarrierId,
          providerStatus: result?.status ?? null,
          reportedStage,
          selectedStage,
          statusText: result?.last_status_text,
          eventsReceived: result?.events?.length ?? 0,
          eventsNormalized: events.length,
          anomalyCodes: anomalies,
          error,
        });
        throw persistenceError;
      }
      audit.reportError(error, operation);
      await audit.finish({
        outcome: 'error',
        sourceCarrier: sourceCarrierId,
        providerStatus: result?.status ?? null,
        reportedStage,
        selectedStage,
        statusText: result?.last_status_text,
        eventsReceived: result?.events?.length ?? 0,
        eventsNormalized: events.length,
        anomalyCodes: anomalies,
        error,
      });
      return 'errors';
    }
  }

  /** A carrier lookup, asked once per run for the same carrier, number and inputs. */
  private fetchCarrier(checks: ParcelLookups | undefined, carrierId: string, trackingNumber: string,
    trackingUrl: string | null, dpdPostcode: string | null): Promise<CarrierResult> {
    const lookup = () => this.adapter.fetch(carrierId, trackingNumber, trackingUrl, dpdPostcode);
    return checks ? checks.once(carrierLookupKey(carrierId, trackingNumber, trackingUrl, dpdPostcode), lookup) : lookup();
  }

  private async fetchResult(
    parcel: JsonObject,
    carrierId: string,
    checks?: ParcelLookups,
  ): Promise<{
    result: CarrierResult;
    sourceCarrierId: string;
    swissPostReady: boolean | null;
    handoffFallbackErrorType: string | null;
    earlierResult?: CarrierResult;
    earlierCarrierId?: string;
  }> {
    const trackingNumber = String(parcel.tracking_number ?? '');
    const metadata = isRecord(parcel.carrier_data) ? parcel.carrier_data : {};
    const legacySwissReady = metadata.swiss_post_ready === true && supportsSwissPostHandoff(trackingNumber)
      && ['swiss-post', 'aliexpress', 'intl-post'].includes(carrierId);
    const activeCarrier = typeof metadata.active_tracking_carrier === 'string' ? metadata.active_tracking_carrier
      : legacySwissReady ? 'swiss-post' : '';
    const activeNumber = typeof metadata.active_tracking_number === 'string' ? metadata.active_tracking_number : trackingNumber;
    if ((metadata.original_carrier || legacySwissReady) && hasDirectHandoffAdapter(activeCarrier, activeNumber)) {
      return {
        result: normalizeCarrierResult(await this.fetchCarrier(checks, activeCarrier, activeNumber, null, null)),
        sourceCarrierId: activeCarrier, swissPostReady: activeCarrier === 'swiss-post' ? true : null, handoffFallbackErrorType: null,
      };
    }
    // Cainiao remains a fallback for an explicitly selected Swiss postal route.
    // An issuer suffix must not choose the delivery partner for other carriers.
    if (!supportsSwissPostHandoff(trackingNumber) || carrierId !== 'swiss-post') {
      let origin: CarrierResult;
      let originError: unknown;
      let savedPartner: DeliveryHandoff | null = null;
      try {
        origin = normalizeCarrierResult(await this.fetchCarrier(checks,
          carrierId, trackingNumber,
          typeof parcel.tracking_url === 'string' ? parcel.tracking_url : null,
          typeof parcel.dpd_postcode === 'string' ? parcel.dpd_postcode : null,
        ));
      } catch (error) {
        // An international operator outage must not hide a confirmed local delivery.
        savedPartner = deliveryHandoff(carrierId, trackingNumber, metadata);
        if (!savedPartner) throw error;
        originError = error;
        origin = { delivery_carrier: savedPartner.carrier, delivery_tracking_number: savedPartner.number };
      }
      let fallbackError: string | null = null;
      const candidate = savedPartner ?? deliveryHandoff(carrierId, trackingNumber, origin);
      const previousProbe = candidate ? previousDeliveryProbe(parcel, candidate.carrier, candidate.number) : null;
      const originUpdate = typeof origin.last_update === 'string' ? origin.last_update : previousProbe?.origin_update ?? null;
      const sinceProbe = previousProbe ? this.now().getTime() - Date.parse(previousProbe.at) : Number.NaN;
      const askedRecently = previousProbe !== null && originUpdate === previousProbe.origin_update
        && sinceProbe >= 0 && sinceProbe < DELIVERY_PROBE_INTERVAL_MS;
      if (candidate && askedRecently) {
        // carrier_data is rebuilt from the result on every refresh: carry the marker forward.
        origin.delivery_probe = { ...previousProbe, carrier: candidate.carrier, number: candidate.number };
      } else if (candidate) {
        origin.delivery_probe = { at: this.now().toISOString(), origin_update: originUpdate, carrier: candidate.carrier, number: candidate.number };
        try {
          const delivery = normalizeCarrierResult(await this.fetchCarrier(checks, candidate.carrier, candidate.number, null, null));
          const originTime = latestResultTime(origin, carrierId);
          const watermark = Math.max(originTime, latestResultTime(metadata, carrierId),
            Date.parse(routingState(parcel).last_event_at || '') || 0);
          const terminal = ['delivered', 'returned'].find((stage) => stage === resultStage(origin) || stage === parcel.current_stage);
          const deliveryTime = latestResultTime(delivery, candidate.carrier);
          // Origin feeds sometimes re-stamp the partner's local completion
          // time with another offset. Explicit, same-day terminal agreement
          // confirms the route without rewriting either provider's timestamps.
          const sameCompletion = terminal && resultStage(origin) === terminal
            && resultStage(delivery) === terminal && deliveryTime > 0 && originTime > 0
            && new Date(deliveryTime).toISOString().slice(0, 10) === new Date(originTime).toISOString().slice(0, 10)
            && new Date(watermark).toISOString().slice(0, 10) === new Date(originTime).toISOString().slice(0, 10);
          if (delivery.status !== 'pending' && !['pending', 'registered'].includes(resultStage(delivery) ?? 'pending')
            && (candidate.basis !== 'destination' || deliveryTime > 0)
            && resultHasUpdate(delivery) && (deliveryTime >= watermark || sameCompletion)
            && (!terminal || resultStage(delivery) === terminal)) {
            // The local delivery hides the origin failure from the router, which reports every other one.
            if (originError && !isUnannouncedTrackingError(originError)) reportRoutingEvent('provider_failed', {
              carrier: carrierId, provider: carrierId, trackingNumber, category: routingFailure(originError).kind,
              errorClass: errorType(originError), error: originError,
            });
            return {
              result: {
                ...delivery, active_tracking_carrier: candidate.carrier,
                active_tracking_number: delivery.canonical_tracking_number || candidate.number,
                ...(origin.canonical_tracking_number ? { original_canonical_tracking_number: origin.canonical_tracking_number } : {}),
                original_carrier: carrierId, original_tracking_number: trackingNumber,
                original_tracking_url: typeof parcel.tracking_url === 'string' ? parcel.tracking_url : null,
                ...(delivery.sender_name === undefined && origin.sender_name ? { sender_name: origin.sender_name } : {}),
              },
              sourceCarrierId: candidate.carrier, swissPostReady: candidate.carrier === 'swiss-post' ? true : null, handoffFallbackErrorType: null,
              earlierResult: origin, earlierCarrierId: carrierId,
            };
          }
        } catch (error) {
          fallbackError = errorType(error);
          if (!isUnannouncedTrackingError(error)) reportRoutingEvent('provider_failed', {
            carrier: carrierId, provider: candidate.carrier, trackingNumber, category: routingFailure(error).kind,
            errorClass: fallbackError, error,
          });
        }
      }
      if (originError) throw originError;
      return {
        result: origin, sourceCarrierId: carrierId,
        swissPostReady: null, handoffFallbackErrorType: fallbackError,
      };
    }
    const wasReady = isRecord(parcel.carrier_data) && parcel.carrier_data.swiss_post_ready === true;
    if (wasReady) {
      const result = await this.fetchCarrier(checks, 'swiss-post', trackingNumber, null, null);
      return {
        result: normalizeCarrierResult(result),
        sourceCarrierId: 'swiss-post',
        swissPostReady: true,
        handoffFallbackErrorType: null,
      };
    }
    let handoffFallbackErrorType: string | null = null;
    try {
      const swiss = normalizeCarrierResult(
        await this.fetchCarrier(checks, 'swiss-post', trackingNumber, null, null),
      );
      if (resultHasUpdate(swiss)) {
        return {
          result: swiss,
          sourceCarrierId: 'swiss-post',
          swissPostReady: true,
          handoffFallbackErrorType: null,
        };
      }
    } catch (error) {
      handoffFallbackErrorType = errorType(error);
      if (!isUnannouncedTrackingError(error)) reportRoutingEvent('provider_failed', {
        carrier: carrierId, provider: 'swiss-post', trackingNumber, category: routingFailure(error).kind,
      });
      // Cainiao still covers the international leg if Swiss Post is not ready.
    }
    const cainiao = await this.fetchCarrier(checks, 'aliexpress', trackingNumber, null, null);
    return {
      result: normalizeCarrierResult(cainiao),
      sourceCarrierId: 'aliexpress',
      swissPostReady: false,
      handoffFallbackErrorType,
    };
  }
}

/** The stored event identities a sync loader embedded; none when the parcel came from elsewhere. */
function storedEventIdentities(parcel: JsonObject): JsonObject[] {
  const stored = parcel[STORED_EVENT_IDENTITIES];
  return Array.isArray(stored) ? stored.filter(isRecord) : [];
}

export function fairSyncPackages(
  packages: JsonObject[],
  perOwnerLimit = MAX_PACKAGES_PER_OWNER_PER_SYNC,
): JsonObject[] {
  if (!Number.isInteger(perOwnerLimit) || perOwnerLimit < 1) {
    throw new TypeError('Per-owner synchronization limits must be positive');
  }
  const grouped = new Map<string, JsonObject[]>();
  for (const parcel of packages) {
    const owner = String(parcel.user_id ?? `legacy:${parcel.id}`);
    grouped.set(owner, [...(grouped.get(owner) ?? []), parcel]);
  }
  const served = new Map<string, number>();
  const active = [...grouped.keys()];
  const ordered: JsonObject[] = [];
  while (active.length > 0) {
    const owner = active.shift()!;
    const rows = grouped.get(owner)!;
    const count = served.get(owner) ?? 0;
    if (rows.length === 0 || count >= perOwnerLimit) continue;
    ordered.push(rows.shift()!);
    served.set(owner, count + 1);
    if (rows.length > 0 && count + 1 < perOwnerLimit) active.push(owner);
  }
  return ordered;
}
