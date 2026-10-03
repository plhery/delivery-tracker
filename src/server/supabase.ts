import 'server-only';

import { ALL_NOTIFICATION_STAGES } from '../lib/notificationPresets';
import type { DeliveredTime } from './email/types';
import { isRecord, type JsonObject } from './types';

const REQUEST_TIMEOUT_MS = 20_000;
const PACKAGE_COLUMNS = [
  'id',
  'tracking_number',
  'label',
  'carrier',
  'created_at',
  'expected_delivery',
  'last_status_text',
  'last_synced_at',
  'sync_status',
  'sync_error',
  'tracking_url',
  'dpd_postcode',
  'carrier_data',
  'archived_at',
  'notifications_muted',
  'email_muted',
].join(',');
/**
 * The package shape the API returns. It never carries provider_event_id. A
 * scan's `point`, the carrier's own coordinates, feeds eventPlaces.ts, which
 * drops it from the response.
 */
const PACKAGE_SELECT = `${PACKAGE_COLUMNS},tracking_events(id,package_id,stage,description,location,occurred_at,point:raw_data->point)`;
const ACTIVE_PACKAGE_SELECT = 'id,user_id,tracking_number,label,carrier,current_stage,tracking_url,dpd_postcode,created_at,last_synced_at,sync_status,carrier_data,tracking_generation';
/**
 * Where the sync loaders put each stored event's identity, instant, stage and
 * wording, so a reworded scan can update its row in place and another source's
 * copy of a stored scan is not stored again (see eventIdentity.ts). Only the
 * service client's sync loaders embed it, under this alias: no API response or
 * mapper reads it, and provider_event_id never reaches a client.
 */
export const STORED_EVENT_IDENTITIES = 'stored_event_identities';
const SYNC_EVENT_IDENTITIES = `${STORED_EVENT_IDENTITIES}:tracking_events(provider_event_id,occurred_at,stage,description)`;

export class SupabaseError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SupabaseError';
  }
}

function query(
  entries: ReadonlyArray<readonly [string, string]> | Record<string, string>,
): string {
  if (Array.isArray(entries)) {
    return new URLSearchParams(
      entries.map(([key, value]) => [key, value]),
    ).toString();
  }
  return new URLSearchParams(entries as Record<string, string>).toString();
}

function rows(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function forgotten(value: unknown): { links: number; packages: number } {
  const counts = isRecord(value) ? value : {};
  return { links: Number(counts.links ?? 0), packages: Number(counts.packages ?? 0) };
}

/** A link and its whole package row, as the database returns them to the server. */
export interface StoredParcelLink { link: JsonObject; package: JsonObject }

/** One use to count: against the client, its network when it has one, and everyone together. */
export interface PublicAllowanceClaim {
  bucket: string;
  limit: number;
  overall: { bucket: 'global' | 'detection'; limit: number };
  network?: { bucket: string; limit: number } | null;
}

export interface PublicAllowance {
  allowed: boolean;
  scope: 'bucket' | 'network' | 'global' | null;
  overallUsed: number;
}

export interface PublicUsageStats { buckets: number; p50: number; p90: number; max: number }

function usageStats(value: unknown): PublicUsageStats {
  const stats = isRecord(value) ? value : {};
  return {
    buckets: Number(stats.buckets ?? 0),
    p50: Number(stats.p50 ?? 0),
    p90: Number(stats.p90 ?? 0),
    max: Number(stats.max ?? 0),
  };
}

/** The live link an account shares a parcel through. */
export interface ParcelShare { id: string; showNumber: boolean; gift: boolean; createdAt: string }

function parcelShare(value: unknown): ParcelShare {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.created_at !== 'string') {
    throw new SupabaseError('Supabase did not return the shared link');
  }
  return { id: value.id, showNumber: value.show_number === true, gift: value.gift === true, createdAt: value.created_at };
}

/** A delivered scan claimed for an email: what must be sent now. */
export interface DeliveryEmailClaim {
  /** The claim, to end it with. */
  id: string;
  packageId: string;
  userId: string;
  eventId: string;
  /** The account's time zone, which the delivery time is told in. */
  timezone: string;
  /** What the delivered scan knows of its time, as the notification queues read it. */
  deliveredTime: DeliveredTime;
}

/** How a claimed delivery email ended. A failed one is claimed again while it is fresh and attempts are left. */
export type DeliveryEmailOutcome = 'sent' | 'failed' | 'skipped';

/** What the Auth server knows of an account that an email to it needs. */
export interface AuthAccount {
  email: string | null;
  emailConfirmed: boolean;
  /** The language the account last used, as its clients store it. */
  locale: string | null;
}

/** A parcel that is not the caller's answers like one that does not exist. */
function ownedPackageError(error: unknown): never {
  if (error instanceof SupabaseError && error.code === 'P0002') throw new SupabaseError('Package not found', 404, error.code, { cause: error });
  throw error;
}

export class SupabaseClient {
  readonly url: string;

  constructor(
    url: string,
    readonly apiKey: string,
    readonly accessToken = apiKey,
    readonly timeoutMs = REQUEST_TIMEOUT_MS,
  ) {
    this.url = url.replace(/\/+$/, '');
  }

