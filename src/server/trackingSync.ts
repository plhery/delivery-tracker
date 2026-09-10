import 'server-only';
import { AmazonShippingHistoryExpiredError, AmazonShippingTracker } from './amazonShipping';
import { AMAZON_ACCOUNT_MESSAGE, AMAZON_HISTORY_EXPIRED, requiresAmazonAccount } from '../lib/amazon';
import { trackingLanguageStage } from './trackingLanguage';

import { createHash } from 'node:crypto';
import { DateTime, IANAZone } from 'luxon';
import { STAGES } from '../generated/apiContract';
import type { CarrierResult } from './carrierResult';
import { normalizeCarrierResult } from './carrierResult';
import { swissPostHandoffNumber } from './carrierHandoff';
import {
  AUTOMATIC_CARRIER_IDS,
  carrierAdapter,
  carrierTimezone,
  supportsSwissPostHandoff,
} from './carriers';
import { ColisPriveTracker } from './colisPrive';
import { ColiswebTracker } from './colisweb';
import { CChezVousTracker } from './cChezVous';
import { CiblexTracker } from './ciblex';
import { DachserTracker } from './dachser';
import { DHLTracker } from './dhl';
import { DHLEcommerceTracker } from './dhlEcommerce';
import { DPDFranceTracker } from './dpdFrance';
import { DPDTracker } from './dpd';
import { GeodisTracker } from './geodis';
import { GLSFranceTracker } from './glsFrance';
import { GLSSwitzerlandTracker } from './glsSwitzerland';
import { GLSGermanyTracker } from './glsGermany';
import { HeppnerTracker } from './heppner';
import { HermesTracker } from './hermes';
import { HermesGermanyTracker } from './hermesGermany';
import { IndiaPostTracker } from './indiaPost';
import { InpostTracker } from './inpost';
import { LaPosteTracker } from './laPoste';
import { MondialRelayTracker } from './mondialRelay';
import { captureOperationalError, errorType, reportRoutingEvent } from './observability';
import { PaackTracker } from './paack';
import { PacketaTracker } from './packeta';
import { PlanzerSharedTracker } from './planzerShared';
import type { CompositePushNotificationService } from './push';
import { RelaisColisTracker } from './relaisColis';
import type { SupabaseServiceClient } from './supabase';
import { SwissPostTracker } from './swissPost';
import { SwissPostCargoTracker } from './swissPostCargo';
import {
  TrackingSyncAudit,
  type SyncAnomalyCode,
  type SyncRunContext,
} from './trackingAudit';
import { isRecord, type JsonObject } from './types';
import { fetchUpstreamCarrier } from './upstreamAdapters';
import { UPSTracker } from './ups';
import { UniversalTracker } from './universalTracking';
import { measureScrape } from './scrapeMonitoring';
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
  fetchUniversal?(source: UniversalSource, trackingNumber: string, timeoutMs: number): Promise<CarrierResult>;
  fetch(
    carrierId: string,
    trackingNumber: string,
    trackingUrl: string | null,
    dpdPostcode?: string | null,
  ): Promise<CarrierResult>;
}

