// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TrawlClient } from '../../core/transport';
import { parse17TrackResponse, SeventeenTrackTracker } from './adapter';

const number = 'ZZ12345678900';
const API = 'https://t.17track.net/track/restapi';
interface Payload { meta: { code: number }; shipments: Record<string, unknown>[] }
const delivered = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8')) as Payload;
const history = (value = number): Payload => ({ ...delivered, shipments: [{ ...delivered.shipments[0], number: value }] });
const thrown = (run: () => unknown): unknown => {
  try { run(); } catch (error) { return error; }
  return null;
};

const captured = (data: unknown, overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
  url: `https://t.17track.net/en#nums=${number}`, html: '<html></html>', statusCode: 200, tier: 3,
  capturedResponses: [{ url: API, body: JSON.stringify(data), status: 200, truncated: false, base64Encoded: false }],
  ...overrides,
}));

function tracker(fetcher: typeof fetch, trawlUrl = 'http://browser.test') {
  return new SeventeenTrackTracker({ trawl: new TrawlClient(trawlUrl, fetcher) });
}

describe('17TRACK result parsing', () => {
  it('uses matching history, keeps the reported carrier and strips recipient data', () => {
    const result = parse17TrackResponse(delivered, number);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', tracking_provider: '17TRACK',
      last_update: '2026-08-31T18:50:50.000Z' });
    expect(result.events?.[0]).toMatchObject({ stage: 'delivered', description: 'Delivered' });
    expect(result.events?.[1]).toMatchObject({ stage: 'out_for_delivery', time: '2026-08-31T17:12:44.000Z' });
    expect(result).toMatchObject({ reported_carriers: ['Swiss Post'], discovered_carrier: 'swiss-post' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('rejects demos, ambiguity, unfinished polling and verification errors', () => {
    const ambiguous: Payload = { ...delivered, shipments: [delivered.shipments[0], delivered.shipments[0]] };
    for (const payload of [history('TestNumber00017'), ambiguous, { meta: { code: 400 }, shipments: [] }]) {
      expect(() => parse17TrackResponse(payload, number)).toThrow();
    }
    expect(thrown(() => parse17TrackResponse({ meta: { code: -14 }, shipments: [] }, number)))
      .toMatchObject({ name: 'SeventeenTrackVerificationError', reason: 'verification_required', providerCode: -14, status: 403 });
    expect(thrown(() => parse17TrackResponse({ meta: { code: 200 }, shipments: [{ number, code: 100 }] }, number)))
      .toMatchObject({ name: 'SeventeenTrackLookupError', reason: 'lookup_pending', providerCode: 100 });
  });
});

describe('17TRACK browser capture', () => {
  it('asks the browser service for the page and reads its captured API response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(captured(delivered));
    await expect(tracker(fetcher, 'http://browser.test/v1').fetch(number)).resolves.toMatchObject({ tracking_provider: '17TRACK' });
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://browser.test/scrape');
    expect(JSON.parse(String(options!.body))).toMatchObject({
      url: `https://t.17track.net/en#nums=${number}`, skipHttp: true, maxTier: 3,
      captureResponses: [API], settleTimeout: 15_000,
    });
    expect(Number.isInteger(JSON.parse(String(options!.body)).maxTimeout)).toBe(true);
  });

  it('needs the browser service and never requests an arbitrary user URL', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new SeventeenTrackTracker().fetch(number)).rejects.toThrow('tracking browser service');
    await expect(tracker(fetcher).fetch('http://localhost')).rejects.toThrow('Invalid tracking number');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects redirected, unsolved, truncated and binary pages', async () => {
    for (const overrides of [{ url: 'https://evil.test/' }, { statusCode: 403 }, { tier: 1 }, { error: 'browser failed' },
      { capturedResponses: [{ url: API, body: JSON.stringify(delivered), status: 200, truncated: true }] },
      { capturedResponses: [{ url: API, body: JSON.stringify(delivered), status: 200, base64Encoded: true }] }]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(captured(delivered, overrides));
      await expect(tracker(fetcher).fetch(number)).rejects.toThrow();
    }
  });

  it('distinguishes missing capture capability, unreadable bodies and provider lookup failures', async () => {
    for (const [data, overrides, expected] of [
      [null, { capturedResponses: undefined }, { name: 'TrackingCaptureError', reason: 'capture_missing' }],
      [null, { capturedResponses: [{ url: API, status: 200, body: null, error: 'compressed gzip body was not read safely' }] },
        { name: 'TrackingCaptureError', reason: 'capture_unreadable' }],
      [null, { capturedResponses: [{ url: 'https://t.17track.net/other', status: 200, body: '{}' }] },
        { name: 'TrackingCaptureError', reason: 'history_missing' }],
      [{ meta: { code: 200 }, shipments: [{ number, code: 400, shipment: null }] }, {},
        { name: 'SeventeenTrackLookupError', reason: 'lookup_unavailable', providerCode: 400 }],
      [{ meta: { code: -14 }, shipments: [] }, {}, { name: 'SeventeenTrackVerificationError', providerCode: -14 }],
    ] as const) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(captured(data, overrides));
      await expect(tracker(fetcher).fetch(number)).rejects.toMatchObject(expected);
    }
  });

  it('accepts completed matching history after intermediate polling and keeps the API Retry-After', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(captured(null, { capturedResponses: [
      { url: API, status: 200, body: JSON.stringify({ meta: { code: 200 }, shipments: [{ number, code: 100 }] }) },
      { url: API, status: 200, body: JSON.stringify(delivered) },
    ] }));
    await expect(tracker(fetcher).fetch(number)).resolves.toMatchObject({ tracking_provider: '17TRACK' });
    fetcher.mockResolvedValue(captured(null, { capturedResponses: [
      { url: API, status: 429, body: null, headers: { 'retry-after': '300' } },
    ] }));
    await expect(tracker(fetcher).fetch(number)).rejects.toMatchObject({ name: 'UpstreamHttpError', status: 429, retryAfterMs: 300_000 });
    fetcher.mockResolvedValue(captured(null, { capturedResponses: [{ url: API, status: 503, body: null }] }));
    await expect(tracker(fetcher).fetch(number)).rejects.toMatchObject({ name: 'UpstreamHttpError', status: 503 });
  });
});
