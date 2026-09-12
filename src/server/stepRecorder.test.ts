import { beforeEach, describe, expect, it, vi } from 'vitest';

const metrics = { distribution: vi.fn(), count: vi.fn() };
const observability = { initObservability: vi.fn(() => true), logOperationalEvent: vi.fn(), reportRoutingEvent: vi.fn() };

vi.mock('@sentry/node', () => ({ metrics }));
vi.mock('./observability', () => observability);

const { sentryStepRecorder, addStepRecorder, hostStepRecorder } = await import('./stepRecorder');

describe('sentryStepRecorder', () => {
  beforeEach(() => {
    metrics.distribution.mockClear();
    metrics.count.mockClear();
    observability.logOperationalEvent.mockClear();
    observability.reportRoutingEvent.mockClear();
  });

  it('keeps the historical metric names and phase labels for a plain step', () => {
    sentryStepRecorder.step({
      carrier: 'dhl', step: 'direct', attempt: 1, outcome: 'ok', errorType: null, durationMs: 120.4,
      fallbackFrom: null, fallbackReason: null, fallbackErrorType: null,
    });
    const attributes = { carrier: 'dhl', phase: 'direct', outcome: 'success', error_type: 'none' };
    expect(metrics.distribution).toHaveBeenCalledWith('tracking.scrape.duration', 120.4, { unit: 'millisecond', attributes });
    expect(metrics.count).toHaveBeenCalledWith('tracking.scrape.attempts', 1, { attributes });
    expect(observability.logOperationalEvent).toHaveBeenCalledWith('tracking_scrape', { ...attributes, duration_ms: 120 });
    expect(observability.reportRoutingEvent).not.toHaveBeenCalled();
  });

  it('counts a fallback and reports the transport_fallback warning for recovery steps', () => {
    const previous = new Error('challenged');
    sentryStepRecorder.step({
      carrier: 'ups', step: 'trawl', attempt: 2, outcome: 'ok', errorType: null, durationMs: 3000,
      fallbackFrom: 'direct', fallbackReason: 'challenge', fallbackErrorType: 'ChallengeError', fallbackError: previous,
    });
    expect(observability.reportRoutingEvent).toHaveBeenCalledWith('transport_fallback', {
      carrier: 'ups', provider: 'ups', category: 'trawl', errorClass: 'ChallengeError', error: previous,
    });
    expect(metrics.count).toHaveBeenCalledWith('tracking.scrape.fallbacks', 1, {
      attributes: { carrier: 'ups', from_phase: 'direct', to_phase: 'trawl', error_type: 'ChallengeError' },
    });
  });

  it('records lookups as the total phase with the serving step', () => {
    sentryStepRecorder.lookup({ carrier: 'ups', finalStep: 'trawl', outcome: 'ok', errorType: null, durationMs: 3200, attempts: 2 });
    expect(observability.logOperationalEvent).toHaveBeenCalledWith('tracking_scrape', {
      carrier: 'ups', phase: 'total', outcome: 'success', error_type: 'none', duration_ms: 3200, final_step: 'trawl', attempts: 2,
    });
    sentryStepRecorder.lookup({ carrier: 'ups', finalStep: 'direct', outcome: 'not_found', errorType: 'NotFoundError', durationMs: 50, attempts: 1 });
    expect(metrics.count).toHaveBeenLastCalledWith('tracking.scrape.attempts', 1, {
      attributes: { carrier: 'ups', phase: 'total', outcome: 'error', error_type: 'NotFoundError' },
    });
  });

  it('never throws when a sink fails', () => {
    metrics.count.mockImplementation(() => { throw new Error('sentry down'); });
    observability.logOperationalEvent.mockImplementation(() => { throw new Error('stdout closed'); });
    expect(() => sentryStepRecorder.lookup({ carrier: 'x', finalStep: null, outcome: 'error', errorType: 'Error', durationMs: 1, attempts: 0 })).not.toThrow();
  });

  it('fans out to registered sinks', () => {
    const extra = { step: vi.fn(), lookup: vi.fn() };
    addStepRecorder(extra);
    hostStepRecorder().lookup({ carrier: 'x', finalStep: 'direct', outcome: 'ok', errorType: null, durationMs: 1, attempts: 1 });
    expect(extra.lookup).toHaveBeenCalledTimes(1);
  });
});