export class CarrierTrackingAdapter implements TrackingAdapter {
  async fetchUniversal(source: UniversalSource, trackingNumber: string, timeoutMs: number): Promise<CarrierResult> {
    return this.universal.fetchSource(source, trackingNumber, timeoutMs);
  }
  constructor(
    readonly dpd = new DPDTracker(),
    readonly dachser = new DachserTracker(),
    readonly hermes = new HermesTracker(),
    readonly planzerShared = new PlanzerSharedTracker(),
    readonly swissPost = new SwissPostTracker(),
    readonly ups = new UPSTracker(),
    readonly laPoste = new LaPosteTracker(),
    readonly glsFrance = new GLSFranceTracker(),
    readonly colisPrive = new ColisPriveTracker(),
    readonly geodis = new GeodisTracker(),
    readonly dpdFrance = new DPDFranceTracker(),
    readonly mondialRelay = new MondialRelayTracker(),
    readonly relaisColis = new RelaisColisTracker(),
    readonly swissPostCargo = new SwissPostCargoTracker(),
    readonly glsSwitzerland = new GLSSwitzerlandTracker(),
    readonly colisweb = new ColiswebTracker(),
    readonly cChezVous = new CChezVousTracker(),
    readonly heppner = new HeppnerTracker(),
    readonly ciblex = new CiblexTracker(),
    readonly paack = new PaackTracker(),
    readonly packeta = new PacketaTracker(),
    readonly amazonShipping = new AmazonShippingTracker(),
    readonly indiaPost = new IndiaPostTracker(),
    readonly inpost = new InpostTracker(),
    readonly dhl = new DHLTracker(),
    readonly hermesGermany = new HermesGermanyTracker(),
    readonly glsGermany = new GLSGermanyTracker(),
    readonly universal = new UniversalTracker(),
    readonly dhlEcommerce = new DHLEcommerceTracker(),
  ) {}

  async fetch(
    carrierId: string,
    trackingNumber: string,
    trackingUrl: string | null,
    dpdPostcode?: string | null,
  ): Promise<CarrierResult> {
    return measureScrape(carrierId, 'total', () => this.fetchCarrier(carrierId, trackingNumber, trackingUrl, dpdPostcode));
  }

