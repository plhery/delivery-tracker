import { afterEach, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';
import { captureOperationalError, flushObservability, initObservability, reportRoutingEvent } from './observability';
import { UniversalTrackingError } from './universalTracking';
import { UpstreamHttpError } from './boundedFetch';
import { LaPosteTracker } from './laPoste';

const captured = vi.hoisted(() => ({ events: [] as Event[] }));

// Exercise the real SDK event pipeline, replacing only transport so diagnostic
// fixtures never leave the test process.
vi.mock('@sentry/node', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@sentry/node')>();
  return {
    ...sdk,
    init: vi.fn((options: Parameters<typeof sdk.init>[0]) => sdk.init({
      ...options,
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
    operationalEventId = captureOperationalError(error, {
      component: 'tracking-sync', operation: 'fetch', carrier: 'unknown',
      trackingNumber: 'TEST1234',
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
      trackingNumber: `TEST-${attemptId}`,
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
  expect(repeats.map((event) => event.tags?.tracking_number).sort()).toEqual(['TEST-first', 'TEST-second']);
  reportRoutingEvent('provider_failed', { carrier: 'dhl', provider: '17TRACK',
    category: 'rate_limited', trackingNumber: 'TEST-first', errorClass: 'UpstreamHttpError', error: new UpstreamHttpError('17TRACK', 429) });
  reportRoutingEvent('carrier_auto_swapped', { carrier: 'dhl', provider: 'ups', trackingNumber: 'TEST-first' });
  reportRoutingEvent('provider_recovered', { carrier: 'dhl', provider: '17TRACK' });
  reportRoutingEvent('direct_support_opportunity', { carrier: 'fedex', provider: 'fedex' });
  await flushObservability();
  const rateLimit = captured.events.find((event) => event.message === 'Tracking routing: provider_failed')!;
  const swap = captured.events.find((event) => event.message === 'Tracking routing: carrier_auto_swapped')!;
  expect(swap.level).toBe('info');
  expect(swap.tags).toMatchObject({ carrier: 'dhl', provider: 'ups', tracking_number: 'TEST-first' });
  expect(rateLimit.tags).toMatchObject({ component: 'tracking-routing', provider: '17TRACK', failure_category: 'rate_limited', error_type: 'UpstreamHttpError', upstream_status: 429 });
  expect(rateLimit.fingerprint).toEqual(['delivery-tracker', 'tracking-routing', 'provider_failed', '17TRACK', 'rate_limited']);
  expect(captured.events.some((event) => event.message === 'Tracking routing: provider_recovered')).toBe(true);
  expect(captured.events.some((event) => event.message === 'Tracking routing: direct_support_opportunity')).toBe(true);

  const refusedBody = '<h1>Access Denied</h1><p>Reference #18.test.123; parcel 8U00000000000</p>';
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(refusedBody, {
    status: 403, headers: { 'content-type': 'text/html', 'x-request-id': 'example-request-id',
      'set-cookie': 'session=DO_NOT_CAPTURE', authorization: 'Bearer DO_NOT_CAPTURE', 'retry-after': '120' },
  }));
  const refused = await new LaPosteTracker().fetch('8U00000000000').catch((error: unknown) => error);
  fetcher.mockRestore();
  expect(refused).toBeInstanceOf(UpstreamHttpError);
  reportRoutingEvent('provider_failed', { carrier: 'la-poste', provider: 'la-poste',
    category: 'verification', error: refused, errorClass: 'UpstreamHttpError' });
  const wrappedId = captureOperationalError(new Error('Recovery failed', { cause: refused }), {
    component: 'tracking-sync', operation: 'fetch', carrier: 'la-poste',
  });
  reportRoutingEvent('provider_recovered', { carrier: 'la-poste', provider: 'la-poste' });
  await flushObservability();
  const refusal = captured.events.find((event) => event.message === 'Tracking routing: provider_failed' && event.tags?.provider === 'la-poste')!;
  expect(refusal.contexts?.upstream_http).toMatchObject({ body_excerpt: refusedBody, body_read: 'complete',
    content_type: 'text/html', request_ids: { 'x-request-id': 'example-request-id' }, retry_after_ms: 120_000,
    body_signals: ['access_denied'] });
  expect(refusal.tags).toMatchObject({ upstream_status: 403, upstream_content_type: 'text/html', upstream_body_read: 'complete' });
  expect(refusal.fingerprint).toEqual(['delivery-tracker', 'tracking-routing', 'provider_failed', 'la-poste', 'verification']);
  expect(captured.events.find((event) => event.event_id === wrappedId)?.contexts?.upstream_http).toEqual(refusal.contexts?.upstream_http);
  expect(refusal.contexts?.upstream_http?.headers).toMatchObject({ 'set-cookie': 'session=DO_NOT_CAPTURE', authorization: 'Bearer DO_NOT_CAPTURE' });
  expect(refusal.exception?.values?.at(-1)).toMatchObject({ type: 'UpstreamHttpError', value: 'La Poste tracking returned HTTP 403' });
  expect(refusal.contexts?.UpstreamHttpError).toHaveProperty('request');
  const recovery = captured.events.find((event) => event.message === 'Tracking routing: provider_recovered' && event.tags?.provider === 'la-poste')!;
  expect(recovery.contexts?.upstream_http).toBeUndefined();
  expect(recovery.tags?.upstream_body_read).toBeUndefined();
});
