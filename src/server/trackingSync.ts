import 'server-only';
import { deferredTrackingFailure, trackingFailureCode } from './trackingFailure';
import { AmazonShippingHistoryExpiredError } from './amazonShipping';
import { AMAZON_ACCOUNT_MESSAGE, AMAZON_HISTORY_EXPIRED, requiresAmazonAccount } from '../lib/amazon';

import { createHash } from 'node:crypto';
import { DateTime, IANAZone } from 'luxon';
import { STAGES } from '../generated/apiContract';
import type { CarrierResult } from './carrierResult';
import { normalizeCarrierResult } from './carrierResult';
import { swissPostHandoffNumber } from './carrierHandoff';
import {
  AUTOMATIC_CARRIER_IDS,
  carrierTimezone,
  supportsSwissPostHandoff,
} from './carriers';
import type { AdapterRegistry } from '@carriers/core/adapter';
import { runSteps } from '@carriers/core/runner';
import type { StepRecorder } from '@carriers/core/telemetry';
import { createAdapterRegistry, hostAdapterEnvironment } from './adapterRegistry';
import { hostStepRecorder } from './stepRecorder';
import { recordStatusMapping } from './metrics';
import { classifyWording, type ClassifiedWording } from '@carriers/core/status';
import type { Stage } from '@carriers/core/status';
import {
  captureOperationalError,
  errorType,
  logOperationalEvent,
  reportRoutingEvent,
} from './observability';
import type { CompositePushNotificationService } from './push';
import type { SupabaseServiceClient } from './supabase';
import {
  TrackingSyncAudit,
  type SyncAnomalyCode,
  type SyncRunContext,
} from './trackingAudit';
import { isRecord, type JsonObject } from './types';
import { UniversalTracker } from './universalTracking';
import type { UniversalSource } from './universalTrackingResult';
import { RoutingDeferred, routingFailure, routingState, TrackingRouter } from './trackingRouting';

const MAX_PACKAGES_PER_OWNER_PER_SYNC = 5;
const VALID_STAGES = new Set<string>(STAGES);
const SLOW_POLL_CARRIERS = new Set(['gls-de', 'gls-ch', 'gls-fr']);
const SLOW_POLL_INTERVAL_MS = 60 * 60 * 1_000;
const FAILED_SLOW_POLL_INTERVAL_MS = 4 * SLOW_POLL_INTERVAL_MS;

export function isTrackingSyncDue(parcel: JsonObject, now: Date): boolean {
  if (parcel.sync_status === 'unsupported' && parcel.carrier === 'amazon-shipping' && parcel.sync_error === AMAZON_HISTORY_EXPIRED) return false;
  if (parcel.sync_status === 'unsupported' && requiresAmazonAccount(String(parcel.carrier), String(parcel.tracking_number ?? ''))) return false;
  const routing = routingState(parcel);
  if (routing.next_check_at && Date.parse(routing.next_check_at) > now.getTime()) return false;
  const activeCarrier = isRecord(parcel.carrier_data) ? parcel.carrier_data.active_tracking_carrier : undefined;
  if (!SLOW_POLL_CARRIERS.has(String(activeCarrier ?? parcel.carrier))) return true;
  const lastChecked = Date.parse(String(parcel.last_synced_at ?? ''));
  if (!Number.isFinite(lastChecked)) return true;
  const interval = parcel.sync_status === 'error'
    ? FAILED_SLOW_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
  return now.getTime() >= lastChecked + interval;
}

function isScheduledTrackingSyncDue(parcel: JsonObject, now: Date): boolean {
  if (!isTrackingSyncDue(parcel, now)) return false;
  const lastChecked = Date.parse(String(parcel.last_synced_at ?? ''));
  if (!Number.isFinite(lastChecked)) return true;
  const local = DateTime.fromJSDate(now, { zone: 'Europe/Zurich' });
  const intervalMinutes = parcel.current_stage === 'out_for_delivery'
    ? 2 : parcel.carrier === 'spring-gds' ? 30 : 10;
  // Compare schedule windows so request duration does not skip the next tick.
  const windowStart = local.hour >= 8 && local.hour < 22
    ? local.startOf('minute').minus({ minutes: local.minute % intervalMinutes })
    : local.startOf('hour');
  return lastChecked < windowStart.toMillis();
}

