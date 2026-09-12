import { describe, expect, it, vi } from 'vitest';
import { ChallengeError, NotFoundError, RateLimitedError, SchemaError, TransportError } from '../errors';
import type { LookupRecord, StepRecord, StepRecorder } from '../telemetry';
import { recoverableByDefault, runSteps, singleFlight } from './index';

function recorder(): StepRecorder & { steps: StepRecord[]; lookups: LookupRecord[] } {
  const steps: StepRecord[] = [];
  const lookups: LookupRecord[] = [];
  return { steps, lookups, step: (record) => { steps.push(record); }, lookup: (record) => { lookups.push(record); } };
}

describe('runSteps', () => {
  it('returns the first step result and records one ok step and one ok lookup', async () => {
    const sink = recorder();
    const value = await runSteps({ carrier: 'ctt', budgetMs: 1_000, recorder: sink }, [
      { id: 'direct', run: async () => 'history' },
      { id: 'trawl', run: async () => { throw new Error('must not run'); } },
    ]);
    expect(value).toBe('history');
    expect(sink.steps).toEqual([expect.objectContaining({ step: 'direct', attempt: 1, outcome: 'ok', fallbackFrom: null })]);
    expect(sink.lookups).toEqual([expect.objectContaining({ finalStep: 'direct', outcome: 'ok', attempts: 1 })]);
  });

  it('falls through to the next step after a challenge and reports the fallback', async () => {
    const sink = recorder();
    const value = await runSteps({ carrier: 'ups', budgetMs: 1_000, recorder: sink }, [
      { id: 'direct', run: async () => { throw new ChallengeError('UPS'); } },
      { id: 'trawl', run: async ({ previousError }) => (previousError instanceof ChallengeError ? 'browser history' : 'wrong') },
    ]);
    expect(value).toBe('browser history');
    expect(sink.steps.map((step) => [step.step, step.outcome, step.fallbackFrom, step.fallbackReason])).toEqual([
      ['direct', 'challenge', null, null],
      ['trawl', 'ok', 'direct', 'challenge'],
    ]);
    expect(sink.lookups[0]).toMatchObject({ finalStep: 'trawl', outcome: 'ok', attempts: 2 });
  });

  it('does not recover from a definite answer such as not found or rate limited', async () => {
    const sink = recorder();
    const trawl = vi.fn(async () => 'never');
    await expect(runSteps({ carrier: 'dhl', budgetMs: 1_000, recorder: sink }, [
      { id: 'direct', run: async () => { throw new NotFoundError('DHL'); } },
      { id: 'trawl', run: trawl },
    ])).rejects.toBeInstanceOf(NotFoundError);
    expect(trawl).not.toHaveBeenCalled();
    expect(sink.lookups[0]).toMatchObject({ finalStep: 'direct', outcome: 'not_found', attempts: 1, errorType: 'NotFoundError' });
    await expect(runSteps({ carrier: 'dhl', budgetMs: 1_000 }, [
      { id: 'direct', run: async () => { throw new RateLimitedError('DHL', 5_000); } },
      { id: 'trawl', run: trawl },
    ])).rejects.toBeInstanceOf(RateLimitedError);
    expect(trawl).not.toHaveBeenCalled();
  });

  it('lets a step opt in to recovering from a definite answer', async () => {
    const value = await runSteps({ carrier: 'ups', budgetMs: 1_000 }, [
      { id: 'api', run: async () => { throw new SchemaError('UPS'); } },
      { id: 'rendered-page', recovers: (error) => error instanceof SchemaError, run: async () => 'parsed from html' },
    ]);
    expect(value).toBe('parsed from html');
  });

  it('skips disabled steps and rethrows the last error when nothing recovers', async () => {
    const sink = recorder();
    const failure = new TransportError('DPD');
    await expect(runSteps({ carrier: 'dpd', budgetMs: 1_000, recorder: sink }, [
      { id: 'direct', run: async () => { throw failure; } },
      { id: 'trawl', enabled: false, run: async () => 'unreachable' },
    ])).rejects.toBe(failure);
    expect(sink.steps).toHaveLength(1);
    expect(sink.lookups[0]).toMatchObject({ finalStep: 'direct', outcome: 'transport', attempts: 1 });
  });

  it('enforces the budget across steps', async () => {
    let clock = 0;
    const sink = recorder();
    await expect(runSteps({ carrier: 'x', budgetMs: 100, recorder: sink, now: () => clock }, [
      { id: 'direct', run: async () => { clock = 150; throw new TransportError('X'); } },
      { id: 'trawl', run: async () => 'late' },
    ])).rejects.toMatchObject({ kind: 'budget' });
    expect(sink.lookups[0]).toMatchObject({ outcome: 'budget', finalStep: 'direct' });
  });

  it('gives each step an abort signal and the remaining budget', async () => {
    let seen: { remainingMs: number; aborted: boolean } | undefined;
    await runSteps({ carrier: 'x', budgetMs: 5_000 }, [
      { id: 'direct', run: async ({ signal, remainingMs }) => { seen = { remainingMs, aborted: signal.aborted }; return 1; } },
    ]);
    expect(seen).toEqual({ remainingMs: expect.any(Number), aborted: false });
    expect(seen!.remainingMs).toBeLessThanOrEqual(5_000);
  });

  it('never lets a broken recorder change the result', async () => {
    const broken: StepRecorder = { step: () => { throw new Error('sink down'); }, lookup: () => { throw new Error('sink down'); } };
    await expect(runSteps({ carrier: 'x', budgetMs: 1_000, recorder: broken }, [{ id: 'direct', run: async () => 'ok' }])).resolves.toBe('ok');
  });

  it('classifies recoverable errors by kind', () => {
    expect(recoverableByDefault(new ChallengeError('X'))).toBe(true);
    expect(recoverableByDefault(new Error('unclassified'))).toBe(true);
    expect(recoverableByDefault(new NotFoundError('X'))).toBe(false);
    expect(recoverableByDefault(new SchemaError('X'))).toBe(false);
  });
});

describe('singleFlight', () => {
  it('serializes operations in call order', async () => {
    const lock = singleFlight();
    const order: string[] = [];
    const first = lock(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); order.push('first'); return 1; });
    const second = lock(async () => { order.push('second'); return 2; });
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(['first', 'second']);
  });

  it('releases the lock after a failure', async () => {
    const lock = singleFlight();
    await expect(lock(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(lock(async () => 'after')).resolves.toBe('after');
  });
});
