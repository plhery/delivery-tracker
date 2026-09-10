// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';
import * as observability from './observability';
import { measureScrape, recoverScrape } from './scrapeMonitoring';
import { UpstreamHttpError } from './boundedFetch';

const captured = vi.hoisted(() => ({ events: [] as Event[], metrics: [] as Record<string, unknown>[] }));
// Exercise the actual SDK serialization; synthetic telemetry never leaves this process.
vi.mock('@sentry/node', async importOriginal => {
  const sdk = await importOriginal<typeof import('@sentry/node')>();
  return { ...sdk, init: (options: Parameters<typeof sdk.init>[0]) => sdk.init({
    ...options, registerEsmLoaderHooks: false,
    transport: () => ({
      send: async envelope => {
        for (const [header, payload] of envelope[1]) {
          if (header.type === 'event') captured.events.push(payload as Event);
          if (header.type === 'trace_metric') captured.metrics.push(...(payload as { items: Record<string, unknown>[] }).items);
        }
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  }) };
});
afterEach(async () => {
  await Sentry.close();
  Sentry.getCurrentScope().clear();
  Sentry.getIsolationScope().clear();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("records failures and recovery separately, even with tracing disabled, with the caller's diagnostic context", async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  vi.stubEnv('SENTRY_TRACES_SAMPLE_RATE', '0');
  expect(observability.initObservability()).toBe(true);
  let now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  Sentry.getIsolationScope().setUser({ id: 'diagnostic-fixture', email: 'diagnostic-fixture@example.test' });
  Sentry.getIsolationScope().setAttributes({ parcel_id: 'diagnostic-fixture' });
  Sentry.getCurrentScope().setAttributes({ tracking_number: 'diagnostic-fixture' });
  const failure = new UpstreamHttpError('Ship24', 403);
  const value = { status: 'delivered' };
  await expect(measureScrape('Ship24', 'total', async () => {
    try {
      return await measureScrape('Ship24', 'direct', async () => { now += 8000; throw failure; });
    } catch (error) {
      expect(error).toBe(failure);
      return recoverScrape('Ship24', 'browser', error, async () => {
        await observability.flushObservability();
        expect(captured.events).toHaveLength(1); // Reported BEFORE the recovery starts.
        now += 12000;
        return value;
      });
    }
  })).resolves.toBe(value);
  await observability.flushObservability();
  expect(Sentry.getClient()!.getOptions().tracesSampleRate).toBe(0);
  const durations = captured.metrics.filter(metric => metric.name === 'tracking.scrape.duration');
  expect(durations.map(metric => metric.value)).toEqual([8000, 12000, 20000]);
  expect(durations[0]).toMatchObject({ unit: 'millisecond', attributes: {
    carrier: { value: 'Ship24' }, phase: { value: 'direct' }, outcome: { value: 'error' }, error_type: { value: 'UpstreamHttpError' },
  } });
  expect(durations[1]).toMatchObject({ attributes: { phase: { value: 'browser' }, outcome: { value: 'success' } } });
  expect(captured.metrics.filter(metric => metric.name === 'tracking.scrape.attempts')).toHaveLength(3);
  expect(captured.metrics.filter(metric => metric.name === 'tracking.scrape.fallbacks')).toHaveLength(1);
  expect(durations[0]).toMatchObject({ attributes: { 'user.id': { value: 'diagnostic-fixture' }, parcel_id: { value: 'diagnostic-fixture' }, tracking_number: { value: 'diagnostic-fixture' } } });
  expect(captured.events[0]).toMatchObject({ message: 'Tracking routing: transport_fallback', level: 'warning',
    tags: { carrier: 'Ship24', provider: 'Ship24', upstream_status: 403, failure_category: 'browser' },
    fingerprint: ['delivery-tracker', 'tracking-routing', 'transport_fallback', 'Ship24', 'browser'],
  });
  // Monitoring preserves the caller's diagnostic context.
  expect(Sentry.getIsolationScope().getUser()?.id).toBe('diagnostic-fixture');
  await expect(recoverScrape('la-poste', 'retry', new UpstreamHttpError('La Poste tracking', 403), async () => {
    await observability.flushObservability();
    expect(captured.events).toHaveLength(2);
    expect(captured.events[1]).toMatchObject({ message: 'Tracking routing: transport_fallback',
      tags: { carrier: 'la-poste', upstream_status: 403, failure_category: 'retry' },
    });
    return value;
  })).resolves.toBe(value);
  await observability.flushObservability();
  expect(captured.metrics.filter(metric => metric.name === 'tracking.scrape.duration').at(-1)).toMatchObject({
    attributes: { carrier: { value: 'la-poste' }, phase: { value: 'retry' }, outcome: { value: 'success' } },
  });

});

it('preserves successful results and original failures when every telemetry sink throws', async () => {
  vi.spyOn(observability, 'initObservability').mockImplementation(() => { throw new Error('telemetry unavailable'); });
  vi.spyOn(observability, 'logOperationalEvent').mockImplementation(() => { throw new Error('logger unavailable'); });
  vi.spyOn(observability, 'reportRoutingEvent').mockImplementation(() => { throw new Error('reporter unavailable'); });
  const failure = new Error('original');
  await expect(measureScrape('ups', 'direct', async () => { throw failure; })).rejects.toBe(failure);
  await expect(recoverScrape('ups', 'trawl', failure, async () => 'history')).resolves.toBe('history');
  await expect(recoverScrape('ups', 'trawl', failure, async () => { throw failure; })).rejects.toBe(failure);
});