export interface TrackingAdapter {
  fetchUniversal?(source: UniversalSource, trackingNumber: string, timeoutMs: number, dpdPostcode?: string | null): Promise<CarrierResult>;
  fetch(
    carrierId: string,
    trackingNumber: string,
    trackingUrl: string | null,
    dpdPostcode?: string | null,
  ): Promise<CarrierResult>;
}

/**
 * Lookups outrun any single provider timeout by a wide margin; the budget only
 * guards against an adapter that never settles.
 */
const SINGLE_STEP_BUDGET_MS = 120_000;

export class CarrierTrackingAdapter implements TrackingAdapter {
  constructor(
    readonly universal = new UniversalTracker({ environment: hostAdapterEnvironment() }),
    readonly registry: AdapterRegistry = createAdapterRegistry(),
    readonly recorder: StepRecorder = hostStepRecorder(),
  ) {}

  async fetchUniversal(source: UniversalSource, trackingNumber: string, timeoutMs: number, dpdPostcode?: string | null): Promise<CarrierResult> {
    return this.universal.fetchSource(source, trackingNumber, timeoutMs, dpdPostcode ?? null);
  }

  async fetch(
    carrierId: string,
    trackingNumber: string,
    trackingUrl: string | null,
    dpdPostcode?: string | null,
  ): Promise<CarrierResult> {
    const input = { number: trackingNumber, trackingUrl, postcode: dpdPostcode ?? null };
    const registered = this.registry.for(carrierId);
    if (registered) {
      // Adapters with several tiers run and report their own steps; a
      // single-step adapter is timed here so every lookup produces exactly one
      // step record and one lookup record.
      const result = registered.steps.length > 1
        ? await registered.track(input)
        : await runSteps({ carrier: carrierId, budgetMs: SINGLE_STEP_BUDGET_MS, recorder: this.recorder }, [
          { id: registered.steps[0] ?? 'direct', run: () => registered.track(input) },
        ]);
      return normalizeCarrierResult(result);
    }
    if (this.registry.adapterIdFor(carrierId) === 'universal') {
      return normalizeCarrierResult(await this.universal.fetch(trackingNumber, input.postcode));
    }
    throw new RangeError(`No tracking adapter is registered for ${carrierId}`);
  }
}

export interface SyncSummary extends JsonObject {
  checked: number;
  updated: number;
  waiting: number;
  errors: number;
  unsupported: number;
  superseded: number;
  notifications_sent: number;
  notification_errors: number;
  subscriptions_expired: number;
}

export function emptySyncSummary(): SyncSummary {
  return {
    checked: 0,
    updated: 0,
    waiting: 0,
    errors: 0,
    unsupported: 0,
    superseded: 0,
    notifications_sent: 0,
    notification_errors: 0,
    subscriptions_expired: 0,
  };
}

export type ClassifiedStage = ClassifiedWording;

/** The generic wording classifier, kept under its historical host name. */
export function classifyStage(text: string, fallback = 'in_transit'): ClassifiedStage {
  return classifyWording(text, fallback as Stage);
}

export function inferStage(text: string, fallback = 'in_transit'): string {
  return classifyStage(text, fallback).stage;
}

/**
 * Records where a persisted event's stage came from: an explicit carrier or
 * provider stage, the wording rule that matched, or the untraceable fallback.
 */
export function stageSource(declaredStage: string, description: string): string {
  if (VALID_STAGES.has(declaredStage)) return 'carrier_map';
  return classifyStage(description).source;
}

