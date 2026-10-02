import { afterEach, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import type { Event } from '@sentry/node';
import { captureOperationalError, flushObservability, initObservability } from './observability';

const captured = vi.hoisted(() => ({ events: [] as Event[] }));

// The real SDK event pipeline with a transport that keeps events in the test process.
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
  vi.unstubAllEnvs();
});

it('leaves the request out of a report for a route whose address or body carries a capability', async () => {
  vi.stubEnv('SENTRY_DSN', 'https://public@example.test/1');
  expect(initObservability()).toBe(true);
  const capture = (withoutRequest: boolean) => {
    let id: string | null = null;
    Sentry.withIsolationScope((isolation) => {
      // What the SDK's HTTP integration records for an incoming request.
      isolation.setSDKProcessingMetadata({ normalizedRequest: {
        url: 'https://delivery.example.test/api/public/parcels/k7Qm2xHd9RtW', method: 'GET',
        headers: { 'x-parcel-key': 'OWNER-KEY', 'user-agent': 'test' },
        data: '{"links":[{"id":"k7Qm2xHd9RtW","key":"OWNER-KEY"}]}',
      } });
      isolation.setTransactionName('GET /api/public/parcels/k7Qm2xHd9RtW');
      id = captureOperationalError(new Error('database down'), {
        component: 'api', operation: 'request', route: '/api/public/parcels/:link', withoutRequest,
      });
    });
    return id;
  };
  const kept = capture(false);
  const stripped = capture(true);
  expect(await flushObservability()).toBe(true);

  // Other routes keep the SDK's request data; it filters the key header by its name, not the body.
  const usual = captured.events.find((event) => event.event_id === kept)!;
  expect(usual.request?.url).toContain('k7Qm2xHd9RtW');
  expect(usual.request?.headers?.['x-parcel-key']).toBe('[Filtered]');
  expect(JSON.stringify(usual.request)).toContain('OWNER-KEY');

  const report = captured.events.find((event) => event.event_id === stripped)!;
  expect(report.request).toBeUndefined();
  expect(report.transaction).toBeUndefined();
  expect(report.tags?.route).toBe('/api/public/parcels/:link');
  // The stack frames quote this file; nothing else of the report names the link or the key.
  const rest = JSON.stringify({ ...report, exception: undefined });
  expect(rest).not.toContain('k7Qm2xHd9RtW');
  expect(rest).not.toContain('OWNER-KEY');
});
