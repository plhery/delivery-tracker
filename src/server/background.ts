import 'server-only';

import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  beginScheduledSyncCheckIn,
  captureOperationalError,
  errorType,
  finishScheduledSyncCheckIn,
  logOperationalEvent,
  shouldReportRepeatedFailure,
  type ScheduledCheckIn,
} from './observability';
import { pushServices } from './push';
import { FriendshipPushService, FriendshipPushWorker } from './friendshipPush';
import { serviceClient } from './runtime';
import type { SupabaseServiceClient } from './supabase';
import { TrackingSyncService, type SyncSummary } from './trackingSync';
import type { JsonObject } from './types';

const AUTO_ARCHIVE_DAYS = 60;
const MAX_WORKER_BACKOFF_MS = 60_000;

export interface BackgroundState {
  lastScheduledSync: number | null;
  nextScheduledSync: number | null;
  lastSummary: JsonObject | null;
  lastError: string | null;
  lastAutoArchived: number;
  workerHeartbeat: number | null;
  draining?: boolean;
}

function initialState(): BackgroundState {
  return {
    lastScheduledSync: null,
    nextScheduledSync: null,
    lastSummary: null,
    lastError: null,
    lastAutoArchived: 0,
    workerHeartbeat: null,
  };
}

export function secondsUntilNextSync(now = new Date()): number {
  if (!Number.isFinite(now.getTime())) throw new TypeError('Sync clock must be valid');
  const local = DateTime.fromJSDate(now, { zone: 'Europe/Zurich' });
  let candidate: DateTime;
  if (local.hour >= 8 && local.hour < 22) {
    const minutes = 2 - (local.minute % 2);
    candidate = local.startOf('minute').plus({ minutes });
  } else {
    candidate = local.startOf('hour').plus({ hours: 1 });
  }
  return Math.max(1, candidate.toUTC().diff(local.toUTC(), 'seconds').seconds);
}

export function workerPollDelay(pollIntervalMs: number, consecutiveFailures: number): number {
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new TypeError('Worker poll interval must be positive');
  }
  if (!Number.isInteger(consecutiveFailures) || consecutiveFailures < 0) {
    throw new TypeError('Worker failure count must be a non-negative integer');
  }
  if (consecutiveFailures === 0) return pollIntervalMs;
  return Math.min(
    MAX_WORKER_BACKOFF_MS,
    pollIntervalMs * (2 ** Math.min(consecutiveFailures - 1, 6)),
  );
}

