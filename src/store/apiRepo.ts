import { detectCarrier, normalizeTrackingNumber } from '../lib/carriers';
import { authenticatedFetch, type ApiAuth } from '../lib/apiClient';
import type {
  ApiCreatePackageResponse,
  ApiCreatePackageRequest,
  ApiChangePackageCarrierRequest,
  ApiChangePackageCarrierResponse,
  ApiOkResponse,
  ApiPackageListResponse,
  ApiPackageRow,
  ApiQueueResponse,
  ApiRenamePackageRequest,
  ApiPackageNotificationRequest,
  ApiTrackingEventRow,
  ApiSyncJobListResponse,
} from '../generated/apiContract';
import {
  ParcelAlreadyExistsError,
  type NewParcelInput,
  type ParcelCarrierInput,
  type ParcelRepo,
  type ParcelWithEvents,
  type TrackingEvent,
  type SyncProgress,
} from '../types';

export const API_CACHE_KEY = 'parcel-post.api-cache.v1';

export function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function clearApiCache(storage: Storage | null, userId: string): void {
  if (!storage) return;
  try {
    storage.removeItem(API_CACHE_KEY);
    storage.removeItem(`${API_CACHE_KEY}.${userId}`);
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function cachedParcels(storage: Storage | null, cacheKey: string): ParcelWithEvents[] | null {
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(cacheKey) ?? 'null');
    if (!Array.isArray(value)) return null;
    const valid = value.every((parcel) => {
      if (!parcel || typeof parcel !== 'object') return false;
      const candidate = parcel as Partial<ParcelWithEvents>;
      return typeof candidate.id === 'string'
        && typeof candidate.trackingNumber === 'string'
        && typeof candidate.label === 'string'
        && typeof candidate.carrier === 'string'
        && typeof candidate.createdAt === 'string'
        && typeof candidate.syncStatus === 'string'
        && Array.isArray(candidate.events);
    });
    return valid ? value as ParcelWithEvents[] : null;
  } catch {
    return null;
  }
}

function saveCachedParcels(
  storage: Storage | null,
  cacheKey: string,
  parcels: ParcelWithEvents[],
) {
  if (!storage) return;
  try {
    storage.setItem(cacheKey, JSON.stringify(parcels));
  } catch {
    // Storage can be unavailable in private browsing or on a full device.
  }
}

function toEvent(row: ApiTrackingEventRow): TrackingEvent {
  return {
    id: row.id,
    parcelId: row.package_id,
    stage: row.stage,
    description: row.description,
    location: row.location ?? undefined,
    occurredAt: row.occurred_at,
  };
}

function toParcel(row: ApiPackageRow): ParcelWithEvents {
  return {
    id: row.id,
    trackingNumber: row.tracking_number,
    label: row.label,
    carrier: row.carrier,
    createdAt: row.created_at,
    expectedDelivery: row.expected_delivery ?? undefined,
    senderName: row.carrier_data?.sender_name?.trim() || undefined,
    originalParcelId: row.carrier_data?.original_package_id ?? undefined,
    originalCarrier: row.carrier_data?.original_carrier ?? undefined,
    originalTrackingNumber: row.carrier_data?.original_tracking_number ?? undefined,
    originalTrackingUrl: row.carrier_data?.original_tracking_url ?? undefined,
    lastStatusText: row.last_status_text ?? undefined,
    lastSyncedAt: row.last_synced_at ?? undefined,
    syncStatus: row.sync_status,
    syncError: row.sync_error ?? undefined,
    trackingUrl: row.tracking_url ?? undefined,
    dpdPostcode: row.dpd_postcode ?? undefined,
    trackingSource: row.carrier_data?.active_tracking_carrier ?? undefined,
    activeTrackingNumber: row.carrier_data?.active_tracking_number ?? undefined,
    swissPostReady: row.carrier_data?.swiss_post_ready ?? undefined,
    archivedAt: row.archived_at ?? undefined,
    notificationsMuted: row.notifications_muted,
    events: (row.tracking_events ?? []).map(toEvent),
  };
}

class ApiResponseError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs: number) {
    super(message);
  }
}

function retryAfterMilliseconds(value: string | null): number {
  if (!value) return 0;
  const milliseconds = /^\d+$/.test(value)
    ? Number(value) * 1_000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
}

async function apiRequest<T>(path: string, auth: ApiAuth | undefined, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, auth, init);
  const payload = (await response.json().catch(() => null)) as (
    T & { error?: string; packageId?: string }
  ) | null;
  if (!response.ok) {
    if (response.status === 409 && typeof payload?.packageId === 'string') {
      throw new ParcelAlreadyExistsError(
        payload.error ?? 'This tracking number is already in your delivery box',
        payload.packageId,
      );
    }
    throw new ApiResponseError(
      payload?.error ?? `Delivery service failed (${response.status})`,
      response.status,
      retryAfterMilliseconds(response.headers?.get('Retry-After') ?? null),
    );
  }
  if (payload === null) throw new Error('The delivery service returned an empty response');
  return payload;
}