export function resultStage(result: CarrierResult): string | null {
  const declaredCurrent = String(result.current_stage ?? '');
  if (VALID_STAGES.has(declaredCurrent)) return declaredCurrent;
  const status = String(result.status ?? 'unknown');
  const text = String(result.last_status_text ?? '');
  switch (status) {
    case 'pending': {
      const inferred = inferStage(text, 'pending');
      if (inferred !== 'pending') return inferred;
      const declared = String(result.events?.[0]?.stage ?? '');
      return VALID_STAGES.has(declared) ? declared : 'pending';
    }
    case 'in_transit': return inferStage(text, 'in_transit');
    case 'out_for_delivery': return inferStage(text, 'out_for_delivery');
    case 'delivered': return inferStage(text, 'delivered');
    case 'exception': return inferStage(text, 'failed_attempt');
    default: return null;
  }
}

export function resultHasUpdate(result: CarrierResult): boolean {
  const stage = resultStage(result);
  if (stage && stage !== 'pending') return true;
  return (result.events ?? []).some((event) => {
    const declared = String(event.stage ?? '');
    if (VALID_STAGES.has(declared) && declared !== 'pending') return true;
    const description = String(event.description ?? '');
    return Boolean(description) && inferStage(description, 'pending') !== 'pending';
  });
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

function resultTimezone(carrierId: string, result: CarrierResult): string {
  const declared = typeof result.timezone === 'string' ? result.timezone : '';
  if (declared.length >= 1 && declared.length <= 64 && IANAZone.isValidZone(declared)) return declared;
  try {
    const configured = carrierTimezone(carrierId);
    return IANAZone.isValidZone(configured) ? configured : 'UTC';
  } catch {
    return 'UTC';
  }
}

const EVENT_FORMATS = [
  'yyyy-MM-dd HH:mm:ss',
  'yyyy-MM-dd HH:mm',
  'dd.MM.yyyy HH:mm:ss',
  'dd.MM.yyyy HH:mm',
  'dd/MM/yyyy HH:mm:ss',
  'dd/MM/yyyy HH:mm',
  'yyyy-MM-dd',
  'dd.MM.yyyy',
  'dd/MM/yyyy',
];

export function eventTimestamp(raw: unknown, assumedTimezone = 'UTC'): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim();
  let parsed = DateTime.fromISO(value, { setZone: true });
  if (parsed.isValid) {
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
      parsed = DateTime.fromISO(value, { zone: assumedTimezone });
    }
    return parsed.toUTC().toISO({ suppressMilliseconds: true }) ?? null;
  }
  for (const format of EVENT_FORMATS) {
    parsed = DateTime.fromFormat(value, format, { zone: assumedTimezone });
    if (parsed.isValid) return parsed.toUTC().toISO({ suppressMilliseconds: true }) ?? null;
  }
  return null;
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
  for (const raw of result.events ?? []) {
    const description = String(raw.description ?? 'Tracking update').trim();
    const location = String(raw.location ?? '').trim();
    const occurredAt = eventTimestamp(raw.time, timezone);
    if (!occurredAt) continue;
    const declaredStage = String(raw.stage ?? '');
    rows.push({
      package_id: parcel.id,
      // Historical scans must not inherit the shipment's current/final stage.
      stage: VALID_STAGES.has(declaredStage) ? declaredStage : inferStage(description),
      description,
      location: location || null,
      occurred_at: occurredAt,
      provider_event_id: providerEventId(carrierId, raw.time, location, description),
      raw_data: { ...raw, stage_source: stageSource(declaredStage, description) },
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
          stage_source: stageSource(String(result.current_stage ?? ''), description),
        },
      });
    }
  }
  const previousStage = String(parcel.current_stage ?? 'pending');
  const currentAlreadyTimed = rows.some((row) => row.stage === current);
  if (
    observedAt
    && !Number.isNaN(observedAt.getTime())
    && reportedCurrent !== null
    && (result.status !== 'pending' || rows.length === 0)
    && current !== 'pending'
    && current !== previousStage
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
        `observed:${previousStage}->${current}`,
        location,
        description,
      ),
      raw_data: {
        observed_without_provider_timestamp: true,
        stage_source: stageSource(
          VALID_STAGES.has(declaredCurrent) ? declaredCurrent : String(matchingEvent?.stage ?? ''),
          description,
        ),
      },
    });
  }
  return rows;
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
  const futureBoundary = now.getTime() + 24 * 60 * 60 * 1_000;
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
  if (previousStage !== 'pending' && !resultHasUpdate(result)) {
    anomalies.add('progress_disappeared');
  }
  return [...anomalies];
}

