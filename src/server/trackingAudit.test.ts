import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackingSyncAudit } from './trackingAudit';
import { SupabaseServiceClient } from './supabase';
import { trackingSupportEvidence } from './trackingSupport';
import { logOperationalEvent } from './observability';
import { recordRefresh } from './metrics';

vi.mock('./observability', () => ({
  captureOperationalError: vi.fn(), captureTrackingHealth: vi.fn(), captureSyncAnomaly: vi.fn(),
  flushObservability: vi.fn().mockResolvedValue(true), logOperationalEvent: vi.fn(), reportRoutingEvent: vi.fn(),
  errorType: (error: unknown) => error instanceof Error ? error.name : 'Error',
}));
vi.mock('./metrics', () => ({ recordRefresh: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

describe('tracking support audit persistence', () => {
  it('submits the original support context with a leased start and direct evidence with completion', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const request = vi.spyOn(client, 'request').mockResolvedValue(true);
    const lease = { jobId: 'synthetic-job', workerId: 'synthetic-worker' };
    const audit = new TrackingSyncAudit(client, 'synthetic-package', 'hl-123456789 fr', 'dhl', 'pending',
      { trigger: 'scheduled', jobId: lease.jobId, lease }, new Date('2026-09-10T12:00:00Z'));
    await audit.start();
    const evidence = trackingSupportEvidence({ tracking_number: 'HL123456789FR' }, {
      status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-10T11:00:00Z',
    }, 'chronopost', 'updated', false);
    await audit.finish({ outcome: 'updated', sourceCarrier: 'chronopost', supportEvidence: evidence, evaluateHealth: false });

    expect(request).toHaveBeenNthCalledWith(1, '/rest/v1/rpc/start_leased_sync_attempt', {
      method: 'POST', body: {
        p_attempt_id: audit.attemptId, p_job_id: lease.jobId, p_worker_id: lease.workerId,
        p_values: expect.objectContaining({
          package_id: 'synthetic-package', configured_carrier: 'dhl', started_at: '2026-09-10T12:00:00.000Z',
          support_context: expect.objectContaining({
            tracking_number: 'HL123456789FR', configured_carrier: 'dhl',
            reasons: ['ambiguous_shape', 'carrier_mismatch'],
          }),
        }),
      },
    });
    expect(request).toHaveBeenNthCalledWith(2, '/rest/v1/rpc/complete_tracking_sync_attempt', {
      method: 'POST', body: {
        p_attempt_id: audit.attemptId,
        p_values: expect.objectContaining({ outcome: 'updated', source_carrier: 'chronopost' }),
        p_steps: [expect.objectContaining({
          step: 'complete', status: 'succeeded', details: {
            outcome: 'updated', support_lookup_number: 'HL123456789FR',
            support_provider: null, support_direct_progress: true,
          },
        })],
      },
    });
  });

  it('records a fallback success without losing the unresolved detection context', async () => {
    const client = new SupabaseServiceClient('https://database.example', 'service-key');
    const request = vi.spyOn(client, 'request').mockResolvedValue(true);
    const number = 'ZZTEST1234';
    const audit = new TrackingSyncAudit(client, 'synthetic-package', number, 'unknown', 'pending', { trigger: 'package' });
    await audit.start();
    await audit.finish({
      outcome: 'updated', sourceCarrier: 'unknown',
      supportEvidence: trackingSupportEvidence({ tracking_number: number }, {
        status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-10T11:00:00Z', tracking_provider: 'ParcelsApp',
      }, 'unknown', 'updated', false),
    });
    expect(request).toHaveBeenNthCalledWith(1, '/rest/v1/tracking_sync_attempts', {
      method: 'POST', prefer: 'return=minimal', body: expect.objectContaining({
        id: audit.attemptId,
        support_context: expect.objectContaining({ tracking_number: number, reasons: ['unknown_shape'] }),
      }),
    });
    expect(request).toHaveBeenNthCalledWith(2, '/rest/v1/rpc/complete_tracking_sync_attempt', {
      method: 'POST', body: expect.objectContaining({
        p_attempt_id: audit.attemptId, p_values: expect.objectContaining({ outcome: 'updated', source_carrier: 'unknown' }),
        p_steps: [expect.objectContaining({ details: {
          outcome: 'updated', support_lookup_number: number, support_provider: 'ParcelsApp', support_direct_progress: false,
        } })],
      }),
    });
  });
});

describe('a check that found nothing new', () => {
  it('is recorded unchanged with its count of new scans, and still speaks for its carrier', async () => {
    const client = { completeSyncAttempt: vi.fn().mockResolvedValue(true),
      recordTrackingHealth: vi.fn().mockResolvedValue([]), ackTrackingHealth: vi.fn() };
    const audit = new TrackingSyncAudit(client as unknown as SupabaseServiceClient,
      'synthetic-package', 'TEST1234', 'dpd', 'in_transit', { trigger: 'scheduled' });
    await audit.finish({ outcome: 'unchanged', sourceCarrier: 'dpd', eventsNormalized: 3, eventsNew: 0 });
    expect(client.completeSyncAttempt).toHaveBeenCalledWith(audit.attemptId,
      expect.objectContaining({ outcome: 'unchanged', events_normalized: 3, events_new: 0 }), expect.any(Array));
    expect(client.recordTrackingHealth).toHaveBeenCalledWith(audit.attemptId, 'synthetic-package',
      [expect.objectContaining({ kind: 'refresh', subject: 'dpd', healthy: true })]);
    expect(logOperationalEvent).toHaveBeenCalledWith('tracking_sync_completed',
      expect.objectContaining({ outcome: 'unchanged', events_normalized: 3, events_new: 0 }), 'info');
    expect(recordRefresh).toHaveBeenCalledWith('dpd', 'dpd', 'unchanged');
  });
});
