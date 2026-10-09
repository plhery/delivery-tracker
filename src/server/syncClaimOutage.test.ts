import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBackgroundServices, SyncJobWorker, type BackgroundState } from './background';
import * as monitoring from './observability';
import { SupabaseError, SupabaseServiceClient } from './supabase';
import { TrackingSyncService } from './trackingSync';

type Runtime = NonNullable<ReturnType<typeof startBackgroundServices>>;
const started: Runtime[] = [];
const globalRuntime = globalThis as { __deliveryBackgroundRuntime?: unknown };

afterEach(() => {
  for (const runtime of started.splice(0)) {
    runtime.worker.stop();
    runtime.scheduler.stop();
    runtime.friendshipWorker.stop();
  }
  delete globalRuntime.__deliveryBackgroundRuntime;
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const unreachable = () => new SupabaseError('The delivery database is unreachable', undefined, 'unreachable');
const gateway = () => new SupabaseError('Supabase POST request failed (503)', 503);
const refusal = () => new SupabaseError('Supabase POST request failed (404)', 404, 'PGRST202');

function monitor() {
  const logged = vi.spyOn(monitoring, 'logOperationalEvent').mockImplementation(() => undefined);
  const report = vi.spyOn(monitoring, 'captureOperationalError').mockReturnValue(null);
  return {
    logged, report,
    fields: (event: string) => logged.mock.calls.filter(([name]) => name === event).map(([, fields]) => fields),
    reportedCounts: () => report.mock.calls.map(([, context]) => context.failureCount),
  };
}

/** A worker whose claims fail with whatever `fail` was last given, and find no job otherwise. */
function polling() {
  vi.useFakeTimers();
  const client = new SupabaseServiceClient('https://database.test', 'test');
  let failure: (() => Error) | null = null;
  vi.spyOn(client, 'claimSyncJob').mockImplementation(async () => {
    if (failure) throw failure();
    return null;
  });
  const state: BackgroundState = { workerHeartbeat: null, lastScheduledSync: null, nextScheduledSync: null,
    lastSummary: null, lastError: null, lastAutoArchived: 0 };
  const worker = new SyncJobWorker(new TrackingSyncService(client), state);
  return { state, worker, fail: (next: (() => Error) | null) => { failure = next; }, ...monitor() };
}

describe('failed claims of the sync worker', () => {
  it('stay in the logs while the database restarts, with a line when it is back', async () => {
    const { state, worker, fail, report, fields } = polling();
    fail(unreachable);
    worker.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fields('sync_claim_failed')).toEqual([
      { error_type: 'SupabaseError', failure_count: 1, failing_for_ms: 0, retry_in_ms: 1_000 },
      { error_type: 'SupabaseError', failure_count: 2, failing_for_ms: 1_000, retry_in_ms: 2_000 },
      { error_type: 'SupabaseError', failure_count: 3, failing_for_ms: 3_000, retry_in_ms: 4_000 },
      { error_type: 'SupabaseError', failure_count: 4, failing_for_ms: 7_000, retry_in_ms: 8_000 },
      { error_type: 'SupabaseError', failure_count: 5, failing_for_ms: 15_000, retry_in_ms: 16_000 },
    ]);
    expect(state.workerHeartbeat).toBeNull();
    fail(null);
    await vi.advanceTimersByTimeAsync(5_000);
    worker.stop();
    expect(fields('sync_claim_recovered')).toEqual([{ failure_count: 5, failing_for_ms: 31_000 }]);
    expect(state.workerHeartbeat).not.toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    ['does not answer', unreachable],
    ['answers through its gateway only', gateway],
  ])('are reported once a database that %s has lasted two minutes, then as the outage doubles', async (_case, failure) => {
    const { worker, fail, report } = polling();
    fail(failure);
    worker.start();
    await vi.advanceTimersByTimeAsync(122_000);
    expect(report).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(SupabaseError), {
      component: 'sync-worker', operation: 'claim_job', failureCount: 8, durationMs: 123_000,
    });
    await vi.advanceTimersByTimeAsync(176_000);
    expect(report).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(4_000);
    worker.stop();
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith(expect.any(SupabaseError),
      expect.objectContaining({ failureCount: 11, durationMs: 303_000 }));
  });

  it.each([
    ['a refusal by the database', refusal],
    ['an answer that cannot be read', () => new TypeError('Unexpected answer')],
  ])('are reported at once for %s, and again as it lasts', async (_case, failure) => {
    const { worker, fail, report, reportedCounts } = polling();
    fail(failure);
    worker.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
      component: 'sync-worker', operation: 'claim_job', failureCount: 1, durationMs: 0,
    });
    await vi.advanceTimersByTimeAsync(124_000);
    // The eighth failure is due by both rules and is reported once.
    expect(reportedCounts()).toEqual([1, 2, 3, 4, 8]);
    await vi.advanceTimersByTimeAsync(180_000);
    worker.stop();
    expect(reportedCounts()).toEqual([1, 2, 3, 4, 8, 11]);
  });

  it('count each streak from its own beginning', async () => {
    const { worker, fail, report, fields, reportedCounts } = polling();
    fail(unreachable);
    worker.start();
    await vi.advanceTimersByTimeAsync(124_000);
    expect(reportedCounts()).toEqual([8]);
    fail(null);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fields('sync_claim_recovered')).toEqual([{ failure_count: 8, failing_for_ms: 183_000 }]);

    fail(unreachable);
    await vi.advanceTimersByTimeAsync(30_000);
    fail(null);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fields('sync_claim_recovered')).toHaveLength(2);
    expect(fields('sync_claim_recovered')[1]).toMatchObject({ failure_count: 5 });
    expect(report).toHaveBeenCalledOnce();

    fail(unreachable);
    await vi.advanceTimersByTimeAsync(125_000);
    worker.stop();
    expect(reportedCounts()).toEqual([8, 8]);
    expect(report).toHaveBeenLastCalledWith(expect.any(SupabaseError), expect.objectContaining({ durationMs: 123_000 }));
  });
});

