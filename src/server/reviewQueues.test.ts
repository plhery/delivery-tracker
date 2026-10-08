import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../package.json';
import * as observability from './observability';
import {
  deployedVersion,
  MAX_REPLAYED_CASES,
  replayReviewQueues,
  replaySupportCase,
  ReviewQueueReplay,
} from './reviewQueues';
import { SupabaseError, type SupabaseServiceClient } from './supabase';

const scraper = `universal-parcel-scraper@${manifest.dependencies['universal-parcel-scraper']}`;

function fakeClient(claims: Array<'claimed' | 'running' | 'done' | Error> = ['claimed']) {
  const claim = vi.fn();
  for (const answer of claims) {
    if (answer instanceof Error) claim.mockRejectedValueOnce(answer);
    else claim.mockResolvedValueOnce(answer);
  }
  return {
    claimTrackingReviewRun: claim.mockResolvedValue('done'),
    listOpenTrackingSupportCases: vi.fn().mockResolvedValue([
      // A Royal Mail shape the configured carrier now tracks directly.
      { id: 'case-royal', tracking_number: 'RR123456785GB', configured_carrier: 'royal-mail' },
      // Still ambiguous, and still without a direct adapter.
      { id: 'case-ambiguous', tracking_number: '123456789012', configured_carrier: 'fedex' },
      { id: 'case-adapter', tracking_number: 'RR123456785IE', configured_carrier: 'an-post' },
    ]),
    fixReplayedTrackingSupportCases: vi.fn().mockResolvedValue(1),
    finishTrackingReviewRun: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('review queue replay', () => {
  it('names the scraper the app pins and, in an image, the app commit', () => {
    expect(deployedVersion({})).toBe(scraper);
    expect(deployedVersion({ IMAGE_COMMIT: 'not-a-commit' })).toBe(scraper);
    expect(deployedVersion({ IMAGE_COMMIT: `${'A1'.repeat(20)}\n` })).toBe(`${scraper} app@a1a1a1a1a1a1`);
    expect(deployedVersion({ IMAGE_COMMIT: 'a'.repeat(40) }).length).toBeLessThanOrEqual(100);
  });

  it('resolves a case only when detection and adapters leave no gap', () => {
    expect(replaySupportCase('RR123456785GB', 'royal-mail'))
      .toBe('Replay found no gap: detection names royal-mail with high confidence.');
    expect(replaySupportCase('123456789012', 'fedex')).toBeNull();
    expect(replaySupportCase('RR123456785IE', 'an-post')).toBeNull();
    expect(replaySupportCase('RR123456785FI', null)).toBeNull();
  });

  it('fixes the resolved open cases once and records the outcome for the version', async () => {
    const client = fakeClient();
    await expect(replayReviewQueues(client as unknown as SupabaseServiceClient, 'v1'))
      .resolves.toEqual({ cases_replayed: 3, cases_fixed: 1 });
    expect(client.claimTrackingReviewRun).toHaveBeenCalledExactlyOnceWith('v1', 600);
    expect(client.listOpenTrackingSupportCases).toHaveBeenCalledExactlyOnceWith(MAX_REPLAYED_CASES);
    expect(client.fixReplayedTrackingSupportCases).toHaveBeenCalledExactlyOnceWith('v1', [{
      id: 'case-royal', configured_carrier: 'royal-mail',
      note: 'Replay found no gap: detection names royal-mail with high confidence.',
    }]);
    expect(client.finishTrackingReviewRun).toHaveBeenCalledExactlyOnceWith('v1', { cases_replayed: 3, cases_fixed: 1 });
  });

  it('leaves the cases alone while another server replays them or once one did', async () => {
    for (const state of ['running', 'done'] as const) {
      const client = fakeClient([state]);
      await expect(replayReviewQueues(client as unknown as SupabaseServiceClient, 'v1')).resolves.toBe(state);
      expect(client.listOpenTrackingSupportCases).not.toHaveBeenCalled();
      expect(client.finishTrackingReviewRun).not.toHaveBeenCalled();
    }
  });

  it('finishes a replay that resolved nothing without writing cases', async () => {
    const client = fakeClient();
    client.listOpenTrackingSupportCases.mockResolvedValue([
      { id: 'case-ambiguous', tracking_number: '123456789012', configured_carrier: 'fedex' },
    ]);
    await expect(replayReviewQueues(client as unknown as SupabaseServiceClient, 'v1'))
      .resolves.toEqual({ cases_replayed: 1, cases_fixed: 0 });
    expect(client.fixReplayedTrackingSupportCases).not.toHaveBeenCalled();
  });

  it('runs a minute after startup, waits for another server, and stops once done', async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => undefined);
    const client = fakeClient(['running', 'claimed']);
    const replay = new ReviewQueueReplay(client as unknown as SupabaseServiceClient, 'v1');
    replay.start();
    replay.start();
    await vi.advanceTimersByTimeAsync(59_000);
    expect(client.claimTrackingReviewRun).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.claimTrackingReviewRun).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(client.claimTrackingReviewRun).toHaveBeenCalledTimes(2);
    expect(logged).toHaveBeenCalledExactlyOnceWith('review_queues_replayed', { version: 'v1', cases_replayed: 3, cases_fixed: 1 });
    replay.start();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(client.claimTrackingReviewRun).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a failed replay, reporting it once and never a database outage', async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => undefined);
    const captured = vi.spyOn(observability, 'captureOperationalError').mockReturnValue(null);
    const outage = new SupabaseError('Supabase request failed', 503);
    const client = fakeClient([outage, new Error('replay failed'), new Error('replay failed'), 'done']);
    const replay = new ReviewQueueReplay(client as unknown as SupabaseServiceClient, 'v1');
    replay.start();
    await vi.advanceTimersByTimeAsync(60_000 + 3 * 5 * 60_000);
    expect(client.claimTrackingReviewRun).toHaveBeenCalledTimes(4);
    expect(logged.mock.calls.filter(([event]) => event === 'review_queue_replay_failed')).toEqual([
      ['review_queue_replay_failed', { version: 'v1', error_type: 'SupabaseError' }, 'error'],
      ['review_queue_replay_failed', { version: 'v1', error_type: 'Error' }, 'error'],
      ['review_queue_replay_failed', { version: 'v1', error_type: 'Error' }, 'error'],
    ]);
    expect(captured).toHaveBeenCalledExactlyOnceWith(expect.any(Error), { component: 'review-queues', operation: 'replay' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not run once stopped', async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const replay = new ReviewQueueReplay(client as unknown as SupabaseServiceClient, 'v1');
    replay.start();
    replay.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(client.claimTrackingReviewRun).not.toHaveBeenCalled();
  });
});