  private async fetchCarrier(
    carrierId: string, trackingNumber: string, trackingUrl: string | null, dpdPostcode?: string | null,
  ): Promise<CarrierResult> {
    const adapter = carrierAdapter(carrierId);
    let result: CarrierResult;
    if (carrierId === 'swiss-post') {
      result = await this.swissPost.fetch(trackingNumber);
    } else if (adapter === 'swiss-post-cargo') {
      result = await this.swissPostCargo.fetch(trackingNumber);
    } else if (adapter === 'dpd') {
      result = await this.dpd.fetch(trackingNumber, dpdPostcode ?? '');
    } else if (adapter === 'dachser') {
      if (!trackingUrl) throw new TypeError('Dachser tracking requires its complete tracking URL');
      result = await this.dachser.fetch(trackingNumber, trackingUrl);
    } else if (adapter === 'hermes') {
      result = await this.hermes.fetch(trackingNumber);
    } else if (adapter === 'hermes-germany') {
      result = await this.hermesGermany.fetch(trackingNumber);
    } else if (adapter === 'gls-germany') {
      result = await this.glsGermany.fetch(trackingNumber, dpdPostcode ?? '');
    } else if (adapter === 'universal') {
      result = await this.universal.fetch(trackingNumber);
    } else if (adapter === 'ups') {
      result = await this.ups.fetch(trackingNumber);
    } else if (adapter === 'dhl-ecommerce') {
      result = await this.dhlEcommerce.fetch(trackingNumber);
    } else if (adapter === 'dhl') {
      result = await this.dhl.fetch(trackingNumber);
    } else if (adapter === 'la-poste') {
      result = await this.laPoste.fetch(trackingNumber);
    } else if (adapter === 'gls-france') {
      result = await this.glsFrance.fetch(trackingNumber);
    } else if (adapter === 'gls-switzerland') {
      result = await this.glsSwitzerland.fetch(trackingNumber, dpdPostcode ?? '');
    } else if (adapter === 'colis-prive') {
      result = await this.colisPrive.fetch(trackingNumber);
    } else if (adapter === 'geodis') {
      result = await this.geodis.fetch(trackingNumber);
    } else if (adapter === 'dpd-france') {
      result = await this.dpdFrance.fetch(trackingNumber);
    } else if (adapter === 'mondial-relay') {
      result = await this.mondialRelay.fetch(trackingNumber, dpdPostcode ?? '');
    } else if (adapter === 'relais-colis') {
      result = await this.relaisColis.fetch(trackingNumber);
    } else if (adapter === 'colisweb') {
      result = await this.colisweb.fetch(trackingNumber);
    } else if (adapter === 'c-chez-vous') {
      result = await this.cChezVous.fetch(trackingNumber);
    } else if (adapter === 'heppner') {
      result = await this.heppner.fetch(trackingNumber, dpdPostcode ?? '');
    } else if (adapter === 'ciblex') {
      result = await this.ciblex.fetch(trackingNumber);
    } else if (adapter === 'paack') {
      result = await this.paack.fetch(trackingNumber, dpdPostcode ?? '');
    } else if (adapter === 'packeta') {
      result = await this.packeta.fetch(trackingNumber);
    } else if (adapter === 'amazon-shipping') {
      result = await this.amazonShipping.fetch(trackingNumber);
    } else if (adapter === 'india-post') {
      result = await this.indiaPost.fetch(trackingNumber);
    } else if (adapter === 'inpost') {
      result = await this.inpost.fetch(trackingNumber);
    } else if (adapter === 'planzer' && trackingUrl) {
      result = await this.planzerShared.fetch(trackingNumber, trackingUrl);
    } else {
      result = await fetchUpstreamCarrier(carrierId, trackingNumber);
    }
    return normalizeCarrierResult(result);
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

export function inferStage(text: string, fallback = 'in_transit'): string {
  const translated = trackingLanguageStage(text);
  if (translated) return translated;
  const value = text.toLocaleLowerCase('en-US').replaceAll('_', ' ').trim().split(/\s+/).join(' ');
  if (value.includes('to be delivered')) return 'in_transit';
  if (value === 'reported') return 'registered';
  if (['will shortly be handed over', 'shipment information received', 'electronic shipment information']
    .some((term) => value.includes(term))) return 'registered';
  if (['return to sender', 'returned', 'retour'].some((term) => value.includes(term))) {
    return 'returned';
  }
  if (['not delivered', 'could not be delivered', 'unable to deliver', 'delivery attempt',
    'failed', 'unsuccessful', 'missed delivery', 'nicht zugestellt',
    'zustellung nicht möglich', 'non livré', 'livraison impossible',
    'échec de livraison', 'mancata consegna'].some((term) => value.includes(term))) {
    return 'failed_attempt';
  }
  if (['ready for pickup', 'ready for collection', 'abholbereit', 'deposited in the mypost24 machine']
    .some((term) => value.includes(term))) return 'ready_for_pickup';
  if (['delivered', 'deposited', 'zugestellt', 'confirmation of receipt']
    .some((term) => value.includes(term))) return 'delivered';
  if (['out for delivery', 'in delivery', 'loading into delivery vehicle',
    'loaded into delivery vehicle', 'zustellung'].some((term) => value.includes(term))) {
    return 'out_for_delivery';
  }
  if (['was released by customs', 'has been released by customs', 'has been released by a government agency']
    .some((term) => value.includes(term))) return 'in_transit';
  if (['customs', 'custom clearance', 'zoll', 'pending release from a government agency']
    .some((term) => value.includes(term))) return 'customs';
  if (['accepted', 'received at', 'handed over', 'handed to dpd', 'parcel handed', 'posted']
    .some((term) => value.includes(term))) return 'accepted';
  if (['announced', 'registered', 'label created', 'created a label', 'information received', 'elektronisch angekündigt']
    .some((term) => value.includes(term))) return 'registered';
  if (['transit', 'sorted', 'sorting', 'departed', 'arrived', 'transport', 'delivery centre', 'depot',
    'on the way', 'import scan', 'delivery will be delayed']
    .some((term) => value.includes(term))) return 'in_transit';
  return fallback;
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
      raw_data: raw,
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
        raw_data: { time: result.last_update },
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
      raw_data: { observed_without_provider_timestamp: true },
    });
  }
  return rows;
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
            universal: (source, number, timeout) => this.adapter.fetchUniversal!(source, number, timeout),
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
            sync_error: error.stale ? error.message : null,
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
            sync_error: message.slice(0, 500),
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
