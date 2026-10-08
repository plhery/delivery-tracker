import { afterEach, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';
import { captureOperationalError, capturePublicAllowance, captureTrackingHealth, flushObservability, initObservability, reportRoutingEvent,
} from './observability';
import { UniversalTrackingError } from 'universal-parcel-scraper/node';
import { UpstreamHttpError } from 'universal-parcel-scraper/node';
import { createAdapterRegistry } from './adapterRegistry';
import { hostStepRecorder } from './stepRecorder';

const captured = vi.hoisted(() => ({ events: [] as Event[] }));

// Exercise the real SDK event pipeline, replacing only transport so diagnostic
// fixtures never leave the test process.
vi.mock('@sentry/node', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@sentry/node')>();
  return {
    ...sdk,
    init: vi.fn((options: Parameters<typeof sdk.init>[0]) => sdk.init({
      ...options,
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
  // The next test starts the SDK again.
  Reflect.deleteProperty(globalThis, '__deliveryObservabilityInitialized');
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
  expect(operational.contexts?.operation).toMatchObject({ trackingNumber: 'TEST1234' });
  // Whatever else the report holds keeps its shape and the parcel's number.
  expect(operational.extra?.carrier_payload).toEqual({ number: 'TEST1234' });
  expect(operational.contexts?.carrier_response).toEqual({ number: 'TEST1234', status: 'waiting' });
  expect(operational.user?.id).toBe('diagnostic-user');
  expect(operational.breadcrumbs).toEqual(expect.arrayContaining([
    expect.objectContaining({ message: 'Looking up parcel TEST1234' }),
  ]));

  // Text keeps its numbers; addresses are still cut down.
  const direct = captured.events.find((event) => event.message === 'Direct SDK diagnostic message')!;
  expect(direct.request?.url).toBe('https://delivery.example.test/api/packages/:id');
  expect(direct.transaction).toBe('parcel-detail');
  expect(direct.exception?.values?.[0]).toMatchObject({ value: 'Parcel TEST1234 unavailable',
    stacktrace: { frames: [expect.objectContaining({
      vars: { trackingNumber: 'TEST1234' }, context_line: 'throw carrierError;',
    })] },
  });
  const client = Sentry.getClient()!;
  const options = client.getOptions();
  expect(options.dataCollection).toMatchObject({ userInfo: false, httpBodies: [], urlQueryParams: false });
  expect(['Console', 'Http', 'NodeFetch', 'RequestData', 'ExtraErrorData']
    .filter((name) => !client.getIntegrationByName(name))).toEqual([]);
  expect(client.getIntegrationByName('Dedupe')).toBeUndefined();

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
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  reportRoutingEvent('provider_failed', { carrier: 'dhl', provider: '17TRACK',
    category: 'rate_limited', trackingNumber: 'TEST-first', errorClass: 'UpstreamHttpError', error: new UpstreamHttpError('17TRACK', 429) });
  // The log line is the only per-attempt record now that failures no longer reach Sentry.
  expect(JSON.parse(String(warn.mock.calls.at(-1)?.[0]))).toMatchObject({ event: 'tracking_routing', decision: 'provider_failed',
    provider: '17TRACK', error_type: 'UpstreamHttpError', error_message: expect.stringContaining('429'), upstream_status: 429 });
  warn.mockRestore();
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  reportRoutingEvent('fresher_provider_found', { carrier: 'dhl', provider: 'ParcelsApp', trackingNumber: 'TEST-first' });
  // The router has already adopted the fresher provider: the log line is the record of it.
  expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ event: 'tracking_routing', decision: 'fresher_provider_found',
    carrier: 'dhl', provider: 'ParcelsApp' });
  log.mockRestore();
  reportRoutingEvent('carrier_auto_swapped', { carrier: 'dhl', provider: 'ups', trackingNumber: 'TEST-first' });
  const swapLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  reportRoutingEvent('carrier_auto_swapped', { carrier: 'unknown', provider: 'gls', category: 'detected', trackingNumber: 'TEST-detected' });
  // Detection already names the new carrier: the correction is a log line and a breadcrumb, not an issue.
  expect(JSON.parse(String(swapLog.mock.calls.at(-1)?.[0]))).toMatchObject({ event: 'tracking_routing', decision: 'carrier_auto_swapped',
    carrier: 'unknown', provider: 'gls', category: 'detected' });
  swapLog.mockRestore();
  reportRoutingEvent('provider_recovered', { carrier: 'dhl', provider: '17TRACK' });
  reportRoutingEvent('carrier_coverage_discovered', { carrier: 'dhl', provider: 'Example Parcel Co' });
  reportRoutingEvent('direct_support_opportunity', { carrier: 'fedex', provider: 'fedex' });
  await flushObservability();
  const rateLimit = captured.events.find((event) => event.message === 'Tracking routing: provider_failed')!;
  const swap = captured.events.find((event) => event.message === 'Tracking routing: carrier_auto_swapped')!;
  expect(swap.level).toBe('info');
  expect(swap.tags).toMatchObject({ carrier: 'dhl', provider: 'ups', tracking_number: 'TEST-first' });
  // With an exception attached, Sentry titles the issue after its top frame, not the message.
  expect(swap.exception).toBeUndefined();
  expect(rateLimit).toBeUndefined();
  expect(captured.events.some((event) => event.message === 'Tracking routing: provider_recovered')).toBe(false);
  expect(captured.events.some((event) => event.message === 'Tracking routing: fresher_provider_found')).toBe(false);
  expect(swap.breadcrumbs).toEqual(expect.arrayContaining([
    expect.objectContaining({ category: 'tracking-routing', message: 'fresher_provider_found', data: { provider: 'ParcelsApp' } }),
  ]));
  // Routing reports only names the catalog does not know, so each is worth an issue.
  const discovered = captured.events.find((event) => event.message === 'Tracking routing: carrier_coverage_discovered')!;
  expect(discovered).toMatchObject({ level: 'warning', tags: { provider: 'Example Parcel Co' } });
  expect(captured.events.filter((event) => event.message === 'Tracking routing: carrier_auto_swapped')).toHaveLength(1);
  expect(discovered.breadcrumbs).toEqual(expect.arrayContaining([
    expect.objectContaining({ category: 'tracking-routing', message: 'carrier_auto_swapped', data: { provider: 'gls' } }),
  ]));
  expect(captured.events.some((event) => event.message === 'Tracking routing: direct_support_opportunity')).toBe(true);

  const refusedBody = '<h1>Access Denied</h1><p>Reference #18.test.123; parcel 8U00000000000</p>';
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(refusedBody, {
    status: 403, headers: { 'content-type': 'text/html', 'x-request-id': 'example-request-id',
      'set-cookie': 'session=DO_NOT_CAPTURE', authorization: 'Bearer DO_NOT_CAPTURE', 'retry-after': '120' },
  }));
  // The tracker reports through the package's StepRecorder now, so the host's
  // sinks have to be wired in for its retries to reach Sentry.
  const refused = await createAdapterRegistry({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: hostStepRecorder() })
    .for('la-poste')!.track({ number: '8U00000000000' }).catch((error: unknown) => error);
  // One direct request and the three immediate 403 retries.
  expect(fetcher).toHaveBeenCalledTimes(4);
  fetcher.mockRestore();
  expect(refused).toBeInstanceOf(UpstreamHttpError);
  reportRoutingEvent('provider_failed', { carrier: 'la-poste', provider: 'la-poste',
    category: 'verification', error: refused, errorClass: 'UpstreamHttpError' });
  const wrappedId = captureOperationalError(new Error('Recovery failed', { cause: refused }), {
    component: 'tracking-sync', operation: 'fetch', carrier: 'la-poste',
  });
  reportRoutingEvent('provider_recovered', { carrier: 'la-poste', provider: 'la-poste' });
  reportRoutingEvent('direct_support_opportunity', { carrier: 'la-poste', provider: 'la-poste' });
  await flushObservability();
  const retries = captured.events.filter((event) => event.message === 'Tracking routing: transport_fallback' && event.tags?.provider === 'la-poste');
  expect(retries).toHaveLength(0);
  expect(captured.events.some(event => event.message === 'Tracking routing: provider_failed')).toBe(false);
  const wrapped = captured.events.find(event => event.event_id === wrappedId)!;
  expect(wrapped.contexts?.upstream_http).toMatchObject({ body_excerpt: refusedBody, body_read: 'complete' });
  const incidentId = captureTrackingHealth({ id: 'test-incident', kind: 'direct', subject: 'la-poste', state: 'open',
    attempts: 12, failures: 8, window_hours: 24, evidence: { http_status: 403, category: 'challenge' } });
  await flushObservability();
  const incident = captured.events.find(event => event.event_id === incidentId)!;
  expect(incident.message).toBe('Direct tracking repeatedly failing: la-poste (8/12 in 24h)');
  expect(incident.exception).toBeUndefined();
  expect(incident.tags).toMatchObject({ component: 'tracking-health', incident_state: 'open' });
  expect(incident.contexts?.tracking_health?.next_steps).toContain('maintenance');
  expect(incident.fingerprint).toEqual(['delivery-tracker', 'tracking-health', 'direct', 'la-poste']);
  // A recovery is its own issue: it neither reopens a resolved outage nor keeps it looking active.
  const recoveryId = captureTrackingHealth({ id: 'test-recovery', kind: 'direct', subject: 'la-poste', state: 'recovered',
    attempts: 3, failures: 0, window_hours: 24 });
  await flushObservability();
  const recovery = captured.events.find(event => event.event_id === recoveryId)!;
  expect(recovery).toMatchObject({ message: 'Direct tracking recovered: la-poste', level: 'info',
    fingerprint: ['delivery-tracker', 'tracking-health', 'direct', 'la-poste', 'recovered'] });
  // A later error-free routing event must not inherit the refusal's HTTP context,
  // and the recovery itself is only a breadcrumb on it rather than its own issue.
  const opportunity = captured.events.find((event) => event.message === 'Tracking routing: direct_support_opportunity' && event.tags?.provider === 'la-poste')!;
  expect(opportunity.contexts?.upstream_http).toBeUndefined();
  expect(opportunity.tags?.upstream_body_read).toBeUndefined();
  expect(opportunity.breadcrumbs?.some((crumb) => crumb.category === 'tracking-routing' && crumb.message === 'provider_recovered')).toBe(true);

  // An overall allowance without an account is one issue per allowance and state.
  const low = capturePublicAllowance('lookup', 'running_out', { used: 2_400, limit: 3_000 });
  const gone = capturePublicAllowance('detection', 'used_up', { used: 10_000, limit: 10_000 });
  await flushObservability();
  const runningOut = captured.events.find((event) => event.event_id === low)!;
  expect(runningOut.message).toBe("Lookups without an account: today's allowance is running out");
  expect(runningOut.level).toBe('warning');
  expect(runningOut.exception).toBeUndefined();
  expect(runningOut.fingerprint).toEqual(['delivery-tracker', 'public-allowance', 'lookup', 'running_out']);
  expect(runningOut.contexts?.public_allowance).toMatchObject({ used: 2_400, limit: 3_000 });
  expect(runningOut.contexts?.public_allowance?.next_steps).toContain('PUBLIC_LOOKUPS_GLOBAL_PER_DAY');
  expect(runningOut.contexts?.upstream_http).toBeUndefined();
  const usedUp = captured.events.find((event) => event.event_id === gone)!;
  expect(usedUp.message).toBe("Carrier detection without an account: today's allowance is used up");
  expect(usedUp.level).toBe('error');
  expect(usedUp.tags).toMatchObject({ component: 'public-allowance', allowance: 'detection', allowance_state: 'used_up' });
  expect(usedUp.contexts?.public_allowance?.next_steps).toContain('PUBLIC_DETECTIONS_GLOBAL_PER_DAY');
});

it('names a parcel by its tracking number and cuts addresses down in reports and breadcrumbs', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  expect(initObservability()).toBe(true);

  // Breadcrumbs gather across parcels: another parcel's log line, and a request about it.
  const line = JSON.stringify({ event: 'tracking_sync_started', tracking_number: 'TEST9012', error_message: 'No parcel test9012' });
  Sentry.addBreadcrumb({ category: 'console', level: 'log', message: line, data: { arguments: [line], logger: 'console' } });
  Sentry.addBreadcrumb({ category: 'http', type: 'http', data: { url: 'https://carrier.example/v1/track/TEST9012/events',
    'http.method': 'GET', 'http.query': 'number=TEST9012', status_code: 404 } });

  const request = { url: 'https://carrier.example/v1/track?number=TEST5678', method: 'POST', headers: {},
    body: '{"number":"TEST5678"}', timeout_ms: 10_000 };
  const refused = new UpstreamHttpError('Example Carrier', 404, undefined, {
    content_type: 'text/html', headers: { location: 'https://carrier.example/v1/parcels/TEST5678' },
    response_url: request.url, status_text: 'Not Found', request_ids: {}, body_read: 'complete',
    bytes_inspected: 40, body_signals: [], body_excerpt: '<p>No parcel test5678</p>',
  }, request);
  const id = captureOperationalError(new Error('Lookup of TEST5678 failed', { cause: refused }), {
    component: 'tracking-sync', operation: 'fetch', carrier: 'example', trackingNumber: 'TEST5678',
  });
  await flushObservability();
  const report = captured.events.find((event) => event.event_id === id)!;
  expect(report.tags).toMatchObject({ tracking_number: 'TEST5678' });
  expect(report.tags).not.toHaveProperty('tracking_hash');
  expect(report.contexts?.operation).toMatchObject({ component: 'tracking-sync', carrier: 'example', trackingNumber: 'TEST5678' });
  expect(report.exception?.values?.map((value) => value.value)).toContain('Lookup of TEST5678 failed');
  // Addresses lose their query and number-like path segments; other text keeps the number.
  expect(report.contexts?.upstream_http).toMatchObject({ response_url: 'https://carrier.example/v1/track',
    body_excerpt: '<p>No parcel test5678</p>', headers: { location: 'https://carrier.example/v1/parcels/:id' } });

  const logLine = report.breadcrumbs?.find((crumb) => crumb.category === 'console' && crumb.message?.includes('tracking_sync_started'));
  expect(JSON.parse(logLine!.message!)).toMatchObject({ tracking_number: 'TEST9012', error_message: 'No parcel test9012' });
  expect(logLine!.data).toEqual({ logger: 'console' });
  const call = report.breadcrumbs?.find((crumb) => crumb.category === 'http' && crumb.data?.status_code === 404);
  expect(call!.data).toEqual({ url: 'https://carrier.example/v1/track/:id/events', 'http.method': 'GET', status_code: 404 });
});
