import { describe, expect, it } from 'vitest';
import { InputRequiredError, MaintenanceError, RateLimitedError, ChallengeError } from '@carriers/core/errors';
import { deferredTrackingFailure, trackingFailureCode } from './trackingFailure';

describe('public tracking failure codes', () => {
  it('retains typed causes without leaking diagnostic text', () => {
    expect(trackingFailureCode(new Error('secret diagnostic', { cause: new InputRequiredError('Heppner', 'postcode') }))).toBe('carrier:input_required');
    expect(trackingFailureCode(new MaintenanceError('Carrier'))).toBe('carrier:maintenance');
    expect(trackingFailureCode(new RateLimitedError('Carrier'))).toBe('carrier:rate_limited');
    expect(trackingFailureCode(new ChallengeError('Carrier'))).toBe('carrier:challenge');
    expect(trackingFailureCode(new Error('unclassified'))).toBeNull();
  });

  it('keeps missing input actionable after fallback attempts, without blaming mixed failures on one provider', () => {
    expect(deferredTrackingFailure({ heppner: { kind: 'schema', user_error: 'carrier:input_required' }, universal: { kind: 'transport' } }, 'heppner')).toBe('carrier:input_required');
    expect(deferredTrackingFailure({ other: { kind: 'schema', user_error: 'carrier:input_required' }, universal: { kind: 'transport' } }, 'heppner')).toBeNull();
    expect(deferredTrackingFailure({ first: { kind: 'rate_limited' }, second: { kind: 'rate_limited' } }, 'heppner')).toBe('carrier:rate_limited');
    expect(deferredTrackingFailure({ first: { kind: 'rate_limited' }, second: { kind: 'transport' } }, 'heppner')).toBeNull();
  });
});
