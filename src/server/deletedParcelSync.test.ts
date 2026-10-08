import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncJobWorker, type BackgroundState } from './background';
import * as monitoring from './observability';
import { SupabaseError, SupabaseServiceClient, SyncJobLeaseLost } from './supabase';
import { TrackingSyncAudit, type SyncRunContext } from './trackingAudit';
import { emptySyncSummary, TrackingSyncService, type SyncSummary } from './trackingSync';
import type { JsonObject } from './types';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const superseded: SyncSummary = { ...emptySyncSummary(), checked: 1, superseded: 1 };
/** What the database answers when a write refers to a row that was deleted. */
const rowGone = () => new SupabaseError('Supabase POST request failed (409)', 409, '23503');

function monitor() {
  const logged = vi.spyOn(monitoring, 'logOperationalEvent').mockImplementation(() => undefined);
  const report = vi.spyOn(monitoring, 'captureOperationalError').mockReturnValue(null);
  return {
    logged, report,
    events: () => logged.mock.calls.map(([event]) => event),
    operations: () => report.mock.calls.map(([, context]) => context.operation),
  };
}

function claimed(job: JsonObject) {
  vi.useFakeTimers();
  const client = new SupabaseServiceClient('https://database.test', 'test');
  vi.spyOn(client, 'claimSyncJob').mockResolvedValueOnce(job).mockResolvedValue(null);
  vi.spyOn(client, 'takeLostScheduledRuns').mockResolvedValue([]);
  const read = vi.spyOn(client, 'getPackage').mockResolvedValue({ id: 'parcel' });
  const finish = vi.spyOn(client, 'finishSyncJob').mockResolvedValue();
  const withdrawn = vi.spyOn(client, 'syncJobWithdrawn').mockResolvedValue(true);
  const service = new TrackingSyncService(client);
  const check = vi.spyOn(service, 'syncPackage').mockResolvedValue(superseded);
  const state: BackgroundState = { workerHeartbeat: null, lastScheduledSync: null, nextScheduledSync: null,
    lastSummary: null, lastError: null, lastAutoArchived: 0 };
  const worker = new SyncJobWorker(service, state);
  const run = async () => { worker.start(); await vi.advanceTimersByTimeAsync(1); worker.stop(); };
  return { client, read, finish, withdrawn, service, check, state, worker, run, ...monitor() };
}

const packageJob = { id: 'job', kind: 'package', package_id: 'parcel' };

