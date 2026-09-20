import { describe, expect, it, vi } from 'vitest';
import { healthMessage, healthStepRecorder, observeTrackingHealth, type HealthSample } from './trackingHealth';
import { TrackingSyncAudit } from './trackingAudit';
import type { SupabaseServiceClient } from './supabase';
import * as observability from './observability';

const step = { carrier: 'ups', step: 'direct', attempt: 1, outcome: 'transport' as const,
  errorType: 'UpstreamNetworkError', durationMs: 200, fallbackFrom: null,
  fallbackReason: null, fallbackErrorType: null };

describe('tracking health evidence', () => {
  it('isolates overlapping syncs and counts the lookup rather than each retry', async () => {
    const a = new Map<string, HealthSample>();
    const b = new Map<string, HealthSample>();
    await Promise.all([
      observeTrackingHealth(a, async () => {
        healthStepRecorder.step(step);
        await Promise.resolve();
        healthStepRecorder.step({ ...step, step: 'retry', attempt: 2, outcome: 'ok' });
        healthStepRecorder.lookup({ carrier: 'ups', finalStep: 'trawl', outcome: 'ok', errorType: null, durationMs: 250, attempts: 2 });
      }),
      observeTrackingHealth(b, async () => {
        await Promise.resolve();
        healthStepRecorder.step({ ...step, carrier: 'dpd', outcome: 'ok' });
      }),
    ]);
    expect([...a.values()]).toMatchObject([{ subject: 'ups', kind: 'direct', healthy: false }, { subject: 'ups', kind: 'provider', healthy: true }]);
    expect([...b.values()]).toMatchObject([{ subject: 'dpd', healthy: true }]);
  });

  it('records missing input and not-found answers as healthy transports, not outages', async () => {
    const samples = new Map<string, HealthSample>();
    await observeTrackingHealth(samples, async () => {
      healthStepRecorder.step({ ...step, outcome: 'input_required' });
      healthStepRecorder.lookup({ carrier: 'ups', finalStep: 'direct', outcome: 'not_found', errorType: 'NotFoundError', durationMs: 1, attempts: 1 });
    });
    expect([...samples.values()]).toEqual([
      expect.objectContaining({ kind: 'direct', healthy: true, details: expect.objectContaining({ category: 'input_required' }) }),
      expect.objectContaining({ kind: 'provider', healthy: true, details: expect.objectContaining({ category: 'not_found' }) }),
    ]);
  });

  it('keeps one sample when direct is the only tier a carrier has', async () => {
    const samples = new Map<string, HealthSample>();
    await observeTrackingHealth(samples, async () => {
      healthStepRecorder.step({ ...step, carrier: 'swiss-post' });
      healthStepRecorder.lookup({ carrier: 'swiss-post', finalStep: 'direct', outcome: 'transport',
        errorType: 'UpstreamHttpError', durationMs: 200, attempts: 1, stepsAvailable: 1 });
    });
    expect([...samples.values()]).toEqual([expect.objectContaining({ kind: 'provider', subject: 'swiss-post', healthy: false })]);
  });

  it('explains user impact, maintenance and rate-limit next steps', () => {
    expect(healthMessage({ subject: 'la-poste', kind: 'direct', state: 'open', attempts: 12, failures: 8, window_hours: 24,
      evidence: { http_status: 403 } })).toMatchObject({ title: expect.stringContaining('8/12'), nextSteps: expect.stringContaining('maintenance'), impact: expect.stringContaining('not the final shipment refresh') });
    expect(healthMessage({ subject: 'Ship24', evidence: { http_status: 429 } }).nextSteps).toContain('Retry-After');
    expect(healthMessage({ subject: 'ups', state: 'recovered' }).nextSteps).toContain('No action needed');
  });
});

it('keeps the failing tier as refresh evidence when the attempt only reports a deferral', async () => {
  const client = { completeSyncAttempt: vi.fn().mockResolvedValue(true),
    recordTrackingHealth: vi.fn().mockResolvedValue([]), ackTrackingHealth: vi.fn() };
  const audit = new TrackingSyncAudit(client as unknown as SupabaseServiceClient,
    'synthetic-package', 'TEST1234', 'ups', 'in_transit', { trigger: 'scheduled' });
  await audit.observeFetch(async () => {
    healthStepRecorder.step(step);
    healthStepRecorder.lookup({ carrier: 'ups', finalStep: 'direct', outcome: 'transport',
      errorType: 'UpstreamNetworkError', durationMs: 200, attempts: 1 });
  });
  const deferred = Object.assign(new Error('every provider failed'), { name: 'RoutingDeferredError' });
  await audit.finish({ outcome: 'error', error: deferred });
  expect(client.completeSyncAttempt).toHaveBeenCalledWith(expect.any(String),
    expect.objectContaining({ error_type: 'RoutingDeferredError' }), expect.any(Array));
  expect(client.recordTrackingHealth).toHaveBeenLastCalledWith(expect.any(String), 'synthetic-package',
    expect.arrayContaining([expect.objectContaining({ kind: 'refresh', healthy: false,
      details: expect.objectContaining({ error_type: 'UpstreamNetworkError' }) })]));
});

it('evaluates only scheduled outcomes and acknowledges only flushed incident events', async () => {
  const capture = vi.spyOn(observability, 'captureTrackingHealth').mockReturnValue('event-id');
  const flush = vi.spyOn(observability, 'flushObservability').mockResolvedValue(false);
  const client = { completeSyncAttempt: vi.fn().mockResolvedValue(true),
    recordTrackingHealth: vi.fn().mockResolvedValue([{ id: 'notice-id' }]), ackTrackingHealth: vi.fn() };
  const audit = (trigger: 'package' | 'scheduled') => new TrackingSyncAudit(client as unknown as SupabaseServiceClient,
    'synthetic-package', 'TEST1234', 'ups', 'in_transit', { trigger });
  try {
    await audit('package').finish({ outcome: 'error' });
    expect(client.recordTrackingHealth).not.toHaveBeenCalled();
    const failed = audit('scheduled');
    failed.record('fetch', 'failed', 100);
    await failed.finish({ outcome: 'waiting' });
    expect(client.recordTrackingHealth).toHaveBeenLastCalledWith(expect.any(String), 'synthetic-package',
      [expect.objectContaining({ kind: 'refresh', healthy: false })]);
    expect(client.ackTrackingHealth).not.toHaveBeenCalled();
    flush.mockResolvedValue(true);
    await audit('scheduled').finish({ outcome: 'updated' });
    expect(client.ackTrackingHealth).toHaveBeenCalledWith(['notice-id']);
  } finally { capture.mockRestore(); flush.mockRestore(); }
});