export function createApiRepo(
  pollIntervalMs = 30_000,
  jobPollIntervalMs = 1_000,
  storage: Storage | null = browserStorage(),
  auth?: ApiAuth,
): ParcelRepo {
  let notifySubscriber: (() => void) | null = null;
  const monitoredJobIds = new Set<string>();
  let monitorTask: Promise<void> | null = null;
  let lifecycle = new AbortController();
  let revision = 0;
  let listSequence = 0;
  const cacheKey = auth ? `${API_CACHE_KEY}.${auth.userId}` : API_CACHE_KEY;

  async function request<T>(path: string, requestAuth: ApiAuth | undefined, init?: RequestInit): Promise<T> {
    // Capture this lifecycle: StrictMode may subscribe again before an old response arrives.
    const signal = AbortSignal.any([lifecycle.signal, ...(init?.signal ? [init.signal] : []),
      ...(auth?.signal ? [auth.signal] : [])]);
    signal.throwIfAborted();
    const value = await apiRequest<T>(path, requestAuth, { ...init, signal });
    signal.throwIfAborted();
    if (init?.method && init.method !== 'GET') revision += 1;
    return value;
  }

  const wait = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });

  async function waitForJobs(
    jobIds: string[],
    onProgress?: (progress: SyncProgress) => void,
  ): Promise<void> {
    if (jobIds.length === 0) return;
    const pending = new Set(jobIds);
    const signal = lifecycle.signal;
    const deadline = Date.now() + 120_000;
    let interval = Math.max(1_000, jobPollIntervalMs);
    onProgress?.('queued');
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      let retryAfter = 0;
      try {
        // One owner-scoped read for up to twenty active jobs, never one request
        // per parcel. Completed jobs leave the set immediately.
        const ids = [...pending].slice(0, 20);
        const { jobs } = await request<ApiSyncJobListResponse>(
          `/api/sync/jobs?ids=${ids.map(encodeURIComponent).join(',')}`,
          auth,
          { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
        );
        signal.throwIfAborted();
        if (!Array.isArray(jobs) || jobs.length !== ids.length || ids.some((id) => !jobs.some((job) => job.id === id))) {
          throw new Error('The delivery service returned incomplete job statuses');
        }
        if (jobs.some((job) => job.status === 'running')) onProgress?.('running');
        const failed = jobs.find((job) => job.status === 'failed' || (job.result?.errors ?? 0) > 0);
        if (failed) {
          notifySubscriber?.();
          throw new Error(failed.error ?? 'Tracking refresh failed. Try again.');
        }
        for (const job of jobs) {
          if (job.status === 'succeeded') pending.delete(job.id);
        }
        if (pending.size === 0) return;
      } catch (error) {
        if (signal.aborted) throw error;
        if (error instanceof ApiResponseError && [429, 502, 503, 504].includes(error.status)) {
          retryAfter = error.retryAfterMs;
        } else if (!(error instanceof TypeError) && !(error instanceof DOMException && error.name === 'TimeoutError')) {
          throw error;
        }
      }
      await wait(Math.min(Math.max(interval, retryAfter), Math.max(0, deadline - Date.now())), signal);
      interval = Math.min(interval * 1.5, 10_000);
    }
    throw new Error('The tracking check is taking longer than expected. Updates will appear automatically.');
  }

  function monitorJobs(jobIds: string[]) {
    jobIds.forEach((jobId) => monitoredJobIds.add(jobId));
    if (monitorTask || monitoredJobIds.size === 0) return;
    monitorTask = (async () => {
      try {
        while (monitoredJobIds.size > 0) {
          const ids = [...monitoredJobIds];
          try {
            await waitForJobs(ids);
          } finally {
            ids.forEach((jobId) => monitoredJobIds.delete(jobId));
          }
        }
        notifySubscriber?.();
      } catch {
        // The normal collection poll remains the recovery path for a transient
        // status request failure or a job that outlives the foreground page.
      } finally {
        monitorTask = null;
        if (monitoredJobIds.size > 0) monitorJobs([]);
      }
    })();
  }

  async function list(): Promise<ParcelWithEvents[]> {
    const sequence = ++listSequence;
    const startedRevision = revision;
    const signal = lifecycle.signal;
    const payload = await request<ApiPackageListResponse>(
      '/api/packages?includeArchived=true',
      auth,
    );
    signal.throwIfAborted();
    auth?.signal?.throwIfAborted();
    if (sequence !== listSequence || startedRevision !== revision) {
      throw new DOMException('A newer parcel request or mutation completed', 'AbortError');
    }
    const parcels = payload.packages.map(toParcel);
    saveCachedParcels(storage, cacheKey, parcels);
    return parcels;
  }

  function rememberParcel(parcel: ParcelWithEvents): ParcelWithEvents {
    const cached = cachedParcels(storage, cacheKey);
    if (cached) saveCachedParcels(storage, cacheKey, [
      ...cached.filter((current) => current.id !== parcel.id), parcel,
    ]);
    return parcel;
  }

  return {
    mode: 'api',
    list,
    cachedList: () => lifecycle.signal.aborted || auth?.signal?.aborted ? null : cachedParcels(storage, cacheKey),

    async add(input: NewParcelInput): Promise<ParcelWithEvents> {
      const trackingNumber = normalizeTrackingNumber(input.trackingNumber);
      const carrier = input.carrier ?? detectCarrier(trackingNumber);
      const body: ApiCreatePackageRequest = {
        trackingNumber,
        label: input.label,
        carrier,
        trackingUrl: input.trackingUrl?.trim() || undefined,
        dpdPostcode: input.dpdPostcode?.trim() || undefined,
      };
      const payload = await request<ApiCreatePackageResponse>('/api/packages', auth, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const parcel = rememberParcel(toParcel(payload.package));
      monitorJobs(payload.jobIds);
      return parcel;
    },

    async rename(id: string, label: string): Promise<ParcelWithEvents> {
      const body: ApiRenamePackageRequest = { label: label.trim() };
      const row = await request<ApiPackageRow>(
        `/api/packages/${encodeURIComponent(id)}`,
        auth,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      );
      return rememberParcel(toParcel(row));
    },

    async changeCarrier(id: string, input: ParcelCarrierInput): Promise<ParcelWithEvents> {
      const body: ApiChangePackageCarrierRequest = {
        carrier: input.carrier,
        trackingUrl: input.trackingUrl?.trim() || undefined,
        dpdPostcode: input.dpdPostcode?.trim() || undefined,
      };
      const payload = await request<ApiChangePackageCarrierResponse>(
        `/api/packages/${encodeURIComponent(id)}/carrier`,
        auth,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      );
      monitorJobs(payload.jobIds);
      return rememberParcel(toParcel(payload.package));
    },

    async setNotificationsMuted(id: string, muted: boolean): Promise<ParcelWithEvents> {
      const body: ApiPackageNotificationRequest = { muted };
      const row = await request<ApiPackageRow>(
        `/api/packages/${encodeURIComponent(id)}/notifications`,
        auth,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      );
      return rememberParcel(toParcel(row));
    },

    async remove(id: string): Promise<void> {
      await request<ApiOkResponse>(`/api/packages/${encodeURIComponent(id)}`, auth, {
        method: 'DELETE',
      });
      const cached = cachedParcels(storage, cacheKey);
      if (cached) saveCachedParcels(storage, cacheKey, cached.map((parcel) =>
        parcel.id === id ? { ...parcel, archivedAt: new Date().toISOString() } : parcel));
    },

    async restore(id: string): Promise<ParcelWithEvents> {
      const row = await request<ApiPackageRow>(
        `/api/packages/${encodeURIComponent(id)}/restore`,
        auth,
        { method: 'POST' },
      );
      return rememberParcel(toParcel(row));
    },

    async deletePermanently(id: string): Promise<void> {
      await request<ApiOkResponse>(
        `/api/packages/${encodeURIComponent(id)}/permanent`,
        auth,
        { method: 'DELETE' },
      );
      const cached = cachedParcels(storage, cacheKey);
      if (cached) {
        saveCachedParcels(
          storage,
          cacheKey,
          cached.filter((parcel) => parcel.id !== id),
        );
      }
    },

    async refresh(onProgress): Promise<ParcelWithEvents[]> {
      const queued = await request<ApiQueueResponse>('/api/sync', auth, { method: 'POST' });
      await waitForJobs(queued.jobIds, onProgress);
      return list();
    },

    async refreshParcel(id: string, onProgress): Promise<ParcelWithEvents> {
      const queued = await request<ApiQueueResponse>(
        `/api/packages/${encodeURIComponent(id)}/sync`,
        auth,
        { method: 'POST' },
      );
      await waitForJobs(queued.jobIds, onProgress);
      const parcels = await list();
      const parcel = parcels.find((candidate) => candidate.id === id || candidate.originalParcelId === id);
      if (!parcel) throw new Error('Package not found after queueing its tracking check');
      return parcel;
    },

    subscribe(onChange: () => void | Promise<void>): () => void {
      if (lifecycle.signal.aborted) lifecycle = new AbortController();
      let pollInFlight = false;
      let stopped = false;
      let timer: number | null = null;

      const schedule = () => {
        if (timer !== null) window.clearTimeout(timer);
        if (stopped) return;
        timer = window.setTimeout(() => {
          timer = null;
          if (document.visibilityState !== 'visible') {
            schedule();
            return;
          }
          void trigger();
        }, pollIntervalMs);
      };

      const trigger = async () => {
        if (pollInFlight || stopped) return;
        pollInFlight = true;
        try {
          await onChange();
        } finally {
          pollInFlight = false;
          schedule();
        }
      };

      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        void trigger();
      };
      notifySubscriber = () => { void trigger(); };
      document.addEventListener('visibilitychange', onVisible);
      schedule();
      return () => {
        stopped = true;
        lifecycle.abort();
        monitoredJobIds.clear();
        if (timer !== null) window.clearTimeout(timer);
        notifySubscriber = null;
        document.removeEventListener('visibilitychange', onVisible);
      };
    },
  };
}
