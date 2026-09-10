import { afterEach, expect, it, vi } from 'vitest';
import { SyncJobWorker, type BackgroundState } from './background';
import { SupabaseServiceClient } from './supabase';
import { TrackingSyncService, type SyncSummary } from './trackingSync';
import * as monitoring from './observability';
import { TrackingSyncAudit } from './trackingAudit';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const summary: SyncSummary = { checked: 0, updated: 0, waiting: 0, errors: 0, unsupported: 0,
  superseded: 0, notifications_sent: 0, notification_errors: 0, subscriptions_expired: 0 };
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
it('releases an active job without waiting for an uncooperative carrier, and prevents late completion', async () => {
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
  await Promise.all([worker.drain(), worker.drain()]);
  expect(signal?.aborted).toBe(true);
  expect(release).toHaveBeenCalledExactlyOnceWith('job', worker.workerId);
  resolve(summary);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(finish).not.toHaveBeenCalled();
  expect(claim).toHaveBeenCalledOnce();
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
  worker.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(begin).not.toHaveBeenCalled();
  expect(end).toHaveBeenCalledWith(checkIn, 'ok');
  expect(finish).toHaveBeenCalledOnce();
  worker.stop();
});