describe('an idle sync worker', () => {
  /** A worker whose claims find a job only when one is queued, and, while held, answer when `answer` says so. */
  function idle() {
    vi.useFakeTimers();
    const client = new SupabaseServiceClient('https://database.test', 'test');
    const queued: Array<Record<string, unknown>> = [];
    const answers: Array<() => void> = [];
    let holding = false;
    const claims: number[] = [];
    vi.spyOn(client, 'claimSyncJob').mockImplementation(async () => {
      claims.push(Date.now());
      const job = queued.shift() ?? null;
      if (holding) await new Promise<void>((resolve) => { answers.push(resolve); });
      return job;
    });
    // A queued parcel that was deleted since: the job ends without a check.
    vi.spyOn(client, 'getPackage').mockResolvedValue(null);
    const state: BackgroundState = { workerHeartbeat: null, lastScheduledSync: null, nextScheduledSync: null,
      lastSummary: null, lastError: null, lastAutoArchived: 0 };
    const worker = new SyncJobWorker(new TrackingSyncService(client), state);
    const started = Date.now();
    return {
      state, worker, claims: () => claims.map((at) => at - started),
      queue: () => queued.push({ id: `job-${queued.length + 1}`, kind: 'package', package_id: 'gone' }),
      hold: (next: boolean) => { holding = next; },
      answer: () => answers.splice(0).forEach((resolve) => resolve()),
      ...monitor(),
    };
  }

  it('asks for a job less often while it finds none, up to every ten seconds, and keeps its heartbeat', async () => {
    const { state, worker, claims, queue } = idle();
    worker.start();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(claims()).toEqual([0, 1_000, 3_000, 7_000, 15_000, 25_000, 35_000, 45_000]);
    expect(state.workerHeartbeat).toBe((Date.now()) / 1_000);
    // A job queued elsewhere is found by the next claim, and the worker polls quickly again.
    queue();
    await vi.advanceTimersByTimeAsync(13_001);
    worker.stop();
    // A timer of no delay fires a millisecond later.
    expect(claims().slice(8)).toEqual([55_000, 55_001, 56_001, 58_001]);
  });

  it('claims at once when this process queues a job, and starts polling quickly again', async () => {
    const { worker, claims, queue } = idle();
    worker.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(claims()).toEqual([0, 1_000, 3_000, 7_000, 15_000]);
    queue();
    worker.wake();
    await vi.advanceTimersByTimeAsync(2);
    expect(claims().slice(5)).toEqual([20_000, 20_001]);
    await vi.advanceTimersByTimeAsync(3_000);
    worker.stop();
    expect(claims().slice(7)).toEqual([21_001, 23_001]);
  });

  it('claims again at once when a job is queued while a claim is on its way', async () => {
    const { worker, claims, queue, hold, answer } = idle();
    hold(true);
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(claims()).toEqual([0]);
    // The claim already read an empty queue when the job arrives.
    queue();
    worker.wake();
    hold(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(claims()).toEqual([0]);
    answer();
    await vi.advanceTimersByTimeAsync(1);
    worker.stop();
    expect(claims()).toEqual([0, 500, 501]);
  });

  it('stops polling when it drains, whatever its back-off', async () => {
    const { worker, claims } = idle();
    worker.start();
    await vi.advanceTimersByTimeAsync(20_000);
    await worker.drain();
    worker.wake();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(claims()).toEqual([0, 1_000, 3_000, 7_000, 15_000]);
  });
});

describe('a failed enqueue of the scheduled sync', () => {
  function scheduled(failure: Error) {
    vi.useFakeTimers();
    vi.stubEnv('SUPABASE_URL', 'https://database.example');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    for (const unset of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'APNS_TEAM_ID', 'APNS_KEY_ID', 'APNS_PRIVATE_KEY',
      'APNS_BUNDLE_ID', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD']) {
      vi.stubEnv(unset, '');
    }
    const monitored = monitor();
    const runtime = startBackgroundServices();
    if (!runtime) throw new Error('The background services did not start');
    started.push(runtime);
    // The worker and the scheduler have only set their timers: none has fired.
    vi.spyOn(runtime.client, 'claimSyncJob').mockResolvedValue(null);
    const enqueue = vi.spyOn(runtime.client, 'enqueueSyncJob').mockRejectedValue(failure);
    return { runtime, enqueue, ...monitored };
  }

  it.each([
    ['does not answer', unreachable()],
    ['answers through its gateway only', gateway()],
  ])('is left to the worker when the database %s', async (_case, failure) => {
    const { runtime, enqueue, logged, report } = scheduled(failure);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(enqueue).toHaveBeenCalledExactlyOnceWith({ scheduled: true });
    expect(logged).toHaveBeenCalledWith('scheduled_sync_enqueue_failed', { error_type: 'SupabaseError' }, 'error');
    expect(runtime.state.lastError).toBe('SupabaseError');
    expect(runtime.state.nextScheduledSync).toBeGreaterThan(Date.now() / 1_000);
    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    ['a refusal', new SupabaseError('Supabase POST request failed (400)', 400, '42804')],
    ['a failed statement', new SupabaseError('Supabase POST request failed (500)', 500, '55000')],
    ['a job that could not be queued', new SupabaseError('The durable sync job could not be queued')],
  ])('is reported for %s', async (_case, failure) => {
    const { logged, report } = scheduled(failure);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(logged).toHaveBeenCalledWith('scheduled_sync_enqueue_failed', { error_type: 'SupabaseError' }, 'error');
    expect(report).toHaveBeenCalledExactlyOnceWith(failure, {
      component: 'sync-scheduler', operation: 'enqueue_scheduled_job', trigger: 'scheduled',
    });
  });
});
