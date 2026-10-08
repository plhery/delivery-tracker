import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { CHECK_FINISH_MS, SyncJobWorker, type BackgroundState } from './background';
import { LOST_SYNC_JOB_ERROR, SupabaseServiceClient } from './supabase';
import { emptySyncSummary, TrackingSyncService, type SyncSummary } from './trackingSync';
import * as monitoring from './observability';
import { TrackingSyncAudit, WorkerShutdown } from './trackingAudit';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const summary: SyncSummary = { checked: 0, updated: 0, unchanged: 0, waiting: 0, errors: 0, unsupported: 0,
  superseded: 0, notifications_sent: 0, notification_errors: 0, subscriptions_expired: 0, emails_sent: 0, email_errors: 0 };
function setup() {
  vi.useFakeTimers();
  const client = new SupabaseServiceClient('https://database.test', 'test');
  const claim = vi.spyOn(client, 'claimSyncJob').mockResolvedValue(null);
  const release = vi.spyOn(client, 'releaseSyncJob').mockResolvedValue(true);
  const finish = vi.spyOn(client, 'finishSyncJob').mockResolvedValue();
  vi.spyOn(client, 'getPackage').mockResolvedValue({ id: 'parcel' });
  const service = new TrackingSyncService(client);
  const state: BackgroundState = { workerHeartbeat: null, lastScheduledSync: null, nextScheduledSync: null,
    lastSummary: null, lastError: null, lastAutoArchived: 0 };
  return { client, claim, release, finish, service, worker: new SyncJobWorker(service, state) };
}
it('does not report an expected audit rejection after shutdown has fenced the worker out', async () => {
  const { client } = setup();
  const controller = new AbortController();
  vi.spyOn(client, 'startSyncAttempt').mockImplementation(async () => {
    controller.abort();
    throw new Error('Synchronization job lease was lost');
  });
  const report = vi.spyOn(monitoring, 'captureOperationalError').mockReturnValue(null);
  await new TrackingSyncAudit(client, 'parcel', 'TEST1234', 'ups', 'pending', {
    trigger: 'scheduled', signal: controller.signal,
  }).start();
  expect(report).not.toHaveBeenCalled();
});
it('lets the check in progress finish its job at shutdown, and takes no other', async () => {
  const { claim, release, finish, service, worker } = setup();
  claim.mockResolvedValueOnce({ id: 'job', kind: 'package', package_id: 'parcel' });
  let resolve!: (value: SyncSummary) => void;
  let signal: AbortSignal | undefined;
  vi.spyOn(service, 'syncPackage').mockImplementation((_parcel, context) => {
    signal = context!.signal;
    return new Promise(done => { resolve = done; });
  });
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  let drained = false;
  void worker.drain().then(() => { drained = true; });
  await vi.advanceTimersByTimeAsync(CHECK_FINISH_MS - 1_000);
  expect(drained).toBe(false);
  resolve(summary);
  await vi.advanceTimersByTimeAsync(1);
  expect(drained).toBe(true);
  expect(signal?.aborted).toBe(false);
  expect(finish).toHaveBeenCalledExactlyOnceWith('job', worker.workerId, { result: expect.anything() });
  expect(release).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(claim).toHaveBeenCalledOnce();
});
it('aborts a check that outlasts the window, releases its job without waiting for the carrier, and prevents late completion', async () => {
  const { claim, release, finish, service, worker } = setup();
  claim.mockResolvedValueOnce({ id: 'job', kind: 'package', package_id: 'parcel' });
  let resolve!: (value: SyncSummary) => void;
  let signal: AbortSignal | undefined;
  vi.spyOn(service, 'syncPackage').mockImplementation((_parcel, context) => {
    signal = context!.signal;
    return new Promise(done => { resolve = done; });
  });
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  const draining = Promise.all([worker.drain(), worker.drain()]);
  await vi.advanceTimersByTimeAsync(CHECK_FINISH_MS - 1);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(signal?.reason).toBeInstanceOf(WorkerShutdown);
  // The carrier ignores the abort: the handoff waits a few seconds for it, no more.
  await vi.advanceTimersByTimeAsync(5_000);
  await draining;
  expect(release).toHaveBeenCalledExactlyOnceWith('job', worker.workerId);
  resolve(summary);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(finish).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
  expect(claim).toHaveBeenCalledOnce();
});
it('ends an aborted check as interrupted, with its log line, before handing its job back', async () => {
  const { client, claim, release, finish } = setup();
  claim.mockResolvedValueOnce({ id: 'job', kind: 'package', package_id: 'parcel' });
  vi.spyOn(client, 'getPackage').mockResolvedValue({ id: 'parcel', carrier: 'ctt', tracking_number: 'TEST1234' });
  vi.spyOn(client, 'startSyncAttempt').mockResolvedValue();
  vi.spyOn(client, 'applyTrackingSync').mockResolvedValue(true);
  const complete = vi.spyOn(client, 'completeSyncAttempt').mockResolvedValue(true);
  const logged = vi.spyOn(monitoring, 'logOperationalEvent').mockImplementation(() => undefined);
  // A carrier that never answers and does not watch the abort.
  const adapter = { fetch: vi.fn(() => new Promise<never>(() => {})) };
  const state: BackgroundState = { workerHeartbeat: null, lastScheduledSync: null, nextScheduledSync: null,
    lastSummary: null, lastError: null, lastAutoArchived: 0 };
  const worker = new SyncJobWorker(new TrackingSyncService(client, adapter), state);
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(adapter.fetch).toHaveBeenCalledOnce();
  const draining = worker.drain();
  await vi.advanceTimersByTimeAsync(CHECK_FINISH_MS);
  await draining;
  expect(complete).toHaveBeenCalledExactlyOnceWith(expect.any(String), expect.objectContaining({
    outcome: 'interrupted', error_type: 'WorkerShutdown',
  }), expect.arrayContaining([expect.objectContaining({ step: 'complete', details: { outcome: 'interrupted' } })]), { timeoutMs: 3_000 });
  expect(logged).toHaveBeenCalledWith('tracking_sync_completed', expect.objectContaining({
    job_id: 'job', outcome: 'interrupted', error_type: 'WorkerShutdown',
  }));
  expect(complete.mock.invocationCallOrder[0]).toBeLessThan(release.mock.invocationCallOrder[0]!);
  expect(release).toHaveBeenCalledExactlyOnceWith('job', worker.workerId);
  expect(logged).toHaveBeenCalledWith('sync_job_handoff', { job_id: 'job', released: true });
  expect(logged.mock.calls.map(([event]) => event)).not.toContain('sync_job_failed');
  expect(finish).not.toHaveBeenCalled();
});
it('stops a scheduled run between checks at shutdown and hands its job back', async () => {
  const { client, claim, release, finish, service, worker } = setup();
  claim.mockResolvedValueOnce({ id: 'job', kind: 'scheduled' });
  vi.spyOn(client, 'takeLostScheduledRuns').mockResolvedValue([]);
  vi.spyOn(client, 'setSyncJobCheckIn').mockResolvedValue();
  let stopping: AbortSignal | undefined;
  let signal: AbortSignal | undefined;
  let checkDone!: () => void;
  vi.spyOn(service, 'sync').mockImplementation(async (context) => {
    stopping = context!.stopping;
    signal = context!.signal;
    await new Promise<void>(done => { checkDone = done; });
    // The loop in TrackingSyncService.sync asks before each check.
    if (stopping?.aborted) throw stopping.reason;
    return summary;
  });
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  const draining = worker.drain();
  await vi.advanceTimersByTimeAsync(1);
  expect(stopping?.reason).toBeInstanceOf(WorkerShutdown);
  checkDone();
  await vi.advanceTimersByTimeAsync(1);
  await draining;
  expect(signal?.aborted).toBe(false);
  expect(release).toHaveBeenCalledExactlyOnceWith('job', worker.workerId);
  expect(finish).not.toHaveBeenCalled();
});
it('closes the check-in of a scheduled run lost with its worker as an error, before opening its own', async () => {
  const { client, claim, service, worker } = setup();
  claim.mockResolvedValueOnce({ id: 'job', kind: 'scheduled' });
  const lostCheckIn = { checkInId: 'lost-id', monitorSlug: 'delivery-tracker-sync-daytime', startedAt: Date.now() - 300_000 };
  const take = vi.spyOn(client, 'takeLostScheduledRuns').mockResolvedValue([{ id: 'lost-job', attempts: 3, checkIn: lostCheckIn }]);
  const opened = { checkInId: 'new-id', monitorSlug: 'delivery-tracker-sync-daytime', startedAt: Date.now() };
  const begin = vi.spyOn(monitoring, 'beginScheduledSyncCheckIn').mockReturnValue(opened);
  const end = vi.spyOn(monitoring, 'finishScheduledSyncCheckIn').mockImplementation(() => undefined);
  const logged = vi.spyOn(monitoring, 'logOperationalEvent').mockImplementation(() => undefined);
  vi.spyOn(client, 'setSyncJobCheckIn').mockResolvedValue();
  vi.spyOn(service, 'sync').mockResolvedValue(emptySyncSummary());
  vi.spyOn(client, 'archiveDeliveredBefore').mockResolvedValue(0);
  vi.spyOn(client, 'maintainSyncAudit').mockResolvedValue({ abandoned: 0, purged: 0 });
  vi.spyOn(client, 'forgetExpiredParcelLinks').mockResolvedValue({ links: 0, packages: 0, stopped: 0, alerts: 0 });
  vi.spyOn(client, 'forgetOldParcelFeedback').mockResolvedValue(0);
  vi.spyOn(client, 'publicLookupUsageSummary').mockResolvedValue({ buckets: 0, p50: 0, p90: 0, max: 0, detection: { buckets: 0, p50: 0, p90: 0, max: 0 } });
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  worker.stop();
  // Two hours back covers the hourly runs overnight.
  expect(take).toHaveBeenCalledExactlyOnceWith(new Date(Date.now() - 2 * 60 * 60_000 - 1));
  expect(end.mock.calls).toEqual([[lostCheckIn, 'error'], [opened, 'ok']]);
  expect(end.mock.invocationCallOrder[0]).toBeLessThan(begin.mock.invocationCallOrder[0]!);
  expect(logged).toHaveBeenCalledWith('sync_job_failed', {
    job_id: 'lost-job', kind: 'scheduled', error_type: 'WorkerLeaseExpired', attempts: 3,
  }, 'error');
});
it('runs on when lost runs cannot be read, and leaves them alone when resuming a run', async () => {
  const { client, claim, finish, service, worker } = setup();
  const saved = { checkInId: 'saved-id', monitorSlug: 'delivery-tracker-sync-daytime', startedAt: Date.now() - 60_000 };
  claim.mockResolvedValueOnce({ id: 'job', kind: 'scheduled' }).mockResolvedValueOnce({ id: 'job-2', kind: 'scheduled', check_in: saved });
  const failure = new Error('database down');
  const take = vi.spyOn(client, 'takeLostScheduledRuns').mockRejectedValue(failure);
  const report = vi.spyOn(monitoring, 'captureOperationalError').mockReturnValue(null);
  vi.spyOn(monitoring, 'beginScheduledSyncCheckIn').mockReturnValue(null);
  vi.spyOn(service, 'sync').mockResolvedValue(emptySyncSummary());
  vi.spyOn(client, 'archiveDeliveredBefore').mockResolvedValue(0);
  vi.spyOn(client, 'maintainSyncAudit').mockResolvedValue({ abandoned: 0, purged: 0 });
  vi.spyOn(client, 'forgetExpiredParcelLinks').mockResolvedValue({ links: 0, packages: 0, stopped: 0, alerts: 0 });
  vi.spyOn(client, 'forgetOldParcelFeedback').mockResolvedValue(0);
  vi.spyOn(client, 'publicLookupUsageSummary').mockResolvedValue({ buckets: 0, p50: 0, p90: 0, max: 0, detection: { buckets: 0, p50: 0, p90: 0, max: 0 } });
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  worker.stop();
  expect(report).toHaveBeenCalledExactlyOnceWith(failure, { component: 'sync-worker', operation: 'close_lost_runs' });
  expect(finish.mock.calls.map(([job]) => job)).toEqual(['job', 'job-2']);
  expect(take).toHaveBeenCalledOnce();
});
it('hands back a job whose claim completes after shutdown starts', async () => {
  const { claim, release, service, worker } = setup();
  let resolve!: (value: { id: string; kind: string }) => void;
  claim.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const sync = vi.spyOn(service, 'sync');
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  const draining = worker.drain();
  resolve({ id: 'late-job', kind: 'scheduled' });
  await draining;
  expect(release).toHaveBeenCalledExactlyOnceWith('late-job', worker.workerId);
  expect(sync).not.toHaveBeenCalled();
});
it('finishes the persisted Sentry check-in when a replacement resumes the job', async () => {
  const { client, claim, service, worker, finish } = setup();
  const checkIn = { checkInId: 'saved-id', monitorSlug: 'delivery-tracker-sync-daytime', startedAt: Date.now() - 60_000 };
  claim.mockResolvedValueOnce({ id: 'job', kind: 'scheduled', check_in: checkIn });
  const begin = vi.spyOn(monitoring, 'beginScheduledSyncCheckIn');
  const end = vi.spyOn(monitoring, 'finishScheduledSyncCheckIn');
  vi.spyOn(service, 'sync').mockResolvedValue(summary);
  vi.spyOn(client, 'archiveDeliveredBefore').mockResolvedValue(0);
  vi.spyOn(client, 'maintainSyncAudit').mockResolvedValue({ abandoned: 0, purged: 0 });
  vi.spyOn(client, 'forgetExpiredParcelLinks').mockResolvedValue({ links: 0, packages: 0, stopped: 0, alerts: 0 });
  vi.spyOn(client, 'forgetOldParcelFeedback').mockResolvedValue(0);
  vi.spyOn(client, 'publicLookupUsageSummary').mockResolvedValue({ buckets: 0, p50: 0, p90: 0, max: 0, detection: { buckets: 0, p50: 0, p90: 0, max: 0 } });
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(begin).not.toHaveBeenCalled();
  expect(end).toHaveBeenCalledWith(checkIn, 'ok');
  expect(finish).toHaveBeenCalledOnce();
  worker.stop();
});