  async request<T = unknown>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      prefer?: string;
      timeoutMs?: number;
    } = {},
  ): Promise<T | null> {
    const method = options.method ?? 'GET';
    const headers = new Headers({
      Accept: 'application/json',
      apikey: this.apiKey,
      Authorization: `Bearer ${this.accessToken}`,
    });
    let body: string | undefined;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers.set('Content-Type', 'application/json');
    }
    if (options.prefer) headers.set('Prefer', options.prefer);

    let response: Response;
    try {
      response = await fetch(`${this.url}${path}`, {
        method,
        headers,
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
      });
    } catch (error) {
      throw new SupabaseError('The delivery database is unreachable', undefined, undefined, {
        cause: error,
      });
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        if (response.ok) {
          throw new SupabaseError('The delivery database returned invalid JSON', response.status, undefined, {
            cause: error,
          });
        }
      }
    }

    if (!response.ok) {
      const code = isRecord(payload) && typeof payload.code === 'string' ? payload.code : undefined;
      throw new SupabaseError(
        `Supabase ${method} request failed (${response.status})`,
        response.status,
        code,
      );
    }
    return payload as T | null;
  }

  async listPackages(includeArchived = false): Promise<JsonObject[]> {
    const params: Array<[string, string]> = [
      ['select', PACKAGE_SELECT],
      ['order', 'created_at.desc'],
    ];
    if (!includeArchived) params.push(['archived_at', 'is.null']);
    return rows(await this.request(`/rest/v1/packages?${query(params)}`));
  }

  async getPackage(packageId: string): Promise<JsonObject | null> {
    const params: Array<[string, string]> = [
      ['select', PACKAGE_SELECT],
      ['id', `eq.${packageId}`],
      ['limit', '1'],
    ];
    const parcel = rows(await this.request(`/rest/v1/packages?${query(params)}`))[0];
    if (parcel) return parcel;
    return rows(await this.request(`/rest/v1/packages?${query({
      select: PACKAGE_SELECT, 'carrier_data->>original_package_id': `eq.${packageId}`, limit: '1',
    })}`))[0] ?? null;
  }

  async getPackageByTrackingNumber(trackingNumber: string): Promise<JsonObject | null> {
    const params: Array<[string, string]> = [
      ['select', PACKAGE_SELECT],
      ['tracking_number', `eq.${trackingNumber}`],
      ['limit', '1'],
    ];
    const parcel = rows(await this.request(`/rest/v1/packages?${query(params)}`))[0];
    if (parcel) return parcel;
    return rows(await this.request(`/rest/v1/packages?${query({
      select: PACKAGE_SELECT, 'carrier_data->>original_tracking_number': `eq.${trackingNumber}`, limit: '1',
    })}`))[0] ?? null;
  }

  async createPackage(
    trackingNumber: string,
    label: string,
    carrier: string,
    trackingUrl?: string | null,
    dpdPostcode?: string | null,
  ): Promise<JsonObject> {
    const body: JsonObject = {
      tracking_number: trackingNumber,
      label,
      carrier,
    };
    if (trackingUrl) body.tracking_url = trackingUrl;
    if (dpdPostcode) body.dpd_postcode = dpdPostcode;
    const created = rows(await this.request('/rest/v1/packages', {
      method: 'POST',
      body,
      prefer: 'return=representation',
    }));
    const id = created[0]?.id;
    if (typeof id !== 'string') throw new SupabaseError('Supabase did not return the new package');
    const parcel = await this.getPackage(id);
    if (!parcel) throw new SupabaseError('The new package could not be reloaded');
    return parcel;
  }

  async archivePackage(packageId: string): Promise<void> {
    await this.updatePackage(packageId, { archived_at: new Date().toISOString() });
  }

  async restorePackage(packageId: string): Promise<void> {
    await this.updatePackage(packageId, { archived_at: null });
  }

  async deleteArchivedPackage(packageId: string): Promise<boolean> {
    const params = query({ id: `eq.${packageId}`, archived_at: 'not.is.null' });
    const deleted = rows(await this.request(`/rest/v1/packages?${params}`, {
      method: 'DELETE',
      prefer: 'return=representation',
    }));
    return deleted.length === 1;
  }

  async deletePackage(packageId: string): Promise<boolean> {
    const deleted = rows(await this.request(`/rest/v1/packages?${query({ id: `eq.${packageId}` })}`, {
      method: 'DELETE',
      prefer: 'return=representation',
    }));
    return deleted.length === 1;
  }

  async archiveDeliveredBefore(cutoff: Date): Promise<number> {
    if (!Number.isFinite(cutoff.getTime())) throw new TypeError('Archive cutoff must be valid');
    const params = query([
      ['archived_at', 'is.null'],
      ['current_stage', 'eq.delivered'],
      ['last_synced_at', `lt.${cutoff.toISOString()}`],
      // A one-off parcel has no list to leave: it is forgotten with its links.
      ['one_off', 'is.false'],
    ]);
    const archived = rows(await this.request(`/rest/v1/packages?${params}`, {
      method: 'PATCH',
      body: { archived_at: new Date().toISOString() },
      prefer: 'return=representation',
    }));
    return archived.length;
  }

  async listActivePackages(): Promise<JsonObject[]> {
    return await this.activePackages(ACTIVE_PACKAGE_SELECT);
  }

  protected async activePackages(
    select: string,
    filters: ReadonlyArray<readonly [string, string]> = [],
  ): Promise<JsonObject[]> {
    const params = query([
      ['select', select],
      ['archived_at', 'is.null'],
      ['or', '(current_stage.not.in.(delivered,returned),last_status_text.eq.TO_BE_DELIVERED)'],
      ...filters,
      ['order', 'last_synced_at.asc.nullsfirst,created_at.asc'],
    ]);
    return rows(await this.request(`/rest/v1/packages?${params}`));
  }

  async updatePackage(packageId: string, values: JsonObject): Promise<void> {
    await this.request(`/rest/v1/packages?${query({ id: `eq.${packageId}` })}`, {
      method: 'PATCH',
      body: values,
      prefer: 'return=minimal',
    });
  }

  async acquireTrackingProvider(provider: string): Promise<{ token: string | null; retry_at: string }> {
    const result = await this.request('/rest/v1/rpc/acquire_tracking_provider', {
      method: 'POST', body: { p_provider: provider },
    });
    if (!isRecord(result) || !(typeof result.token === 'string' || result.token === null)
      || typeof result.retry_at !== 'string') throw new TypeError('Invalid provider health response');
    return { token: result.token, retry_at: result.retry_at };
  }

  async finishTrackingProvider(provider: string, token: string, kind: string | null, retryAfterMs: number, durationMs: number): Promise<void> {
    await this.request('/rest/v1/rpc/finish_tracking_provider', { method: 'POST', body: {
      p_provider: provider, p_token: token, p_kind: kind,
      p_retry_ms: Math.ceil(Math.max(0, retryAfterMs)), p_duration_ms: Math.round(durationMs),
    } });
  }

  async insertEvents(events: JsonObject[]): Promise<void> {
    if (events.length === 0) return;
    await this.request(`/rest/v1/tracking_events?${query({
      on_conflict: 'package_id,provider_event_id',
    })}`, {
      method: 'POST',
      body: events,
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }

  async deleteEventsByDescriptions(packageId: string, descriptions: Set<string>): Promise<void> {
    if (descriptions.size === 0) return;
    const params = query([
      ['package_id', `eq.${packageId}`],
      ['description', `in.(${[...descriptions].sort().join(',')})`],
    ]);
    await this.request(`/rest/v1/tracking_events?${params}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  }

  async upsertPushSubscription(
    userId: string,
    endpoint: string,
    p256dh: string,
    auth: string,
    userAgent?: string | null,
    locale?: string,
  ): Promise<JsonObject> {
    const now = new Date().toISOString();
    const result = rows(await this.request(`/rest/v1/push_subscriptions?${query({
      on_conflict: 'endpoint',
    })}`, {
      method: 'POST',
      body: {
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent ?? null,
        ...(locale ? { locale } : {}),
        subscribed_at: now,
        disabled_at: null,
        last_error: null,
        updated_at: now,
      },
      prefer: 'resolution=merge-duplicates,return=representation',
    }));
    if (!result[0]) throw new SupabaseError('Supabase did not return the push subscription');
    return result[0];
  }

  async hasActivePushSubscription(userId: string, endpoint: string): Promise<boolean> {
    const params = query({
      select: 'id', user_id: `eq.${userId}`, endpoint: `eq.${endpoint}`, disabled_at: 'is.null', limit: '1',
    });
    return rows(await this.request(`/rest/v1/push_subscriptions?${params}`)).length > 0;
  }

  async deletePushSubscription(userId: string, endpoint: string): Promise<void> {
    const params = query({ user_id: `eq.${userId}`, endpoint: `eq.${endpoint}` });
    await this.request(`/rest/v1/push_subscriptions?${params}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  }

  async updatePushSubscriptionLocale(userId: string, endpoint: string, locale: string): Promise<void> {
    const params = query({ user_id: `eq.${userId}`, endpoint: `eq.${endpoint}`, disabled_at: 'is.null' });
    await this.request(`/rest/v1/push_subscriptions?${params}`, {
      method: 'PATCH', body: { locale }, prefer: 'return=minimal',
    });
  }

  async upsertNativePushDevice(
    userId: string,
    token: string,
    environment: string,
    locale: string,
    installationId?: string | null,
    deviceName?: string | null,
  ): Promise<JsonObject> {
    const now = new Date().toISOString();
    const result = rows(await this.request(`/rest/v1/native_push_devices?${query({
      on_conflict: 'environment,token',
    })}`, {
      method: 'POST',
      body: {
        user_id: userId,
        token,
        environment,
        locale,
        installation_id: installationId ?? null,
        device_name: deviceName ?? null,
        subscribed_at: now,
        disabled_at: null,
        last_error: null,
        updated_at: now,
      },
      prefer: 'resolution=merge-duplicates,return=representation',
    }));
    if (!result[0]) throw new SupabaseError('Supabase did not return the native push device');
    return result[0];
  }

  async deleteNativePushDevice(userId: string, token: string): Promise<void> {
    const params = query({ user_id: `eq.${userId}`, token: `eq.${token}` });
    await this.request(`/rest/v1/native_push_devices?${params}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  }

  async upsertLiveActivityDevice(
    userId: string,
    installationId: string,
    token: string,
    environment: string,
    locale: string,
    sessionId: string,
    revocationHash: string | null,
  ): Promise<JsonObject> {
    const now = new Date().toISOString();
    const result = rows(await this.request(`/rest/v1/live_activity_devices?${query({
      on_conflict: 'installation_id',
    })}`, {
      method: 'POST',
      body: {
        user_id: userId,
        installation_id: installationId,
        session_id: sessionId,
        revocation_hash: revocationHash,
        token,
        environment,
        locale,
        disabled_at: null,
        last_error: null,
        updated_at: now,
      },
      prefer: 'resolution=merge-duplicates,return=representation',
    }));
    if (!result[0]) throw new SupabaseError('Supabase did not return the Live Activity device');
    return result[0];
  }

  async revokeLiveActivityDevice(installationId: string, revocationHash: string): Promise<void> {
    await this.request('/rest/v1/rpc/revoke_live_activity_device', {
      method: 'POST',
      body: { p_installation_id: installationId, p_revocation_hash: revocationHash },
    });
  }

  async getLiveActivityDevice(
    userId: string,
    installationId: string,
  ): Promise<JsonObject | null> {
    const params = query({
      user_id: `eq.${userId}`,
      installation_id: `eq.${installationId}`,
      disabled_at: 'is.null',
      limit: '1',
    });
    return rows(await this.request(`/rest/v1/live_activity_devices?${params}`))[0] ?? null;
  }

  async deleteLiveActivityDevice(userId: string, installationId: string): Promise<void> {
    const params = query({
      user_id: `eq.${userId}`,
      installation_id: `eq.${installationId}`,
    });
    await this.request(`/rest/v1/live_activity_devices?${params}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  }

  async upsertLiveActivityUpdateToken(values: {
    deviceId: string;
    packageId: string;
    activityId: string;
    token: string;
    environment: string;
    locale: string;
  }): Promise<JsonObject> {
    const starts = rows(await this.request(`/rest/v1/live_activity_event_deliveries?${query({
      device_id: `eq.${values.deviceId}`,
      package_id: `eq.${values.packageId}`,
      delivery_kind: 'eq.start',
      select: 'event_created_at',
      order: 'event_created_at.desc',
      limit: '1',
    })}`));
    let startedAt = typeof starts[0]?.event_created_at === 'string'
      ? starts[0].event_created_at
      : null;
    if (!startedAt) {
      const events = rows(await this.request(`/rest/v1/tracking_events?${query({
        package_id: `eq.${values.packageId}`,
        stage: 'eq.out_for_delivery',
        select: 'created_at',
        order: 'created_at.desc',
        limit: '1',
      })}`));
      startedAt = typeof events[0]?.created_at === 'string'
        ? events[0].created_at
        : new Date().toISOString();
    }
    const result = rows(await this.request(`/rest/v1/live_activity_update_tokens?${query({
      on_conflict: 'device_id,package_id',
    })}`, {
      method: 'POST',
      body: {
        device_id: values.deviceId,
        package_id: values.packageId,
        activity_id: values.activityId,
        token: values.token,
        environment: values.environment,
        locale: values.locale,
        started_at: startedAt,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      prefer: 'resolution=merge-duplicates,return=representation',
    }));
    if (!result[0]) throw new SupabaseError('Supabase did not return the Live Activity update token');
    return result[0];
  }

  async deleteLiveActivityUpdateToken(
    userId: string,
    installationId: string,
    activityId: string,
  ): Promise<void> {
    const device = await this.getLiveActivityDevice(userId, installationId);
    if (typeof device?.id !== 'string') return;
    const params = query({
      device_id: `eq.${device.id}`,
      activity_id: `eq.${activityId}`,
    });
    await this.request(`/rest/v1/live_activity_update_tokens?${params}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  }

  /**
   * Each package's newest scan instant up to now, ignoring the app's own
   * placeholder rows and future-dated scans (forecasts, clocks read ahead).
   */
  async latestScanTimes(packageIds: string[]): Promise<Map<string, string>> {
    const latest = new Map<string, string>();
    const now = new Date().toISOString();
    await Promise.all([...new Set(packageIds)].map(async (packageId) => {
      const events = rows(await this.request(`/rest/v1/tracking_events?${query([
        ['package_id', `eq.${packageId}`],
        ['or', '(provider_event_id.is.null,provider_event_id.not.like.app:*)'],
        ['occurred_at', `lte.${now}`],
        ['select', 'occurred_at'],
        ['order', 'occurred_at.desc'],
        ['limit', '1'],
      ])}`));
      if (typeof events[0]?.occurred_at === 'string') latest.set(packageId, events[0].occurred_at);
    }));
    return latest;
  }

  async listPendingPushNotifications(): Promise<JsonObject[]> {
    const params = query({ select: '*', order: 'event_created_at.asc', limit: '1000' });
    return rows(await this.request(`/rest/v1/pending_push_notifications?${params}`));
  }

  async claimFriendshipPush(web: boolean, native: boolean): Promise<JsonObject[]> {
    return rows(await this.request('/rest/v1/rpc/claim_friendship_push', {
      method: 'POST', body: { p_web: web, p_native: native, p_limit: 10 },
    }));
  }

  async finishFriendshipPush(id: string, lease: string, success: boolean): Promise<void> {
    await this.request('/rest/v1/rpc/finish_friendship_push', {
      method: 'POST', body: { p_id: id, p_lease: lease, p_success: success },
    });
  }

  async listPendingNativePushNotifications(): Promise<JsonObject[]> {
    const params = query({ select: '*', order: 'event_created_at.asc', limit: '1000' });
    return rows(await this.request(`/rest/v1/pending_native_push_notifications?${params}`));
  }

  async listPendingLiveActivityEvents(): Promise<JsonObject[]> {
    const params = query({ select: '*', order: 'event_created_at.asc', limit: '1000' });
    return rows(await this.request(`/rest/v1/pending_live_activity_events?${params}`));
  }

  async recordPushDeliveries(subscriptionId: string, eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    await this.request(`/rest/v1/push_deliveries?${query({
      on_conflict: 'subscription_id,event_id',
    })}`, {
      method: 'POST',
      body: eventIds.map((eventId) => ({ subscription_id: subscriptionId, event_id: eventId })),
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  }

  async recordNativePushDeliveries(deviceId: string, eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    await this.request(`/rest/v1/native_push_deliveries?${query({
      on_conflict: 'device_id,event_id',
    })}`, {
      method: 'POST',
      body: eventIds.map((eventId) => ({ device_id: deviceId, event_id: eventId })),
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  }

  async recordLiveActivityDeliveries(values: Array<{
    deviceId: string;
    eventId: string;
    packageId: string;
    deliveryKind: string;
    eventCreatedAt: string;
  }>): Promise<void> {
    if (values.length === 0) return;
    await this.request(`/rest/v1/live_activity_event_deliveries?${query({
      on_conflict: 'device_id,event_id',
    })}`, {
      method: 'POST',
      body: values.map((value) => ({
        device_id: value.deviceId,
        event_id: value.eventId,
        package_id: value.packageId,
        delivery_kind: value.deliveryKind,
        event_created_at: value.eventCreatedAt,
      })),
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  }

  async updatePushSubscription(subscriptionId: string, values: JsonObject): Promise<void> {
    await this.request(`/rest/v1/push_subscriptions?${query({ id: `eq.${subscriptionId}` })}`, {
      method: 'PATCH',
      body: { ...values, updated_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
  }

  async updateNativePushDevice(deviceId: string, values: JsonObject): Promise<void> {
    await this.request(`/rest/v1/native_push_devices?${query({ id: `eq.${deviceId}` })}`, {
      method: 'PATCH',
      body: { ...values, updated_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
  }

  async updateLiveActivityDevice(deviceId: string, values: JsonObject): Promise<void> {
    await this.request(`/rest/v1/live_activity_devices?${query({ id: `eq.${deviceId}` })}`, {
      method: 'PATCH',
      body: { ...values, updated_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
  }

  async updateLiveActivityToken(tokenId: string, values: JsonObject): Promise<void> {
    await this.request(`/rest/v1/live_activity_update_tokens?${query({ id: `eq.${tokenId}` })}`, {
      method: 'PATCH',
      body: { ...values, updated_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
  }

  async deleteLiveActivityTokenById(tokenId: string): Promise<void> {
    await this.request(`/rest/v1/live_activity_update_tokens?${query({ id: `eq.${tokenId}` })}`, {
      method: 'DELETE',
      prefer: 'return=minimal',
    });
  }

  async deleteAuthUser(userId: string): Promise<void> {
    await this.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  }

  /** An account as the Auth server holds it, read with the service key. Null when it is gone. */
  async getAuthAccount(userId: string): Promise<AuthAccount | null> {
    let user: unknown;
    try {
      user = await this.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`);
    } catch (error) {
      if (error instanceof SupabaseError && error.status === 404) return null;
      throw error;
    }
    if (!isRecord(user) || typeof user.id !== 'string') return null;
    const metadata = isRecord(user.user_metadata) ? user.user_metadata : {};
    return {
      email: typeof user.email === 'string' && user.email ? user.email : null,
      emailConfirmed: typeof user.email_confirmed_at === 'string' && user.email_confirmed_at !== '',
      locale: typeof metadata.locale === 'string' ? metadata.locale : null,
    };
  }
}

export class SupabaseServiceClient extends SupabaseClient {
  /**
   * The sync worker's snapshot of one package. It embeds the stored event
   * identities instead of the public event list, which the worker never reads.
   */
  override async getPackage(packageId: string): Promise<JsonObject | null> {
    const select = `${PACKAGE_COLUMNS},current_stage,tracking_generation,user_id,${SYNC_EVENT_IDENTITIES}`;
    const params = query({
      select,
      id: `eq.${packageId}`,
      limit: '1',
    });
    const parcel = rows(await this.request(`/rest/v1/packages?${params}`))[0];
    if (parcel) return parcel;
    return rows(await this.request(`/rest/v1/packages?${query({
      select,
      'carrier_data->>original_package_id': `eq.${packageId}`, limit: '1',
    })}`))[0] ?? null;
  }

  /**
   * Scheduled sync candidates, with their stored event identities: every
   * account's open parcels. One-off parcels come from
   * listFollowedOneOffPackages.
   */
  override async listActivePackages(): Promise<JsonObject[]> {
    return await this.activePackages(`${ACTIVE_PACKAGE_SELECT},${SYNC_EVENT_IDENTITIES}`, [['one_off', 'is.false']]);
  }

  /**
   * The open one-off parcels with a link opened since `openedSince` or with
   * an alert on, the least recently checked first, in the shape of
   * listActivePackages.
   */
  async listFollowedOneOffPackages(openedSince: Date): Promise<JsonObject[]> {
    const params = query({
      select: `${ACTIVE_PACKAGE_SELECT},${SYNC_EVENT_IDENTITIES}`,
      order: 'last_synced_at.asc.nullsfirst,created_at.asc',
    });
    return rows(await this.request(`/rest/v1/rpc/followed_one_off_packages?${params}`, {
      method: 'POST', body: { p_opened_since: openedSince.toISOString() },
    }));
  }

  /**
   * The open parcels nobody is waiting for: no notification can reach anyone
   * about them, and neither their account's apps nor one of their links were
   * opened since `openedSince`.
   */
  async listUnwatchedPackageIds(openedSince: Date): Promise<string[]> {
    return rows(await this.request('/rest/v1/rpc/unwatched_package_ids', {
      method: 'POST', body: { p_opened_since: openedSince.toISOString() },
    })).flatMap((row) => typeof row.id === 'string' ? [row.id] : []);
  }

  /**
   * One parcel of an account in the shape the API gives its owner, events
   * included. Null when the parcel is gone or belongs to someone else.
   */
  async getOwnedPackage(packageId: string, userId: string): Promise<JsonObject | null> {
    const params = query({ select: PACKAGE_SELECT, id: `eq.${packageId}`, user_id: `eq.${userId}`, limit: '1' });
    return rows(await this.request(`/rest/v1/packages?${params}`))[0] ?? null;
  }

  /**
   * Claims the delivered scans to email now, at most `limit` of them: a claimed
   * parcel is never handed out again, to this server or another. `perAccount`
   * and `perDay` are the emails an account, and everyone, may get in 24 hours;
   * what is beyond one is recorded as skipped and counted here.
   */
  async claimDeliveryEmails(
    limit: number,
    perAccount: number,
    perDay: number,
  ): Promise<{ send: DeliveryEmailClaim[]; accountCap: number; serviceCap: number }> {
    const result = await this.request('/rest/v1/rpc/claim_delivery_emails', {
      method: 'POST', body: { p_limit: limit, p_per_account: perAccount, p_per_day: perDay },
    });
    if (!isRecord(result) || !Array.isArray(result.send)) throw new SupabaseError('Supabase did not return the delivery emails');
    return {
      send: result.send.filter(isRecord).map((claim) => ({
        id: String(claim.id),
        packageId: String(claim.package_id),
        userId: String(claim.user_id),
        eventId: String(claim.event_id),
        timezone: typeof claim.timezone === 'string' ? claim.timezone : 'Europe/Zurich',
        deliveredTime: claim.delivered_time === 'timed' || claim.delivered_time === 'date' ? claim.delivered_time : 'none',
      })),
      accountCap: Number(result.account_cap ?? 0),
      serviceCap: Number(result.service_cap ?? 0),
    };
  }

  /** Ends a claimed delivery email, with a short reason code when it was not sent. False when the claim is not open. */
  async finishDeliveryEmail(id: string, outcome: DeliveryEmailOutcome, reason: string | null = null): Promise<boolean> {
    return await this.request('/rest/v1/rpc/finish_delivery_email', {
      method: 'POST', body: { p_id: id, p_status: outcome, p_reason: reason },
    }) === true;
  }

  /**
   * Switches an account's delivery email, for the link its emails carry. The
   * account id travels in the body. Answers the stored choice, or null when
   * there is no such account.
   */
  async setDeliveryEmail(userId: string, enabled: boolean): Promise<boolean | null> {
    const stored = await this.request('/rest/v1/rpc/set_delivery_email', {
      method: 'POST', body: { p_user_id: userId, p_enabled: enabled },
    });
    return typeof stored === 'boolean' ? stored : null;
  }

  async autoLinkPackages(userId?: string): Promise<number> {
    return Number(await this.request('/rest/v1/rpc/auto_link_package_tracking', {
      method: 'POST', body: { p_user_id: userId ?? null },
    }));
  }

  async applyTrackingSync(
    parcel: JsonObject,
    values: JsonObject,
    events: JsonObject[] = [],
    deleteDescriptions: string[] = [],
    lease?: { jobId: string; workerId: string },
  ): Promise<boolean> {
    if (typeof parcel.tracking_generation !== 'string') {
      // Fail closed if a caller did not load the configuration snapshot.
      throw new TypeError('A tracking generation is required for synchronization');
    }
    return await this.request(`/rest/v1/rpc/${lease ? 'apply_leased_tracking_sync' : 'apply_tracking_sync'}`, {
      method: 'POST',
      body: {
        ...(lease ? { p_job_id: lease.jobId, p_worker_id: lease.workerId } : {}),
        p_package_id: parcel.id,
        p_tracking_generation: parcel.tracking_generation,
        p_values: values,
        p_events: events,
        p_delete_descriptions: deleteDescriptions,
      },
    }) === true;
  }

  async startSyncAttempt(attemptId: string, values: JsonObject, lease?: { jobId: string; workerId: string }): Promise<void> {
    if (lease) {
      const started = await this.request('/rest/v1/rpc/start_leased_sync_attempt', {
        method: 'POST', body: { p_attempt_id: attemptId, p_job_id: lease.jobId, p_worker_id: lease.workerId, p_values: values },
      });
      if (started !== true) throw new Error('Synchronization job lease was lost');
      return;
    }
    await this.request('/rest/v1/tracking_sync_attempts', {
      method: 'POST',
      body: { id: attemptId, ...values },
      prefer: 'return=minimal',
    });
  }

  async completeSyncAttempt(
    attemptId: string,
    values: JsonObject,
    steps: JsonObject[],
  ): Promise<boolean> {
    return await this.request('/rest/v1/rpc/complete_tracking_sync_attempt', {
      method: 'POST',
      body: {
        p_attempt_id: attemptId,
        p_values: values,
        p_steps: steps,
      },
    }) === true;
  }

  async recordTrackingHealth(attemptId: string, packageId: string, samples: JsonObject[]): Promise<JsonObject[]> {
    return rows(await this.request('/rest/v1/rpc/record_tracking_health', {
      method: 'POST', timeoutMs: 3_000,
      body: { p_attempt_id: attemptId, p_package_id: packageId, p_samples: samples },
    }));
  }

  async ackTrackingHealth(ids: string[]): Promise<void> {
    await this.request('/rest/v1/rpc/ack_tracking_health', {
      method: 'POST', timeoutMs: 3_000, body: { p_ids: ids },
    });
  }

  // Carrier wording whose stage the sync had to classify or fall back to. The
  // package and provider event ids resolve one sample event inside the
  // function; the stored row keeps only that opaque event id.
  async recordTrackingStatusObservations(observations: JsonObject[]): Promise<void> {
    if (observations.length === 0) return;
    await this.request('/rest/v1/rpc/record_tracking_status_observations', {
      method: 'POST',
      body: { p_observations: observations },
    });
  }

  async maintainSyncAudit(): Promise<{ abandoned: number; purged: number }> {
    const result = rows(await this.request('/rest/v1/rpc/maintain_tracking_sync_audit', {
      method: 'POST',
      body: {},
    }))[0];
    return {
      abandoned: Number(result?.abandoned ?? 0),
      purged: Number(result?.purged ?? 0),
    };
  }

  async enqueueSyncJob(options: {
    userId?: string | null;
    packageId?: string | null;
    scheduled?: boolean;
  }): Promise<{ row: JsonObject; queued: boolean }> {
    const scheduled = options.scheduled ?? false;
    let kind: string;
    let dedupeKey: string;
    let priority: number;
    if (scheduled) {
      if (options.userId != null || options.packageId != null) {
        throw new TypeError('Scheduled sync jobs cannot target an account');
      }
      kind = 'scheduled';
      dedupeKey = 'scheduled';
      priority = -10;
    } else {
      if (!options.packageId) throw new TypeError('Package sync jobs require a package');
      kind = 'package';
      dedupeKey = `package:${options.packageId}`;
      // A one-off parcel has no owner. Its check waits behind every account's
      // refresh and the scheduled run, so lookups cannot starve accounts.
      priority = options.userId ? 10 : -20;
    }

    const created = rows(await this.request('/rest/v1/sync_jobs?on_conflict=dedupe_key', {
      method: 'POST',
      body: {
        user_id: options.userId ?? null,
        package_id: options.packageId ?? null,
        kind,
        dedupe_key: dedupeKey,
        priority,
      },
      prefer: 'resolution=ignore-duplicates,return=representation',
    }));
    if (created[0]) return { row: created[0], queued: true };

    const params = query({
      select: 'id,user_id,package_id,kind,state,requested_at',
      dedupe_key: `eq.${dedupeKey}`,
      limit: '1',
    });
    const existing = rows(await this.request(`/rest/v1/sync_jobs?${params}`));
    if (!existing[0]) throw new SupabaseError('The durable sync job could not be queued');
    return { row: existing[0], queued: false };
  }

  async claimSyncJob(workerId: string, leaseSeconds = 90): Promise<JsonObject | null> {
    const result = rows(await this.request('/rest/v1/rpc/claim_sync_job', {
      method: 'POST', timeoutMs: 3_000,
      body: { p_worker_id: workerId, p_lease_seconds: leaseSeconds },
    }));
    return result[0] ?? null;
  }

  async renewSyncJobLease(jobId: string, workerId: string, leaseSeconds = 90): Promise<boolean> {
    return await this.request('/rest/v1/rpc/renew_sync_job_lease', {
      method: 'POST', body: { p_job_id: jobId, p_worker_id: workerId, p_lease_seconds: leaseSeconds },
    }) === true;
  }

  async releaseSyncJob(jobId: string, workerId: string): Promise<boolean> {
    return await this.request('/rest/v1/rpc/release_sync_job', {
      method: 'POST', timeoutMs: 3_000, body: { p_job_id: jobId, p_worker_id: workerId },
    }) === true;
  }

  async setSyncJobCheckIn(jobId: string, workerId: string, checkIn: { checkInId: string; monitorSlug: string; startedAt: number }): Promise<void> {
    const saved = await this.request('/rest/v1/rpc/set_sync_job_check_in', {
      method: 'POST', body: { p_job_id: jobId, p_worker_id: workerId, p_check_in: checkIn },
    });
    if (saved !== true) throw new Error('Synchronization job lease was lost');
  }

  async finishSyncJob(
    jobId: string,
    workerId: string,
    options: { result?: JsonObject | null; error?: string | null },
  ): Promise<void> {
    const finished = await this.request('/rest/v1/rpc/finish_sync_job', {
      method: 'POST', body: { p_job_id: jobId, p_worker_id: workerId,
        p_result: options.result ?? null, p_error: options.error?.slice(0, 500) ?? null },
    });
    if (finished !== true) throw new Error('Synchronization job lease was lost');
  }

  async probeReadiness(): Promise<boolean> {
    const result = await this.request('/rest/v1/sync_jobs?select=id,check_in&limit=0', { timeoutMs: 2_500 });
    return Array.isArray(result);
  }

  async getSyncJob(jobId: string, userId: string): Promise<JsonObject | null> {
    const params = query({
      select: 'id,user_id,package_id,state,requested_at,started_at,completed_at,result,last_error',
      id: `eq.${jobId}`,
      user_id: `eq.${userId}`,
      limit: '1',
    });
    return rows(await this.request(`/rest/v1/sync_jobs?${params}`))[0] ?? null;
  }

  async getSyncJobs(jobIds: string[], userId: string): Promise<JsonObject[]> {
    const params = query({
      select: 'id,package_id,state,requested_at,started_at,completed_at,result,last_error',
      id: `in.(${jobIds.join(',')})`,
      user_id: `eq.${userId}`,
      limit: '20',
    });
    return rows(await this.request(`/rest/v1/sync_jobs?${params}`));
  }

  /**
   * Counts one use without an account against today's allowances: the
   * client's, its network's when it has one, and everyone's together. Every
   * bucket but the overall one is a keyed hash. `scope` says which allowance
   * ran out, and `overallUsed` how much of the overall one is used.
   */
  async claimPublicAllowance(claim: PublicAllowanceClaim): Promise<PublicAllowance> {
    const result = await this.request('/rest/v1/rpc/claim_public_lookup', {
      method: 'POST',
      body: {
        p_bucket: claim.bucket,
        p_limit: claim.limit,
        p_global_bucket: claim.overall.bucket,
        p_global_limit: claim.overall.limit,
        ...(claim.network ? { p_network_bucket: claim.network.bucket, p_network_limit: claim.network.limit } : {}),
      },
    });
    if (!isRecord(result) || typeof result.allowed !== 'boolean') throw new SupabaseError('Supabase did not return the lookup allowance');
    return {
      allowed: result.allowed,
      scope: result.scope === 'bucket' || result.scope === 'network' || result.scope === 'global' ? result.scope : null,
      overallUsed: Number(result.overall ?? 0),
    };
  }

  /**
   * Stores a lookup: a new link to a new or already stored one-off parcel.
   * Answers like publicParcel, plus whether the parcel is new.
   */
  async createOneOffParcel(
    values: { trackingNumber: string; carrier: string; trackingUrl: string | null; dpdPostcode: string | null },
    ownerKeyHash: string,
  ): Promise<{ link: JsonObject; package: JsonObject; created: boolean }> {
    const result = await this.request('/rest/v1/rpc/create_one_off_parcel', {
      method: 'POST',
      body: {
        p_tracking_number: values.trackingNumber,
        p_carrier: values.carrier,
        p_tracking_url: values.trackingUrl,
        p_dpd_postcode: values.dpdPostcode,
        p_owner_key_hash: ownerKeyHash,
      },
    });
    if (!isRecord(result) || !isRecord(result.link) || !isRecord(result.package)) {
      throw new SupabaseError('Supabase did not return the new parcel link');
    }
    return { link: result.link, package: result.package, created: result.created === true };
  }

  /**
   * A parcel link, the role its caller has and the whole package row with its
   * events. Null when the link is unknown or past its forget date, and
   * `stopped` when its sharing was stopped and the caller does not hold the
   * owner key. The link id and key hash travel in the body, never in a logged
   * URL. `touch` records that the link was opened.
   */
  async publicParcel(linkId: string, ownerKeyHash: string | null, touch: boolean): Promise<StoredParcelLink | 'stopped' | null> {
    const result = await this.request('/rest/v1/rpc/parcel_link_view', {
      method: 'POST', body: { p_link_id: linkId, p_owner_key_hash: ownerKeyHash, p_touch: touch },
    });
    if (result === null) return null;
    if (isRecord(result) && result.stopped === true) return 'stopped';
    if (!isRecord(result) || !isRecord(result.link) || !isRecord(result.package)) {
      throw new SupabaseError('Supabase did not return the parcel link');
    }
    return { link: result.link, package: result.package };
  }

  /**
   * Changes what a lookup's link shows, or stops and resumes its sharing, for
   * the holder of its owner key. Null for an unknown link and for a wrong key
   * alike. `transition` says whether the sharing stopped or resumed.
   */
  async updateParcelLink(
    linkId: string,
    ownerKeyHash: string,
    changes: { showNumber?: boolean; gift?: boolean; shared?: boolean },
  ): Promise<StoredParcelLink & { transition: 'stopped' | 'started' | null } | null> {
    const result = await this.request('/rest/v1/rpc/update_parcel_link', {
      method: 'POST',
      body: {
        p_link_id: linkId,
        p_owner_key_hash: ownerKeyHash,
        p_show_number: changes.showNumber ?? null,
        p_gift: changes.gift ?? null,
        p_shared: changes.shared ?? null,
      },
    });
    if (result === null) return null;
    if (!isRecord(result) || !isRecord(result.link) || !isRecord(result.package)) {
      throw new SupabaseError('Supabase did not return the parcel link');
    }
    return {
      link: result.link,
      package: result.package,
      transition: result.transition === 'stopped' || result.transition === 'started' ? result.transition : null,
    };
  }

  /**
   * Turns on an alert for a link, or updates the one its browser has. `full`
   * when the link has ten already, `finished` when the journey is over and
   * nothing was stored, `stopped` like publicParcel, null for an unknown link.
   */
  async addParcelLinkAlert(
    linkId: string,
    ownerKeyHash: string | null,
    alert: { endpoint: string; p256dh: string; auth: string; locale: string; preset: string },
  ): Promise<'added' | 'updated' | 'full' | 'finished' | 'stopped' | null> {
    const result = await this.request('/rest/v1/rpc/add_parcel_link_alert', {
      method: 'POST',
      body: {
        p_link_id: linkId,
        p_owner_key_hash: ownerKeyHash,
        p_endpoint: alert.endpoint,
        p_p256dh: alert.p256dh,
        p_auth: alert.auth,
        p_locale: alert.locale,
        p_preset: alert.preset,
      },
    });
    if (result === null) return null;
    if (result === 'added' || result === 'updated' || result === 'full' || result === 'finished' || result === 'stopped') return result;
    throw new SupabaseError('Supabase did not return the alert');
  }

  /** Turns a browser's alert for a link off; false when there was none. */
  async removeParcelLinkAlert(linkId: string, endpoint: string): Promise<boolean> {
    return await this.request('/rest/v1/rpc/remove_parcel_link_alert', {
      method: 'POST', body: { p_link_id: linkId, p_endpoint: endpoint },
    }) === true;
  }

  /** The scans no link alert has handled yet, one row per alert and scan, with the alert's push credentials. */
  async listPendingParcelLinkAlerts(): Promise<JsonObject[]> {
    const params = query({ select: '*', order: 'event_created_at.asc', limit: '1000' });
    return rows(await this.request(`/rest/v1/pending_parcel_link_alerts?${params}`));
  }

  async recordParcelLinkAlertDeliveries(alertId: string, eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    await this.request(`/rest/v1/parcel_link_alert_deliveries?${query({ on_conflict: 'alert_id,event_id' })}`, {
      method: 'POST',
      body: eventIds.map((eventId) => ({ alert_id: alertId, event_id: eventId })),
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  }

  async setParcelLinkAlertFailures(alertId: string, failures: number): Promise<void> {
    await this.request(`/rest/v1/parcel_link_alerts?${query({ id: `eq.${alertId}` })}`, {
      method: 'PATCH', body: { failures }, prefer: 'return=minimal',
    });
  }

  async deleteParcelLinkAlert(alertId: string): Promise<void> {
    await this.request(`/rest/v1/parcel_link_alerts?${query({ id: `eq.${alertId}` })}`, {
      method: 'DELETE', prefer: 'return=minimal',
    });
  }

  /** Forgets a lookup when the key hash matches; a one-off parcel goes with its last link. */
  async forgetParcelLink(linkId: string, ownerKeyHash: string): Promise<{ links: number; packages: number }> {
    return forgotten(await this.request('/rest/v1/rpc/forget_parcel_link', {
      method: 'POST', body: { p_link_id: linkId, p_owner_key_hash: ownerKeyHash },
    }));
  }

  /**
   * Forgets the lookups past their forget date and the one-off parcels left
   * without a link, the links from accounts stopped 30 days ago (`stopped`),
   * and the alerts of journeys that are over (`alerts`).
   */
  async forgetExpiredParcelLinks(): Promise<{ links: number; packages: number; stopped: number; alerts: number }> {
    const result = await this.request('/rest/v1/rpc/forget_expired_parcel_links', { method: 'POST', body: {} });
    const counts = isRecord(result) ? result : {};
    return { ...forgotten(result), stopped: Number(counts.stopped ?? 0), alerts: Number(counts.alerts ?? 0) };
  }

  /**
   * Yesterday's lookups per client: how many clients, and their median, 90th
   * percentile and maximum. `detection` says the same of the numbers each
   * client had carriers asked about.
   */
  async publicLookupUsageSummary(): Promise<PublicUsageStats & { detection: PublicUsageStats }> {
    const result = await this.request('/rest/v1/rpc/public_lookup_usage_summary', { method: 'POST', body: {} });
    const summary = isRecord(result) ? result : {};
    return { ...usageStats(summary), detection: usageStats(summary.detection) };
  }

  async pendingSyncJobCount(userId?: string | null): Promise<number> {
    const params: Record<string, string> = {
      select: 'id',
      state: 'in.(queued,running)',
      limit: '1000',
    };
    if (userId) params.user_id = `eq.${userId}`;
    return rows(await this.request(`/rest/v1/sync_jobs?${query(params)}`)).length;
  }
}

export class SupabaseUserClient extends SupabaseClient {
  override async createPackage(
    trackingNumber: string,
    label: string,
    carrier: string,
    trackingUrl?: string | null,
    dpdPostcode?: string | null,
  ): Promise<JsonObject> {
    let result = await this.request('/rest/v1/rpc/create_owned_package', {
      method: 'POST',
      body: {
        p_tracking_number: trackingNumber,
        p_label: label,
        p_carrier: carrier,
        p_tracking_url: trackingUrl ?? null,
        p_dpd_postcode: dpdPostcode ?? null,
      },
    });
    if (Array.isArray(result) && result.length === 1) [result] = result;
    if (!isRecord(result) || typeof result.id !== 'string') {
      throw new SupabaseError('Supabase did not return the new package');
    }
    const parcel = await this.getPackage(result.id);
    if (!parcel) throw new SupabaseError('The new package could not be reloaded');
    return parcel;
  }

  /**
   * Keeps the parcel behind a link in this account. Null when the link is
   * unknown or the caller has no right to it; the database does not say which.
   */
  async claimParcelLink(
    linkId: string,
    ownerKeyHash: string | null,
    label: string,
  ): Promise<{ outcome: 'kept' | 'already' | 'quota'; packageId: string | null } | null> {
    let result: unknown;
    try {
      result = await this.request('/rest/v1/rpc/claim_parcel_link', {
        method: 'POST', body: { p_link_id: linkId, p_owner_key_hash: ownerKeyHash, p_label: label },
      });
    } catch (error) {
      if (error instanceof SupabaseError && error.code === 'P0002') return null;
      throw error;
    }
    if (!isRecord(result) || !(result.outcome === 'kept' || result.outcome === 'already' || result.outcome === 'quota')) {
      throw new SupabaseError('Supabase did not return the kept parcel');
    }
    return { outcome: result.outcome, packageId: typeof result.package_id === 'string' ? result.package_id : null };
  }

  /** Records that the account read its parcels: they keep the full schedule for the next hour. */
  async recordOpened(): Promise<void> {
    await this.request('/rest/v1/rpc/record_account_opened', { method: 'POST', body: {} });
  }

  /** The live link this account shares the parcel through, or null. A parcel of another account is a 404. */
  async packageShare(packageId: string): Promise<ParcelShare | null> {
    const result = await this.request('/rest/v1/rpc/owned_package_share', {
      method: 'POST', body: { p_package_id: packageId },
    }).catch(ownedPackageError);
    return result === null ? null : parcelShare(result);
  }

  /** Shares the parcel: makes its link when none is live, else changes what the live one shows. */
  async sharePackage(
    packageId: string,
    shown: { showNumber?: boolean; gift?: boolean },
  ): Promise<ParcelShare & { created: boolean }> {
    const result = await this.request('/rest/v1/rpc/share_owned_package', {
      method: 'POST',
      body: { p_package_id: packageId, p_show_number: shown.showNumber ?? null, p_gift: shown.gift ?? null },
    }).catch(ownedPackageError);
    return { ...parcelShare(result), created: isRecord(result) && result.created === true };
  }

  /** Stops sharing the parcel; false when it was not shared. */
  async stopPackageShare(packageId: string): Promise<boolean> {
    return await this.request('/rest/v1/rpc/stop_owned_package_share', {
      method: 'POST', body: { p_package_id: packageId },
    }).catch(ownedPackageError) === true;
  }

  override async updatePackage(packageId: string, values: JsonObject): Promise<void> {
    const keys = Object.keys(values);
    let changed: unknown;
    if (keys.length === 1 && keys[0] === 'label' && typeof values.label === 'string') {
      changed = await this.request('/rest/v1/rpc/rename_owned_package', {
        method: 'POST',
        body: { p_package_id: packageId, p_label: values.label },
      });
    } else if (keys.length === 1 && keys[0] === 'archived_at') {
      changed = await this.request('/rest/v1/rpc/set_owned_package_archived', {
        method: 'POST',
        body: { p_package_id: packageId, p_archived: values.archived_at != null },
      });
    } else if (
      keys.length === 1
      && keys[0] === 'notifications_muted'
      && typeof values.notifications_muted === 'boolean'
    ) {
      changed = await this.request('/rest/v1/rpc/set_owned_package_notifications_muted', {
        method: 'POST',
        body: { p_package_id: packageId, p_muted: values.notifications_muted },
      });
    } else if (keys.length === 1 && keys[0] === 'email_muted' && typeof values.email_muted === 'boolean') {
      changed = await this.request('/rest/v1/rpc/set_owned_package_email_muted', {
        method: 'POST',
        body: { p_package_id: packageId, p_muted: values.email_muted },
      });
    } else {
      throw new TypeError('User-scoped package updates must use an approved mutation');
    }
    if (changed !== true) throw new SupabaseError('Package not found', 404);
  }

  async changePackageCarrier(
    packageId: string,
    carrier: string,
    trackingUrl?: string | null,
    dpdPostcode?: string | null,
  ): Promise<boolean> {
    return await this.request('/rest/v1/rpc/change_owned_package_carrier', {
      method: 'POST',
      body: {
        p_package_id: packageId,
        p_carrier: carrier,
        p_tracking_url: trackingUrl ?? null,
        p_dpd_postcode: dpdPostcode ?? null,
      },
    }) === true;
  }

  override async deleteArchivedPackage(packageId: string): Promise<boolean> {
    return await this.request('/rest/v1/rpc/delete_owned_archived_package', {
      method: 'POST',
      body: { p_package_id: packageId },
    }) === true;
  }

  override async deletePackage(packageId: string): Promise<boolean> {
    return await this.request('/rest/v1/rpc/delete_owned_package', {
      method: 'POST',
      body: { p_package_id: packageId },
    }) === true;
  }

  async getNotificationPreferences(): Promise<JsonObject> {
    const params = query({
      select: 'enabled_stages,quiet_hours_start,quiet_hours_end,timezone,email_on_delivery',
      limit: '1',
    });
    const result = rows(await this.request(`/rest/v1/notification_preferences?${params}`));
    return result[0] ?? {
      enabled_stages: [...ALL_NOTIFICATION_STAGES],
      quiet_hours_start: null,
      quiet_hours_end: null,
      timezone: 'Europe/Zurich',
      email_on_delivery: null,
    };
  }

  /** `emailOnDelivery` switches the delivery email; left out or null, the stored choice stays. */
  async setNotificationPreferences(
    enabledStages: string[],
    quietHoursStart: string | null,
    quietHoursEnd: string | null,
    timezone: string,
    emailOnDelivery: boolean | null = null,
  ): Promise<JsonObject> {
    let result = await this.request('/rest/v1/rpc/set_owned_notification_preferences', {
      method: 'POST',
      body: {
        p_enabled_stages: enabledStages,
        p_quiet_hours_start: quietHoursStart,
        p_quiet_hours_end: quietHoursEnd,
        p_timezone: timezone,
        ...(emailOnDelivery === null ? {} : { p_email_on_delivery: emailOnDelivery }),
      },
    });
    if (Array.isArray(result) && result.length === 1) [result] = result;
    if (!isRecord(result)) {
      throw new SupabaseError('Supabase did not return notification preferences');
    }
    return result;
  }

  /** The delivery emails this account was sent: the parcel, when it still exists, and the time. */
  async listDeliveryEmails(): Promise<Array<{ packageId: string | null; sentAt: string }>> {
    const sent = rows(await this.request('/rest/v1/rpc/owned_delivery_emails', { method: 'POST', body: {} }));
    return sent.filter((email) => typeof email.sent_at === 'string').map((email) => ({
      packageId: typeof email.package_id === 'string' ? email.package_id : null,
      sentAt: String(email.sent_at),
    }));
  }
}
