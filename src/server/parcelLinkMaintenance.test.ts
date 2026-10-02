import { afterEach, expect, it, vi } from 'vitest';
import { SyncJobWorker, type BackgroundState } from './background';
import * as metrics from './metrics';
import * as monitoring from './observability';
import { SupabaseError, SupabaseServiceClient } from './supabase';
import { emptySyncSummary, TrackingSyncService } from './trackingSync';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function scheduledRun() {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const client = new SupabaseServiceClient('https://database.test', 'test');
  vi.spyOn(client, 'claimSyncJob').mockResolvedValueOnce({ id: 'job', kind: 'scheduled' }).mockResolvedValue(null);
  const finish = vi.spyOn(client, 'finishSyncJob').mockResolvedValue();
  vi.spyOn(client, 'archiveDeliveredBefore').mockResolvedValue(0);
  vi.spyOn(client, 'maintainSyncAudit').mockResolvedValue({ abandoned: 0, purged: 0 });
  const service = new TrackingSyncService(client);
  vi.spyOn(service, 'sync').mockResolvedValue(emptySyncSummary());
  const state: BackgroundState = { workerHeartbeat: null, lastScheduledSync: null, nextScheduledSync: null,
    lastSummary: null, lastError: null, lastAutoArchived: 0 };
  return { client, finish, state, worker: new SyncJobWorker(service, state) };
}

it('forgets expired lookups, stopped links and finished alerts, and refreshes the usage gauges, after each scheduled sync', async () => {
  const { client, finish, worker } = scheduledRun();
  const forget = vi.spyOn(client, 'forgetExpiredParcelLinks').mockResolvedValue({ links: 3, packages: 2, stopped: 4, alerts: 5 });
  vi.spyOn(client, 'publicLookupUsageSummary').mockResolvedValue({ buckets: 40, p50: 2, p90: 9, max: 15 });
  const forgotten = vi.spyOn(metrics, 'recordParcelsForgotten');
  const ended = vi.spyOn(metrics, 'recordParcelAlertRemoved');
  const usage = vi.spyOn(metrics, 'recordPublicLookupUsage');
  const logged = vi.spyOn(monitoring, 'logOperationalEvent');
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  worker.stop();
  expect(forget).toHaveBeenCalledOnce();
  expect(forgotten.mock.calls).toEqual([
    ['expired', { links: 3, packages: 2, stopped: 4, alerts: 5 }],
    ['stopped', { links: 4, packages: 0 }],
  ]);
  expect(ended).toHaveBeenCalledExactlyOnceWith('delivered', 5);
  expect(usage).toHaveBeenCalledExactlyOnceWith({ buckets: 40, p50: 2, p90: 9, max: 15 });
  expect(logged).toHaveBeenCalledWith('parcel_links_forgotten', { links: 3, packages: 2, stopped: 4, alerts: 5 });
  expect(finish).toHaveBeenCalledExactlyOnceWith('job', worker.workerId, { result: expect.objectContaining({ checked: 0 }) });
});

it('finishes the scheduled sync when forgetting fails, and reports it', async () => {
  const { client, finish, state, worker } = scheduledRun();
  const failure = new SupabaseError('database down', 503);
  vi.spyOn(client, 'forgetExpiredParcelLinks').mockRejectedValue(failure);
  const usage = vi.spyOn(client, 'publicLookupUsageSummary');
  const report = vi.spyOn(monitoring, 'captureOperationalError').mockReturnValue(null);
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  worker.stop();
  expect(report).toHaveBeenCalledExactlyOnceWith(failure, expect.objectContaining({ component: 'parcel-links', operation: 'maintenance' }));
  expect(usage).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledExactlyOnceWith('job', worker.workerId, { result: expect.anything() });
  expect(state.lastError).toBeNull();
});