export class SyncJobWorker {
  readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 12)}`;
  #stopped = false;
  #running = false;
  #timer: NodeJS.Timeout | null = null;
  #consecutiveClaimFailures = 0;
  #activeJob: AbortController | null = null;
  #claim: Promise<JsonObject | null> | null = null;
  #ownedJob: string | null = null;
  #handoff: Promise<void> | null = null;

  constructor(
    readonly service: TrackingSyncService,
    readonly state: BackgroundState,
    readonly pollIntervalMs = 1_000,
  ) {}

  start(): void {
    if (this.#stopped || this.#timer || this.#running) return;
    this.schedule(0);
  }

  wake(): void {
    if (this.#stopped || this.#running) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.schedule(0);
  }

  stop(): void {
    this.#stopped = true;
    this.#activeJob?.abort();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Abort local work, then atomically return only our own job to the queue. */
  async drain(): Promise<void> {
    this.stop();
    await this.#claim?.catch(() => null);
    await this.releaseOwnedJob();
  }

  private async releaseOwnedJob(): Promise<void> {
    if (this.#handoff) return this.#handoff;
    const jobId = this.#ownedJob;
    if (!jobId) return;
    this.#handoff = this.service.client.releaseSyncJob(jobId, this.workerId).then((released) => {
      logOperationalEvent('sync_job_handoff', { job_id: jobId, released });
    }).catch((error: unknown) => {
      captureOperationalError(error, { component: 'sync-worker', operation: 'release_job', jobId });
      throw error;
    });
    await this.#handoff;
  }

  private schedule(delayMs: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.run();
    }, delayMs);
    this.#timer.unref();
  }

  private async run(): Promise<void> {
    if (this.#stopped || this.#running) return;
    this.#running = true;
    let processed = false;
    try {
      processed = await this.processNext();
    } catch (error) {
      if (!this.#stopped) captureOperationalError(error, { component: 'sync-worker', operation: 'run' });
    } finally {
      this.#running = false;
      if (!this.#stopped) {
        this.schedule(processed ? 0 : workerPollDelay(
          this.pollIntervalMs,
          this.#consecutiveClaimFailures,
        ));
      }
    }
  }

  private async processNext(): Promise<boolean> {
    let job: JsonObject | null;
    try {
      this.#claim = this.service.client.claimSyncJob(this.workerId);
      job = await this.#claim;
    } catch (error) {
      this.#consecutiveClaimFailures += 1;
      this.state.lastError = errorType(error);
      logOperationalEvent('sync_claim_failed', {
        error_type: this.state.lastError,
        failure_count: this.#consecutiveClaimFailures,
        retry_in_ms: workerPollDelay(this.pollIntervalMs, this.#consecutiveClaimFailures),
      }, 'error');
      if (shouldReportRepeatedFailure(this.#consecutiveClaimFailures)) {
        captureOperationalError(error, {
          component: 'sync-worker',
          operation: 'claim_job',
          failureCount: this.#consecutiveClaimFailures,
        });
      }
      return false;
    }
    this.#claim = null;
    this.#consecutiveClaimFailures = 0;
    this.state.workerHeartbeat = Date.now() / 1_000;
    if (!job) return false;
    const jobId = String(job.id ?? '');
    const kind = String(job.kind ?? '');
    if (!jobId) {
      const error = new TypeError('Claimed synchronization job has no id');
      logOperationalEvent('sync_job_invalid', { kind, error_type: error.name }, 'error');
      captureOperationalError(error, {
        component: 'sync-worker',
        operation: 'validate_job',
        trigger: kind,
      });
      return true;
    }
    this.#ownedJob = jobId;
    this.#handoff = null;
    if (this.#stopped) { await this.releaseOwnedJob(); return true; }
    if (Number(job.attempts) > 1) {
      logOperationalEvent('sync_job_reclaimed', { job_id: jobId, attempts: job.attempts });
      captureOperationalError(new Error('Recovered an expired synchronization job'), {
        component: 'sync-worker', operation: 'reclaim_job', jobId,
      });
    }
    const controller = new AbortController();
    this.#activeJob = controller;
    const { signal } = controller;
    let renewal: Promise<void> | null = null;
    const heartbeat = setInterval(() => {
      if (renewal || signal.aborted) return;
      renewal = this.service.client.renewSyncJobLease(jobId, this.workerId).then((renewed) => {
        if (!renewed) throw new Error('Synchronization job lease was lost');
        this.state.workerHeartbeat = Date.now() / 1_000;
      }).catch((error: unknown) => controller.abort(error)).finally(() => { renewal = null; });
    }, 15_000);
    heartbeat.unref();
    const context = { jobId, lease: { jobId, workerId: this.workerId }, signal };
    let scheduledCheckIn: ScheduledCheckIn | null = null;
    try {
      let summary: SyncSummary;
      let archived = 0;
      if (kind === 'package') {
        const packageId = String(job.package_id ?? '');
        const parcel = packageId ? await this.service.client.getPackage(packageId) : null;
        if (!parcel) throw new Error('Package no longer exists');
        summary = await this.service.syncPackage(parcel, { ...context, trigger: 'package' });
      } else if (kind === 'scheduled') {
        const saved = job.check_in as Partial<ScheduledCheckIn> | null | undefined;
        const validSaved = saved && typeof saved.checkInId === 'string' && typeof saved.monitorSlug === 'string'
          && typeof saved.startedAt === 'number';
        scheduledCheckIn = validSaved ? saved as ScheduledCheckIn : beginScheduledSyncCheckIn();
        if (scheduledCheckIn && !validSaved) await this.service.client.setSyncJobCheckIn(jobId, this.workerId, scheduledCheckIn);
        signal.throwIfAborted();
        summary = await this.service.sync({ ...context, trigger: 'scheduled' });
        signal.throwIfAborted();
        archived = await this.service.client.archiveDeliveredBefore(
          new Date(Date.now() - AUTO_ARCHIVE_DAYS * 86_400_000),
        );
        try {
          const maintenance = await this.service.client.maintainSyncAudit();
          if (maintenance.abandoned > 0 || maintenance.purged > 0) {
            logOperationalEvent('tracking_sync_audit_maintained', maintenance);
          }
          if (maintenance.abandoned > 0) {
            captureOperationalError(new Error('Tracking sync attempts were abandoned'), {
              component: 'tracking-sync-audit',
              operation: 'mark_abandoned',
              failureCount: maintenance.abandoned,
            });
          }
        } catch (maintenanceError) {
          logOperationalEvent('tracking_sync_audit_maintenance_failed', {
            error_type: errorType(maintenanceError),
          }, 'error');
          captureOperationalError(maintenanceError, {
            component: 'tracking-sync-audit',
            operation: 'maintenance',
            jobId,
            trigger: kind,
          });
        }
        this.state.lastScheduledSync = Date.now() / 1_000;
        this.state.lastAutoArchived = archived;
      } else {
        throw new TypeError('Unknown synchronization job kind');
      }
      signal.throwIfAborted();
      const result: JsonObject = { ...summary, auto_archived: archived };
      await this.service.client.finishSyncJob(jobId, this.workerId, { result });
      finishScheduledSyncCheckIn(scheduledCheckIn, 'ok');
      this.state.lastSummary = result;
      this.state.lastError = null;
      logOperationalEvent('sync_job_completed', { job_id: jobId, kind, ...result });
    } catch (error) {
      if (this.#stopped) {
        // The replacement resumes the same persisted Sentry check-in. Shutdown
        // is not a carrier failure and must not finish a successfully handed-off job.
        await this.releaseOwnedJob();
        return true;
      }
      finishScheduledSyncCheckIn(scheduledCheckIn, 'error');
      const capturedErrorType = errorType(error);
      this.state.lastError = capturedErrorType;
      logOperationalEvent('sync_job_failed', {
        job_id: jobId,
        kind,
        error_type: capturedErrorType,
      }, 'error');
      captureOperationalError(error, {
        component: 'sync-worker',
        operation: 'process_job',
        jobId,
        trigger: kind,
      });
      try {
        if (!signal.aborted) await this.service.client.finishSyncJob(jobId, this.workerId, {
          error: 'Tracking refresh failed. Try again.',
        });
      } catch (finishError) {
        logOperationalEvent('sync_job_finish_failed', {
          job_id: jobId,
          error_type: errorType(finishError),
        }, 'error');
        captureOperationalError(finishError, {
          component: 'sync-worker',
          operation: 'finish_job',
          jobId,
          trigger: kind,
        });
      }
    } finally {
      clearInterval(heartbeat);
      await renewal;
      this.#activeJob = null;
      this.#ownedJob = null;
    }
    return true;
  }
}

class ScheduledSync {
  #timer: NodeJS.Timeout | null = null;
  #stopped = false;

  constructor(
    readonly client: SupabaseServiceClient,
    readonly worker: SyncJobWorker,
    readonly state: BackgroundState,
  ) {}

  start(): void {
    if (this.#stopped || this.#timer) return;
    this.schedule(8_000);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  private schedule(delayMs: number): void {
    this.state.nextScheduledSync = (Date.now() + delayMs) / 1_000;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.enqueueAndReschedule();
    }, delayMs);
    this.#timer.unref();
  }

  private async enqueueAndReschedule(): Promise<void> {
    if (this.#stopped) return;
    try {
      await this.client.enqueueSyncJob({ scheduled: true });
      this.state.lastError = null;
      this.worker.wake();
    } catch (error) {
      const capturedErrorType = errorType(error);
      this.state.lastError = capturedErrorType;
      logOperationalEvent('scheduled_sync_enqueue_failed', {
        error_type: capturedErrorType,
      }, 'error');
      captureOperationalError(error, {
        component: 'sync-scheduler',
        operation: 'enqueue_scheduled_job',
        trigger: 'scheduled',
      });
    }
    if (!this.#stopped) this.schedule(secondsUntilNextSync() * 1_000);
  }
}

interface BackgroundRuntime {
  client: SupabaseServiceClient;
  state: BackgroundState;
  worker: SyncJobWorker;
  scheduler: ScheduledSync;
  friendshipWorker: FriendshipPushWorker;
}

const globalBackground = globalThis as typeof globalThis & {
  __deliveryBackgroundRuntime?: BackgroundRuntime;
};

export function startBackgroundServices(): BackgroundRuntime | null {
  const client = serviceClient();
  if (!client) return null;
  const current = globalBackground.__deliveryBackgroundRuntime;
  if (current?.state.draining) return current;
  if (current?.client === client && current.friendshipWorker) {
    current.worker.start();
    current.scheduler.start();
    current.friendshipWorker.start();
    return current;
  }
  current?.worker.stop();
  current?.scheduler.stop();
  current?.friendshipWorker?.stop();
  const state = initialState();
  const notifier = pushServices(client);
  const service = new TrackingSyncService(
    client,
    undefined,
    notifier.web || notifier.native || notifier.liveActivities ? notifier : null,
  );
  const worker = new SyncJobWorker(service, state);
  const scheduler = new ScheduledSync(client, worker, state);
  const friendshipWorker = new FriendshipPushWorker(new FriendshipPushService(client, notifier.web, notifier.native));
  const runtime = { client, state, worker, scheduler, friendshipWorker };
  globalBackground.__deliveryBackgroundRuntime = runtime;
  worker.start();
  scheduler.start();
  friendshipWorker.start();
  logOperationalEvent('background_services_started', {
    sync_enabled: true,
    web_push_enabled: Boolean(notifier.web),
    native_push_enabled: Boolean(notifier.native),
    live_activity_push_enabled: Boolean(notifier.liveActivities),
  });
  return runtime;
}

export function wakeSyncWorker(): void {
  globalBackground.__deliveryBackgroundRuntime?.worker.wake();
}

export function wakeFriendshipWorker(): void { globalBackground.__deliveryBackgroundRuntime?.friendshipWorker?.wake(); }

export function backgroundState(): BackgroundState | null {
  return globalBackground.__deliveryBackgroundRuntime?.state ?? null;
}

export async function drainBackgroundServices(): Promise<void> {
  const runtime = globalBackground.__deliveryBackgroundRuntime;
  if (!runtime) return;
  runtime.state.draining = true;
  runtime.scheduler.stop();
  runtime.friendshipWorker.stop();
  await runtime.worker.drain();
}