it('takes each lost scheduled run once, by clearing the check-in it hands back', async () => {
  const client = new SupabaseServiceClient('https://database.example', 'service-key');
  const checkIn = { checkInId: 'check-in', monitorSlug: 'delivery-tracker-sync-overnight', startedAt: 1 };
  const request = vi.spyOn(client, 'request').mockResolvedValue([
    { id: 'lost', attempts: 3, check_in: checkIn },
    { id: 'malformed', attempts: 3, check_in: { checkInId: 'check-in' } },
  ]);
  await expect(client.takeLostScheduledRuns(new Date('2026-10-08T10:00:00Z'))).resolves.toEqual([{ id: 'lost', attempts: 3, checkIn }]);
  const [path, options] = request.mock.calls[0]!;
  const params = new URL(path, 'https://database.example').searchParams;
  expect(Object.fromEntries(params)).toEqual({
    kind: 'eq.scheduled', state: 'eq.failed', last_error: `eq.${LOST_SYNC_JOB_ERROR}`,
    completed_at: 'gte.2026-10-08T10:00:00.000Z', check_in: 'not.is.null', select: 'id,attempts,check_in',
  });
  expect(options).toEqual({ method: 'PATCH', body: { check_in: null }, prefer: 'return=representation', timeoutMs: 3_000 });
});
it('finds lost runs by the error the job claim gives them', () => {
  const directory = join(process.cwd(), 'supabase/migrations');
  const latest = readdirSync(directory).sort().map(name => readFileSync(join(directory, name), 'utf8'))
    .filter(sql => sql.includes('function public.claim_sync_job')).at(-1)!;
  const claim = latest.slice(latest.indexOf('function public.claim_sync_job'));
  expect(claim).toContain(`last_error = '${LOST_SYNC_JOB_ERROR}'`);
});