describe('a package job whose parcel was deleted or reconfigured', () => {
  it('is dropped before the check when the parcel is gone', async () => {
    const { read, check, finish, withdrawn, logged, report, events, state, run } = claimed(packageJob);
    read.mockResolvedValue(null);
    await run();
    expect(logged).toHaveBeenCalledWith('sync_job_dropped', { job_id: 'job', kind: 'package', reason: 'parcel_deleted' });
    expect(events()).not.toContain('sync_job_failed');
    expect(check).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(withdrawn).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
    expect(state.lastError).toBeNull();
  });

  it('still fails when the job names no parcel', async () => {
    const { read, finish, worker, events, operations, run } = claimed({ id: 'job', kind: 'package' });
    await run();
    expect(read).not.toHaveBeenCalled();
    expect(events()).toContain('sync_job_failed');
    expect(events()).not.toContain('sync_job_dropped');
    expect(operations()).toEqual(['process_job']);
    expect(finish).toHaveBeenCalledExactlyOnceWith('job', worker.workerId, { error: 'Tracking refresh failed. Try again.' });
  });

  it('is dropped after the check when its job went with the parcel', async () => {
    const { finish, withdrawn, logged, report, events, state, run } = claimed(packageJob);
    finish.mockRejectedValue(new SyncJobLeaseLost());
    await run();
    expect(withdrawn).toHaveBeenCalledExactlyOnceWith('job');
    expect(logged).toHaveBeenCalledWith('sync_job_dropped', { job_id: 'job', kind: 'package', reason: 'job_withdrawn' });
    expect(events()).not.toContain('sync_job_failed');
    expect(finish).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
    expect(state.lastError).toBeNull();
  });

  it('is dropped when the renewal finds its job gone', async () => {
    const { client, check, finish, withdrawn, report, events, worker } = claimed(packageJob);
    vi.spyOn(client, 'renewSyncJobLease').mockResolvedValue(false);
    let context!: SyncRunContext;
    let complete!: (summary: SyncSummary) => void;
    check.mockImplementation((_parcel, incoming) => {
      context = incoming!;
      return new Promise((resolve) => { complete = resolve; });
    });
    worker.start();
    await vi.advanceTimersByTimeAsync(15_001);
    expect(context.signal?.aborted).toBe(true);
    complete(superseded);
    await vi.advanceTimersByTimeAsync(1);
    worker.stop();
    expect(withdrawn).toHaveBeenCalledExactlyOnceWith('job');
    expect(events()).toContain('sync_job_dropped');
    expect(events()).not.toContain('sync_job_failed');
    expect(finish).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('keeps the report of a failed check and drops only its ending', async () => {
    const { check, finish, events, operations, run } = claimed(packageJob);
    check.mockRejectedValue(new Error('Carrier unavailable'));
    finish.mockRejectedValue(new SyncJobLeaseLost());
    await run();
    expect(events()).toEqual(expect.arrayContaining(['sync_job_failed', 'sync_job_dropped']));
    expect(events()).not.toContain('sync_job_finish_failed');
    expect(operations()).toEqual(['process_job']);
  });
});

describe('a lease lost with the parcel intact', () => {
  it('is reported when another worker holds the job', async () => {
    const { finish, withdrawn, events, operations, state, run } = claimed(packageJob);
    finish.mockRejectedValue(new SyncJobLeaseLost());
    withdrawn.mockResolvedValue(false);
    await run();
    expect(events()).toEqual(expect.arrayContaining(['sync_job_failed', 'sync_job_finish_failed']));
    expect(events()).not.toContain('sync_job_dropped');
    expect(operations()).toEqual(['process_job', 'finish_job']);
    expect(state.lastError).toBe('Error');
  });

  it('is reported when the job cannot be read', async () => {
    const { finish, withdrawn, events, operations, run } = claimed(packageJob);
    finish.mockRejectedValue(new SyncJobLeaseLost());
    withdrawn.mockRejectedValue(new SupabaseError('The delivery database is unreachable'));
    await run();
    expect(events()).not.toContain('sync_job_dropped');
    expect(operations()).toEqual(['process_job', 'finish_job']);
  });

  it('is reported for another failure of the ending without asking about the job', async () => {
    const { finish, withdrawn, events, operations, run } = claimed(packageJob);
    finish.mockRejectedValue(new SupabaseError('Supabase POST request failed (500)', 500));
    await run();
    expect(withdrawn).not.toHaveBeenCalled();
    expect(events()).not.toContain('sync_job_dropped');
    expect(operations()).toEqual(['process_job', 'finish_job']);
  });

  it('is reported for a scheduled job, which no deletion withdraws', async () => {
    const { client, service, finish, withdrawn, events, operations, run } = claimed({ id: 'job', kind: 'scheduled' });
    vi.spyOn(service, 'sync').mockResolvedValue(emptySyncSummary());
    vi.spyOn(client, 'archiveDeliveredBefore').mockResolvedValue(0);
    vi.spyOn(client, 'maintainSyncAudit').mockResolvedValue({ abandoned: 0, purged: 0 });
    vi.spyOn(client, 'forgetExpiredParcelLinks').mockResolvedValue({ links: 0, packages: 0, stopped: 0, alerts: 0 });
    vi.spyOn(client, 'publicLookupUsageSummary').mockResolvedValue({ buckets: 0, p50: 0, p90: 0, max: 0, detection: { buckets: 0, p50: 0, p90: 0, max: 0 } });
    finish.mockRejectedValue(new SyncJobLeaseLost());
    await run();
    expect(withdrawn).not.toHaveBeenCalled();
    expect(events()).not.toContain('sync_job_dropped');
    expect(operations()).toEqual(['process_job', 'finish_job']);
  });
});

describe('the audit of a check whose parcel was deleted', () => {
  function audit(context: SyncRunContext = { trigger: 'package', jobId: 'job' }) {
    const client = new SupabaseServiceClient('https://database.test', 'test');
    const start = vi.spyOn(client, 'startSyncAttempt').mockResolvedValue();
    const complete = vi.spyOn(client, 'completeSyncAttempt').mockResolvedValue(true);
    return { client, start, complete, audit: new TrackingSyncAudit(client, 'parcel', 'TEST1234', 'ups', 'pending', context), ...monitor() };
  }

  it('is skipped without a report when its rows went with the parcel', async () => {
    const { audit: attempt, start, complete, logged, report, events } = audit({ trigger: 'scheduled' });
    start.mockRejectedValue(rowGone());
    complete.mockRejectedValue(rowGone());
    await attempt.start();
    await attempt.finish({ outcome: 'superseded' });
    for (const operation of ['start_attempt', 'complete_attempt']) {
      expect(logged).toHaveBeenCalledWith('tracking_sync_audit_skipped', {
        attempt_id: attempt.attemptId, job_id: null, trigger: 'scheduled', carrier: 'ups', tracking_number: 'TEST1234', operation,
      });
    }
    expect(events()).not.toContain('tracking_sync_audit_write_failed');
    expect(report).not.toHaveBeenCalled();
  });

  it('still reports a lost lease at its start and any other refusal, once per check', async () => {
    const { audit: attempt, start, complete, events, report } = audit();
    start.mockRejectedValue(new SyncJobLeaseLost());
    complete.mockRejectedValue(new SupabaseError('Supabase POST request failed (409)', 409, '23505'));
    await attempt.start();
    await attempt.finish({ outcome: 'error' });
    expect(events().filter((event) => event === 'tracking_sync_audit_write_failed')).toHaveLength(2);
    expect(events()).not.toContain('tracking_sync_audit_skipped');
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(SyncJobLeaseLost),
      expect.objectContaining({ component: 'tracking-sync-audit', operation: 'start_attempt' }));
  });

  it('ends the check as superseded, with nothing reported', async () => {
    const { report, events } = monitor();
    const lease = { jobId: 'job', workerId: 'worker' };
    const client = {
      startSyncAttempt: vi.fn().mockResolvedValue(undefined),
      // The first write finds the parcel; the one after the carrier answered finds it deleted.
      applyTrackingSync: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),
      completeSyncAttempt: vi.fn().mockRejectedValue(rowGone()),
    };
    const adapter = { fetch: vi.fn().mockRejectedValue(new Error('Carrier unavailable')) };
    const service = new TrackingSyncService(client as unknown as SupabaseServiceClient, adapter);
    const parcel = { id: 'parcel', carrier: 'ups', tracking_number: 'TEST1234', current_stage: 'pending', tracking_generation: 'generation' };

    await expect(service.syncPackage(parcel, { trigger: 'package', jobId: 'job', lease }))
      .resolves.toMatchObject({ checked: 1, superseded: 1, errors: 0 });
    expect(adapter.fetch).toHaveBeenCalled();
    expect(client.applyTrackingSync).toHaveBeenCalledTimes(2);
    expect(client.applyTrackingSync).toHaveBeenLastCalledWith(parcel, expect.objectContaining({ sync_status: 'error' }), [], [], lease);
    expect(client.completeSyncAttempt).toHaveBeenCalledExactlyOnceWith(
      expect.any(String), expect.objectContaining({ outcome: 'superseded' }), expect.any(Array),
    );
    expect(events()).toContain('tracking_sync_audit_skipped');
    expect(report).not.toHaveBeenCalled();
  });
});

