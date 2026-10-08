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
        url: 'https://delivery.example.test/api/public/parcels/k7Qm2xHd9RtW?lang=fr', method: 'GET',
        headers: { 'x-parcel-key': 'OWNER-KEY', 'user-agent': 'test', 'x-forwarded-for': '203.0.113.7' },
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

  // Other routes keep the request without its body, its query or the client's address.
  // The SDK filters the key header by its name; a number-like segment of the address
  // reads `:id`, here and in the transaction.
  const usual = captured.events.find((event) => event.event_id === kept)!;
  expect(usual.request?.url).toBe('https://delivery.example.test/api/public/parcels/:id');
  expect(usual.transaction).toBe('GET /api/public/parcels/:id');
  expect(usual.request?.headers).toEqual({ 'x-parcel-key': '[Filtered]', 'user-agent': 'test' });
  expect(usual.request?.data).toBeUndefined();
  expect(usual.user?.ip_address).toBeUndefined();
  // The stack frames quote this file.
  expect(JSON.stringify({ ...usual, exception: undefined })).not.toMatch(/OWNER-KEY|203\.0\.113\.7|k7Qm2xHd9RtW/);

  const report = captured.events.find((event) => event.event_id === stripped)!;
  expect(report.request).toBeUndefined();
  expect(report.transaction).toBeUndefined();
  expect(report.tags?.route).toBe('/api/public/parcels/:link');
  // The stack frames quote this file; nothing else of the report names the link or the key.
  const rest = JSON.stringify({ ...report, exception: undefined });
  expect(rest).not.toContain('k7Qm2xHd9RtW');
  expect(rest).not.toContain('OWNER-KEY');
});
