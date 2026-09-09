import { afterEach, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';
import { captureOperationalError, flushObservability, initObservability } from './observability';
import { UniversalTrackingError } from './universalTracking';
import { UpstreamHttpError } from './boundedFetch';

const captured = vi.hoisted(() => ({ events: [] as Event[] }));

// Exercise the real SDK event pipeline, replacing only transport so diagnostic
// fixtures never leave the test process.
vi.mock('@sentry/node', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@sentry/node')>();
  return {
    ...sdk,
    init: vi.fn((options: Parameters<typeof sdk.init>[0]) => sdk.init({
      ...options,
      skipOpenTelemetrySetup: true,
      registerEsmLoaderHooks: false,
      transport: () => ({
        send: async (envelope) => {
          for (const [header, payload] of envelope[1]) {
            if (header.type === 'event') captured.events.push(payload as Event);
          }
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    })),
  };
});

afterEach(async () => {
  await Sentry.close();
  Sentry.getCurrentScope().clear();
  Sentry.getIsolationScope().clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('retains original exceptions, provider causes, and SDK diagnostic context', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  vi.stubEnv('SENTRY_ENVIRONMENT', 'test');
  expect(initObservability()).toBe(true);
  const error = new UniversalTrackingError([
    { source: '17TRACK', reason: 'history unavailable', error: new Error('17TRACK returned HTTP 429') },
    { source: 'ParcelsApp', reason: 'history unavailable', error: new Error('ParcelsApp identity missing') },
  ]);

  let operationalEventId: string | null = null;
  Sentry.withScope((scope) => {
    scope.setUser({ id: 'diagnostic-user' });
    scope.addBreadcrumb({ message: 'Looking up parcel TEST1234' });
    scope.setContext('carrier_response', { number: 'TEST1234', status: 'waiting' });
    scope.setExtra('carrier_payload', { number: 'TEST1234' });
    scope.setTag('tracking_number', 'TEST1234');
    operationalEventId = captureOperationalError(error, {
      component: 'tracking-sync', operation: 'fetch', carrier: 'unknown',
      route: '/api/packages/11111111-1111-1111-1111-111111111111?detail=full',
    });
    Sentry.captureEvent({
      message: 'Direct SDK diagnostic message',
      request: { url: 'https://delivery.example.test/api/packages/TEST1234', method: 'GET' },
      transaction: 'parcel-detail',
      exception: { values: [{ type: 'CarrierError', value: 'Parcel TEST1234 unavailable',
        stacktrace: { frames: [{ filename: '/app/carrier.ts',
          vars: { trackingNumber: 'TEST1234' }, context_line: 'throw carrierError;',
        }] },
      }] },
    });
  });

  expect(await flushObservability()).toBe(true);
  expect(captured.events).toHaveLength(2);
  const operational = captured.events.find((event) => event.event_id === operationalEventId)!;
  expect(operational.exception?.values?.map((value) => value.value)).toEqual(expect.arrayContaining([
    error.message, '17TRACK returned HTTP 429', 'ParcelsApp identity missing',
  ]));
  expect(operational.contexts?.UniversalTrackingError).toHaveProperty('failures');
  expect(operational.tags).toMatchObject({
    tracking_number: 'TEST1234',
    route: '/api/packages/11111111-1111-1111-1111-111111111111?detail=full',
  });
  expect(operational.extra?.carrier_payload).toEqual({ number: 'TEST1234' });
  expect(operational.contexts?.carrier_response).toEqual({ number: 'TEST1234', status: 'waiting' });
  expect(operational.user?.id).toBe('diagnostic-user');
  expect(operational.breadcrumbs).toEqual(expect.arrayContaining([
    expect.objectContaining({ message: 'Looking up parcel TEST1234' }),
  ]));

  const direct = captured.events.find((event) => event.message === 'Direct SDK diagnostic message')!;
  expect(direct.request?.url).toBe('https://delivery.example.test/api/packages/TEST1234');
  expect(direct.transaction).toBe('parcel-detail');
  expect(direct.exception?.values?.[0]).toMatchObject({ value: 'Parcel TEST1234 unavailable',
    stacktrace: { frames: [expect.objectContaining({
      vars: { trackingNumber: 'TEST1234' }, context_line: 'throw carrierError;',
    })] },
  });
  const options = Sentry.getClient()!.getOptions();
  expect(options.beforeSend).toBeUndefined();
  expect(options.dataCollection?.userInfo).toBe(true);
  expect(options.integrations?.map((integration) => integration.name)).toEqual(expect.arrayContaining([
    'Console', 'Http', 'NodeFetch', 'RequestData', 'ExtraErrorData',
  ]));

  const ids = ['first', 'second'].map((attemptId) => captureOperationalError(
    new UpstreamHttpError('GLS Germany tracking', 404), {
      component: 'tracking-sync', operation: 'fetch', carrier: 'gls-de',
      attemptId, jobId: `job-${attemptId}`,
    },
  ));
  await flushObservability();
  const repeats = captured.events.filter((event) => ids.includes(event.event_id!));
  expect(repeats).toHaveLength(2);
  expect(repeats[0].fingerprint).toEqual([
    'delivery-tracker', 'tracking-sync', 'fetch', 'gls-de', 'UpstreamHttpError',
  ]);
  expect(repeats[1].fingerprint).toEqual(repeats[0].fingerprint);
  expect(repeats.map((event) => event.tags?.attempt_id).sort()).toEqual(['first', 'second']);
});
