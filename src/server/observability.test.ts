import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  databaseUnavailable,
  errorType,
  logOperationalEvent,
  operationalErrorMetadata,
  parseSampleRate,
  reportRoutingEvent,
  resolveSentryRelease,
  shouldReportOutage,
  shouldReportRepeatedFailure,
  trackingAttemptId,
  withTrackingAttempt,
} from './observability';
import { UpstreamHttpError } from 'universal-parcel-scraper/node';
import { SupabaseError } from './supabase';
import { TrackingCaptureError, SeventeenTrackLookupError, SeventeenTrackNoHistoryError } from 'universal-parcel-scraper/node';

afterEach(() => vi.restoreAllMocks());

describe('structured operational logs', () => {
  it('retains supplied diagnostic fields in structured logs', () => {
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
    expect(payload).toHaveProperty('package_id');
    expect(payload).toHaveProperty('status_text');
    expect(payload).toHaveProperty('tracking_url');
    expect(payload).toHaveProperty('authorization');
  });
});

describe('the check a line belongs to', () => {
  it('names the attempt on the routing lines of its lookups, and on no other', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await Promise.all(['first', 'second'].map((attempt) => withTrackingAttempt(attempt, async () => {
      await Promise.resolve();
      reportRoutingEvent('fresher_provider_found', { carrier: 'dhl', provider: 'ParcelsApp' });
    })));
    reportRoutingEvent('fresher_provider_found', { carrier: 'dhl', provider: 'ParcelsApp' });
    // The sync names its attempt where it reports outside the lookup.
    reportRoutingEvent('carrier_auto_swapped', { carrier: 'dhl', provider: 'ups', attemptId: 'third' });
    const lines = output.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(lines.map((line) => line.attempt_id)).toEqual(['first', 'second', undefined, 'third']);
    expect(trackingAttemptId()).toBeUndefined();
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

  it('reports an outage once it has lasted two minutes, then each time it has doubled', () => {
    expect([0, 10_000, 119_999].some((failingFor) => shouldReportOutage(failingFor, null))).toBe(false);
    expect(shouldReportOutage(120_000, null)).toBe(true);
    expect(shouldReportOutage(180_000, 123_000)).toBe(false);
    expect(shouldReportOutage(245_999, 123_000)).toBe(false);
    expect(shouldReportOutage(246_000, 123_000)).toBe(true);
    expect(shouldReportOutage(Number.NaN, null)).toBe(false);
    expect(shouldReportOutage(Number.POSITIVE_INFINITY, null)).toBe(false);
  });

  it('tells a database that does not answer from one that refuses', () => {
    expect(databaseUnavailable(new SupabaseError('The delivery database is unreachable', undefined, 'unreachable'))).toBe(true);
    for (const status of [502, 503, 504]) {
      expect(databaseUnavailable(new SupabaseError(`Supabase POST request failed (${status})`, status))).toBe(true);
    }
    // A copy of the class from another bundle is recognised by its name.
    const copy = Object.assign(new Error('Supabase POST request failed (503)'), { name: 'SupabaseError', status: 503 });
    expect(databaseUnavailable(copy)).toBe(true);

    for (const refusal of [
      new SupabaseError('Supabase POST request failed (500)', 500, '55000'),
      new SupabaseError('Supabase POST request failed (500)', 500),
      new SupabaseError('Supabase POST request failed (400)', 400, '42804'),
      new SupabaseError('Supabase POST request failed (401)', 401),
      new SupabaseError('Supabase POST request failed (404)', 404, 'PGRST202'),
      new SupabaseError('The durable sync job could not be queued'),
      Object.assign(new Error('gateway'), { status: 503, code: 'unreachable' }),
      new Error('offline'),
      'unreachable',
      null,
    ]) {
      expect(databaseUnavailable(refusal)).toBe(false);
    }
  });

  it('does not treat an arbitrary exception name as telemetry metadata', () => {
    const error = new Error('private');
    error.name = 'TRACKING123';
    expect(errorType(error)).toBe('Error');
    error.name = 'CarrierTimeoutError';
    expect(errorType(error)).toBe('CarrierTimeoutError');
  });

  it('keeps actionable scraper reasons and status codes without provider response text', () => {
    expect(operationalErrorMetadata(new TrackingCaptureError('capture_unreadable')))
      .toEqual({ providerFailureReason: 'capture_unreadable' });
    expect(operationalErrorMetadata(new SeventeenTrackLookupError('lookup_unavailable', 400)))
      .toEqual({ providerFailureReason: 'lookup_unavailable', providerCode: 400 });
    expect(operationalErrorMetadata(new SeventeenTrackNoHistoryError()))
      .toEqual({ providerFailureReason: 'no_history', providerCode: 400 });
    expect(operationalErrorMetadata(new Error('recovery timed out', { cause: new UpstreamHttpError('DHL eCommerce tracking', 428) })))
      .toEqual({ upstreamStatus: 428 });
    const forged = Object.assign(new Error('PRIVATE'), { reason: 'PRIVATE', providerCode: 1234567890 });
    forged.name = 'TrackingCaptureError';
    expect(operationalErrorMetadata(forged)).toEqual({});
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