type SyncOutcome = 'updated' | 'waiting' | 'errors' | 'unsupported' | 'superseded';

class SupersededTrackingSync extends Error {}

export class TrackingSyncService {
  #tail: Promise<void> = Promise.resolve();
  #reportedObservationFailure = false;

  constructor(
    readonly client: SupabaseServiceClient,
    readonly adapter: TrackingAdapter = new CarrierTrackingAdapter(),
    readonly notifier: CompositePushNotificationService | null = null,
    readonly now: () => Date = () => new Date(),
  ) {}

  async sync(context: SyncRunContext = { trigger: 'scheduled' }): Promise<SyncSummary> {
    return await this.exclusive(async () => {
      context.signal?.throwIfAborted();
      const summary = emptySyncSummary();
      const due = (await this.client.listActivePackages())
        .filter((parcel) => isScheduledTrackingSyncDue(parcel, this.now()));
      for (const parcel of fairSyncPackages(due)) {
        summary.checked += 1;
        summary[await this.syncOne(parcel, context)] += 1;
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

  private async dispatchNotifications(summary: SyncSummary, signal?: AbortSignal): Promise<void> {
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
      summary.notification_errors += 1;
      captureOperationalError(error, { component: 'push', operation: 'dispatch' });
    }
  }

  // Unmapped carrier wording is review material, never a reason to fail a
  // refresh: a failed write is logged each time and reported to Sentry once.
  private async recordStatusObservations(
    events: JsonObject[],
    carrierId: string,
    context: SyncRunContext,
  ): Promise<void> {
    for (const event of events) {
      const raw = isRecord(event.raw_data) ? event.raw_data : {};
      if (typeof raw.stage_source === 'string') recordStatusMapping(carrierId, raw.stage_source);
    }
    const observations = collectStatusObservations(events, carrierId);
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

  private async syncOne(parcel: JsonObject, context: SyncRunContext): Promise<SyncOutcome> {
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

    const persist = async (
      values: JsonObject,
      newEvents: JsonObject[] = [],
      deleteDescriptions: string[] = [],
    ) => {
      context.signal?.throwIfAborted();
      const applied = context.lease
        ? await this.client.applyTrackingSync(parcel, values, newEvents, deleteDescriptions, context.lease)
        : await this.client.applyTrackingSync(parcel, values, newEvents, deleteDescriptions);
      if (!applied) {
        throw new SupersededTrackingSync('Tracking configuration changed during the check');
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
      try {
        fetched = this.adapter.fetchUniversal && carrierId !== 'amazon-shipping'
          ? await new TrackingRouter({
            direct: (candidate, carrier) => this.fetchResult(candidate, carrier),
            universal: (source, number, timeout, postcode) => this.adapter.fetchUniversal!(source, number, timeout, postcode),
            health: this.client, now: this.now,
            enablePostalNinja: process.env.TRACKING_ENABLE_POSTAL_NINJA === 'true',
          }).fetch(parcel, context.trigger === 'scheduled', context.signal)
          : await this.fetchResult(parcel, carrierId);
      } catch (error) {
        if (carrierId === 'amazon-shipping' && error instanceof AmazonShippingHistoryExpiredError) {
          audit.skip('normalize', 'history_expired');
          audit.skip('persist_events', 'history_expired');
          await persist({ sync_status: 'unsupported', sync_error: AMAZON_HISTORY_EXPIRED, last_synced_at: this.now().toISOString() });
          await audit.finish({ outcome: 'unsupported' });
          return 'unsupported';
        }
        const hasProgress = previousStage !== 'pending';
        if (!hasProgress && isUnannouncedTrackingError(error)) {
          audit.record('fetch', 'succeeded', performance.now() - fetchStartedAt, {
            disposition: 'unannounced',
          });
          audit.skip('normalize', 'unannounced');
          audit.skip('persist_events', 'unannounced');
          operation = 'persist_package';
          await audit.step('persist_package', async () => {
            await persist({
              last_synced_at: this.now().toISOString(),
              sync_status: 'waiting',
              sync_error: null,
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
        audit.record('fetch', 'failed', performance.now() - fetchStartedAt, {}, error);
        throw error;
      }

      ({ result, sourceCarrierId } = fetched);
      const { swissPostReady, handoffFallbackErrorType } = fetched;
      audit.record('fetch', 'succeeded', performance.now() - fetchStartedAt, {
        source_carrier: sourceCarrierId,
        swiss_post_ready: swissPostReady,
        handoff_fallback_error_type: handoffFallbackErrorType,
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
      anomalies = detectSyncAnomalies(
        parcel,
        result,
        events,
        sourceCarrierId,
        selectedStage,
        now,
      );

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
      const previousRouting = routingState(parcel);
      const previousEventTime = Date.parse(previousRouting.last_event_at ?? '');
      const returnedEventTime = Date.parse(String(result.last_update ?? ''));
      const olderSnapshot = Number.isFinite(previousEventTime) && Number.isFinite(returnedEventTime)
        && returnedEventTime < previousEventTime;
      const preserveSummary = progressDisappeared || olderSnapshot
        || (['delivered', 'returned'].includes(previousStage) && selectedStage !== previousStage);
      const carrierData: JsonObject = Object.fromEntries(
        Object.entries(result).filter(([key, value]) => key !== 'events' && value != null),
      );
      // Linked journey identity belongs to the parcel, not an individual carrier response.
      if (isRecord(parcel.carrier_data)) {
        for (const key of ['original_carrier', 'original_tracking_number', 'original_tracking_url', 'original_package_id', 'active_tracking_carrier', 'active_tracking_number', 'original_canonical_tracking_number', 'auto_changed_from', 'auto_changed_to', 'auto_changed_at']) {
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
        sync_status: progressDisappeared ? 'error' : knownUpdate ? 'ok' : 'waiting',
        sync_error: progressDisappeared
          ? 'The carrier temporarily returned no tracking progress. Previous tracking details have been kept.'
          : null,
      };
      if (isRecord(result.routing)) {
        values.carrier_data = { ...(isRecord(parcel.carrier_data) ? parcel.carrier_data : {}), routing: {
          ...result.routing,
          ...(olderSnapshot ? { last_event_at: previousRouting.last_event_at } : {}),
        } };
      }
      if (!preserveSummary) {
        values.last_status_text = result.last_status_text || null;
        values.expected_delivery = result.expected_delivery ? String(result.expected_delivery) : null;
        values.carrier_data = carrierData;
        if (selectedStage && (hasUpdate || !swissPostReady)) values.current_stage = selectedStage;
      }
      if (fetched.correction && !preserveSummary) {
        values.carrier = fetched.correction.carrier;
        values.tracking_url = fetched.correction.trackingUrl;
        values.dpd_postcode = fetched.correction.postcode;
      } else if (fetched.correction && isRecord(values.carrier_data) && isRecord(values.carrier_data.routing)) {
        // A rejected/older summary must not advertise a swap that was not saved.
        values.carrier_data.routing.configured_carrier = carrierId;
      }
      const outcome = progressDisappeared ? 'error' : knownUpdate ? 'updated' : 'waiting';
      const eventsToPersist = progressDisappeared ? [] : events;
      operation = 'persist_package';
      await audit.step('persist_package', async () => {
        await persist(values, eventsToPersist, progressDisappeared ? [] : deleteDescriptions);
      }, () => ({
        outcome,
        selected_stage: selectedStage,
      }));
      if (values.carrier) reportRoutingEvent('carrier_auto_swapped', {
        carrier: carrierId, provider: String(values.carrier), trackingNumber: String(parcel.tracking_number ?? ''),
      });
      audit.record('persist_events', 'succeeded', 0, {
        events_persisted: eventsToPersist.length,
        atomic_with_package: true,
      });
      await this.recordStatusObservations(eventsToPersist, sourceCarrierId, context);
      const completion = {
        outcome,
        sourceCarrier: sourceCarrierId,
        providerStatus: result.status ?? 'unknown',
        reportedStage,
        selectedStage,
        statusText: result.last_status_text,
        eventsReceived: result.events?.length ?? 0,
        eventsNormalized: events.length,
        anomalyCodes: anomalies,
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
        await audit.finish({ outcome: error.stale ? 'error' : 'waiting', sourceCarrier: carrierId });
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

  private async fetchResult(
    parcel: JsonObject,
    carrierId: string,
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
    if (metadata.original_carrier && metadata.active_tracking_carrier === 'swiss-post') {
      return {
        result: normalizeCarrierResult(await this.adapter.fetch('swiss-post', typeof metadata.active_tracking_number === 'string' ? metadata.active_tracking_number : trackingNumber, null, null)),
        sourceCarrierId: 'swiss-post', swissPostReady: true, handoffFallbackErrorType: null,
      };
    }
    if (!supportsSwissPostHandoff(trackingNumber)) {
      let origin: CarrierResult;
      let originError: unknown;
      try {
        origin = normalizeCarrierResult(await this.adapter.fetch(
          carrierId, trackingNumber,
          typeof parcel.tracking_url === 'string' ? parcel.tracking_url : null,
          typeof parcel.dpd_postcode === 'string' ? parcel.dpd_postcode : null,
        ));
      } catch (error) {
        // An international operator outage must not hide a confirmed local delivery.
        if (!swissPostHandoffNumber(carrierId, trackingNumber, {})) throw error;
        if (!isUnannouncedTrackingError(error)) reportRoutingEvent('provider_failed', {
          carrier: carrierId, provider: carrierId, trackingNumber, category: routingFailure(error).kind,
        });
        originError = error;
        origin = {};
      }
      let fallbackError: string | null = null;
      const deliveryNumber = swissPostHandoffNumber(carrierId, trackingNumber, origin);
      if (deliveryNumber
        && !['delivered', 'returned'].includes(resultStage(origin) ?? '')) {
        try {
          const delivery = normalizeCarrierResult(await this.adapter.fetch('swiss-post', deliveryNumber, null, null));
          if (delivery.status !== 'pending' && !['pending', 'registered'].includes(resultStage(delivery) ?? 'pending') && resultHasUpdate(delivery)) {
            return {
              result: {
                ...delivery, active_tracking_carrier: 'swiss-post',
                active_tracking_number: delivery.canonical_tracking_number || deliveryNumber,
                ...(origin.canonical_tracking_number ? { original_canonical_tracking_number: origin.canonical_tracking_number } : {}),
                original_carrier: carrierId, original_tracking_number: trackingNumber,
                original_tracking_url: typeof parcel.tracking_url === 'string' ? parcel.tracking_url : null,
                ...(delivery.sender_name === undefined && origin.sender_name ? { sender_name: origin.sender_name } : {}),
              },
              sourceCarrierId: 'swiss-post', swissPostReady: true, handoffFallbackErrorType: null,
              earlierResult: origin, earlierCarrierId: carrierId,
            };
          }
        } catch (error) {
          fallbackError = errorType(error);
          if (!isUnannouncedTrackingError(error)) reportRoutingEvent('provider_failed', {
            carrier: carrierId, provider: 'swiss-post', trackingNumber, category: routingFailure(error).kind,
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
      const result = await this.adapter.fetch('swiss-post', trackingNumber, null, null);
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
        await this.adapter.fetch('swiss-post', trackingNumber, null, null),
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
    const cainiao = await this.adapter.fetch('aliexpress', trackingNumber, null, null);
    return {
      result: normalizeCarrierResult(cainiao),
      sourceCarrierId: 'aliexpress',
      swissPostReady: false,
      handoffFallbackErrorType,
    };
  }
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
