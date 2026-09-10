import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  errorType,
  logOperationalEvent,
  operationalErrorMetadata,
  parseSampleRate,
  resolveSentryRelease,
  shouldReportRepeatedFailure,
} from './observability';
import { UpstreamHttpError } from './boundedFetch';
import { SupabaseError } from './supabase';

afterEach(() => vi.restoreAllMocks());

describe('structured operational logs', () => {
  it('retains tracking numbers while dropping other private fields from structured logs', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logOperationalEvent('tracking_sync_step', {
      attempt_id: 'opaque-attempt',
      carrier: 'dpd-fr',
      tracking_number: '250123456789012',
      package_id: 'private-package',
      status_text: 'private status',
      tracking_url: 'https://carrier.example/secret-link',
      authorization: 'Bearer secret',
    });

    const payload = JSON.parse(String(output.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      event: 'tracking_sync_step',
      attempt_id: 'opaque-attempt',
      carrier: 'dpd-fr',
      tracking_number: '250123456789012',
    });
    expect(payload).not.toHaveProperty('package_id');
    expect(payload).not.toHaveProperty('status_text');
    expect(payload).not.toHaveProperty('tracking_url');
    expect(payload).not.toHaveProperty('authorization');
  });
});

describe('observability configuration', () => {
  it('accepts only bounded trace sample rates', () => {
    expect(parseSampleRate(undefined)).toBe(0);
    expect(parseSampleRate('0.25')).toBe(0.25);
    expect(parseSampleRate('-1', 0.1)).toBe(0.1);
    expect(parseSampleRate('2', 0.1)).toBe(0.1);
    expect(parseSampleRate('invalid', 0.1)).toBe(0.1);
  });

  it('prefers immutable image commits and rejects placeholder releases', () => {
    expect(resolveSentryRelease({
      IMAGE_COMMIT: 'a'.repeat(40),
      SENTRY_RELEASE: 'delivery@fallback',
    })).toBe('a'.repeat(40));
    expect(resolveSentryRelease({ SENTRY_RELEASE: 'delivery@2026.08.31' }))
      .toBe('delivery@2026.08.31');
    expect(resolveSentryRelease({ SENTRY_RELEASE: 'HEAD' })).toBeUndefined();
  });

  it('reports early repeats and then powers of two to prevent alert floods', () => {
    expect([1, 2, 3, 4, 5, 8, 16].filter(shouldReportRepeatedFailure))
      .toEqual([1, 2, 3, 4, 8, 16]);
  });

  it('does not treat an arbitrary exception name as telemetry metadata', () => {
    const error = new Error('private');
    error.name = 'TRACKING123';
    expect(errorType(error)).toBe('Error');
    error.name = 'CarrierTimeoutError';
    expect(errorType(error)).toBe('CarrierTimeoutError');
  });

  it('extracts only bounded status and database code metadata from known errors', () => {
    expect(operationalErrorMetadata(new UpstreamHttpError('Carrier', 503))).toEqual({
      upstreamStatus: 503,
    });

    const database = new SupabaseError('private response', 502, 'PGRST000');
    expect(operationalErrorMetadata(new Error('wrapper', { cause: database }))).toEqual({
      databaseStatus: 502,
      databaseCode: 'PGRST000',
    });

    expect(operationalErrorMetadata(new SupabaseError(
      'private response',
      999,
      'private response text',
    ))).toEqual({});
  });
});