describe('the job lease client', () => {
  it('reads a job as withdrawn when it is gone or ended as superseded', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const request = vi.spyOn(client, 'request').mockResolvedValueOnce([]);
    await expect(client.syncJobWithdrawn('job-1')).resolves.toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      '/rest/v1/sync_jobs?select=state%2Clast_error&id=eq.job-1&limit=1', { timeoutMs: 3_000 },
    );
    request.mockResolvedValueOnce([{ state: 'failed', last_error: 'Superseded because the package carrier changed.' }]);
    await expect(client.syncJobWithdrawn('job-1')).resolves.toBe(true);
    for (const job of [
      { state: 'failed', last_error: 'The sync worker stopped before completing this job.' },
      { state: 'failed', last_error: null },
      { state: 'running', last_error: null },
      { state: 'succeeded', last_error: null },
      { state: 'queued', last_error: 'Superseded' },
    ]) {
      request.mockResolvedValueOnce([job]);
      await expect(client.syncJobWithdrawn('job-1')).resolves.toBe(false);
    }
  });

  it('tells a lost lease by its class and keeps the error name reports are grouped by', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    vi.spyOn(client, 'request').mockResolvedValue(false);
    for (const lost of [
      client.finishSyncJob('job', 'worker', {}),
      client.setSyncJobCheckIn('job', 'worker', { checkInId: 'check-in', monitorSlug: 'monitor', startedAt: 1 }),
      client.startSyncAttempt('attempt', {}, { jobId: 'job', workerId: 'worker' }),
    ]) {
      const error = await lost.catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SyncJobLeaseLost);
      expect(error).toMatchObject({ name: 'Error', message: 'Synchronization job lease was lost' });
      expect(monitoring.errorType(error)).toBe('Error');
    }
  });
});
