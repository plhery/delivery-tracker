import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepRecorder } from '../../core/telemetry';
import {
  FedExTracker,
  fedexTrackingUrl,
  parseFedExTrackingHtml,
  parseFedExTrackingResponse,
} from './adapter';
import { FEDEX_CODE_STAGE, fedexStage, fedexStatus } from './status';

// 999999999999 and 999999999998 are made-up numbers in FedEx's published
// format. No real shipment, recipient, signatory or session value appears in
// this file; the fixtures carry PRIVATE … placeholders instead.
const DELIVERED_NUMBER = '999999999999';
const IN_TRANSIT_NUMBER = '999999999998';
const TRACK_API = 'https://api.fedex.com/track/v2/shipments';
const TRAWL_URL = 'http://trawl.internal:8191';
const DELIVERED = JSON.parse(
  readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const IN_TRANSIT = JSON.parse(
  readFileSync(new URL('./fixtures/in-transit.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

function deliveredFixture(): Record<string, unknown> {
  return structuredClone(DELIVERED);
}

function inTransitFixture(): Record<string, unknown> {
  return structuredClone(IN_TRANSIT);
}

function stepRecorder(): { recorder: StepRecorder; records: string[] } {
  const records: string[] = [];
  return {
    records,
    recorder: {
      step: (record) => records.push(`${record.step}:${record.outcome}`),
      lookup: (record) => records.push(`lookup:${record.finalStep}:${record.outcome}`),
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('FedEx status vocabulary', () => {
  it('maps the package code, the wording, and nothing else', () => {
    expect(FEDEX_CODE_STAGE.DL).toBe('delivered');
    expect(FEDEX_CODE_STAGE.OD).toBe('out_for_delivery');
    expect(FEDEX_CODE_STAGE.DE).toBe('failed_attempt');
    expect(FEDEX_CODE_STAGE.OC).toBe('registered');
    expect(fedexStage('Customer not available or business closed')).toBe('failed_attempt');
    expect(fedexStage('Returning to shipper')).toBe('returned');
    expect(fedexStage('Clearance in progress')).toBe('customs');
    expect(fedexStatus('DL', 'On FedEx vehicle for delivery')).toBe('delivered');
    expect(fedexStatus('OD', 'Delivered')).toBe('out_for_delivery');
    // Unrecognized wording only means "moving" once the shipment has scans.
    expect(fedexStatus('XX', 'Wording FedEx has not used before')).toBe('unknown');
    expect(fedexStatus('XX', 'Wording FedEx has not used before', true)).toBe('in_transit');
    expect(fedexStage('Wording FedEx has not used before')).toBeNull();
  });
});

describe('FedEx structured response', () => {
  it('projects the delivered scan history with per-scan offsets', () => {
    const result = parseFedExTrackingResponse(deliveredFixture(), DELIVERED_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-09-02T11:58:00+02:00',
      delivered_at: '2026-09-02T11:58:00+02:00',
      expected_delivery: null,
    });
    expect(result.events).toEqual([
      { time: '2026-09-02T11:58:00+02:00', location: 'ZUERICH, CH', description: 'Delivered', stage: 'delivered' },
      { time: '2026-09-01T08:12:00+02:00', location: 'KOELN, DE', description: 'Departed FedEx location', stage: 'in_transit' },
      { time: '2026-08-31T15:00:00+09:00', location: 'SEOUL, KR', description: 'Picked up', stage: 'accepted' },
      { time: '2026-08-30T09:05:00+09:00', location: 'SEOUL, KR', description: 'Shipment information sent to FedEx', stage: 'registered' },
    ]);
  });

  it('projects an out-for-delivery parcel with its estimate', () => {
    const result = parseFedExTrackingResponse(inTransitFixture(), IN_TRANSIT_NUMBER);
    expect(result).toMatchObject({
      status: 'out_for_delivery',
      current_stage: 'out_for_delivery',
      last_status_text: 'On FedEx vehicle for delivery',
      last_update: '2026-09-25T09:04:00+02:00',
      expected_delivery: '2026-09-25',
    });
    expect(result.events).toHaveLength(4);
    expect(result.events?.[0]).toMatchObject({ stage: 'out_for_delivery' });
    expect(result).not.toHaveProperty('delivered_at');
  });

  it('keeps the recipient, shipper and service blocks out of the result', () => {
    const serialized = JSON.stringify(parseFedExTrackingResponse(deliveredFixture(), DELIVERED_NUMBER));
    for (const value of [
      'PRIVATE RECIPIENT', 'PRIVATE SHIPPER', 'PRIVATE PHONE',
      'receivedByNm', 'shipperCmpnyName', 'recipientPhoneNbr',
      'serviceDesc', 'INTERNATIONAL_PRIORITY', 'totalKgsWgt', 'dimensions',
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it('produces every capability carrier.json declares', () => {
    const result = parseFedExTrackingResponse(deliveredFixture(), DELIVERED_NUMBER);
    expect(CAPABILITIES).toEqual(['history', 'location', 'eta', 'delivered_at']);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(result.delivered_at).toBeTruthy();
    expect(parseFedExTrackingResponse(inTransitFixture(), IN_TRANSIT_NUMBER).expected_delivery).toBeTruthy();
  });

  it('fails closed on another parcel, duplicates and invalid envelopes', () => {
    const other = deliveredFixture();
    ((((other.output as Record<string, unknown>).packages as Record<string, unknown>[])[0]!)).trackingNbr = '999999999997';
    expect(() => parseFedExTrackingResponse(other, DELIVERED_NUMBER))
      .toThrow('FedEx did not return the requested parcel');
    const duplicated = deliveredFixture();
    ((duplicated.output as Record<string, unknown>).packages as unknown[]).push(
      ((deliveredFixture().output as Record<string, unknown>).packages as unknown[])[0],
    );
    expect(() => parseFedExTrackingResponse(duplicated, DELIVERED_NUMBER))
      .toThrow('several shipments');
    expect(() => parseFedExTrackingResponse({ output: {} }, DELIVERED_NUMBER))
      .toThrow('invalid tracking response');
    expect(() => parseFedExTrackingResponse('not an object', DELIVERED_NUMBER))
      .toThrow('invalid tracking response');
  });

  it('reports an empty answer as unlocated and a gated shipment as input-required', () => {
    expect(parseFedExTrackingResponse({ output: { packages: [] } }, DELIVERED_NUMBER)).toMatchObject({
      status: 'unknown',
      events: [],
      last_status_text: 'FedEx could not locate the shipment',
    });
    expect(() => parseFedExTrackingResponse({
      output: { packages: [], errorList: [{ code: 'TRACKING.AUTHORIZATION.ERROR', message: 'Verification required' }] },
    }, DELIVERED_NUMBER)).toThrow('recipient verification');
    expect(parseFedExTrackingResponse({
      output: {
        packages: [{
          trackingNbr: DELIVERED_NUMBER,
          errorList: [{ code: 'TRACKING.TRACKINGNUMBER.NOTFOUND', message: 'Not found' }],
        }],
      },
    }, DELIVERED_NUMBER)).toMatchObject({ status: 'unknown', events: [] });
  });
});

describe('FedEx lookup steps', () => {
  it('reports the missing browser service without any request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('must not fetch'));
    const { recorder, records } = stepRecorder();

    await expect(new FedExTracker({ trawlUrl: '', recorder }).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({
        name: 'ChallengeError',
        status: 403,
        message: 'FedEx challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
      });

    expect(fetcher).not.toHaveBeenCalled();
    expect(records).toEqual([]);
  });

  it('reads the tracking reply the browser captured', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      tier: 3,
      statusCode: 200,
      url: fedexTrackingUrl(DELIVERED_NUMBER),
      html: '<html><body>tracking app</body></html>',
      cookies: [],
      userAgent: 'Mozilla/5.0 (test browser)',
      capturedResponses: [
        { url: TRACK_API, status: 200, headers: {}, body: null, truncated: false, base64Encoded: false, error: 'unreadable' },
        { url: TRACK_API, status: 200, headers: {}, body: JSON.stringify(deliveredFixture()), truncated: false, base64Encoded: false, error: null },
      ],
    }));
    const { recorder, records } = stepRecorder();

    const result = await new FedExTracker({ timeoutMs: 2_000, trawlUrl: TRAWL_URL, recorder }).fetch(DELIVERED_NUMBER);

    expect(result).toMatchObject({
      status: 'delivered',
      tracking_source: 'structured-web-response',
      tracking_url: fedexTrackingUrl(DELIVERED_NUMBER),
    });
    expect(result.events?.length ?? 0).toBeGreaterThan(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${TRAWL_URL}/scrape`);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      url: fedexTrackingUrl(DELIVERED_NUMBER),
      skipHttp: true,
      maxTier: 3,
      captureResponses: [TRACK_API],
    });
    expect(records).toEqual(['trawl:ok', 'lookup:trawl:ok']);
  });

  it('names a challenged browser page instead of reporting an inconclusive load as not-found', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tier: 3,
        statusCode: 200,
        url: fedexTrackingUrl(DELIVERED_NUMBER),
        html: '<html><body><h1>Access Denied</h1></body></html>',
        cookies: [],
        userAgent: 'Mozilla/5.0 (test browser)',
        capturedResponses: [],
      }), { headers: { 'Content-Type': 'application/json' } }));

    await expect(new FedExTracker({ timeoutMs: 2_000, trawlUrl: TRAWL_URL }).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({ name: 'ChallengeError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves unreadable tracking JSON as a schema failure, never as not-found', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tier: 3,
        statusCode: 200,
        url: fedexTrackingUrl(DELIVERED_NUMBER),
        html: '<html><body>We can’t find that tracking number.</body></html>',
        cookies: [],
        userAgent: 'Mozilla/5.0 (test browser)',
        capturedResponses: [
          { url: TRACK_API, status: 200, headers: {}, body: 'not json', truncated: false, base64Encoded: false, error: null },
        ],
      }), { headers: { 'Content-Type': 'application/json' } }));
    const { recorder, records } = stepRecorder();
    // The page renders this notice both for unknown numbers and for tracking
    // calls the edge refused, so only the structured reply decides not-found.
    await expect(new FedExTracker({ timeoutMs: 2_000, trawlUrl: TRAWL_URL, recorder }).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({ name: 'SchemaError', message: 'FedEx returned unreadable tracking JSON' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(records).toEqual(['trawl:schema', 'lookup:trawl:schema']);
  });

  it('keeps a page without a tracking reply inconclusive', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      tier: 2, statusCode: 200, html: '<body>We cannot find that tracking number.</body>',
      capturedResponses: [],
    }));
    await expect(new FedExTracker({ trawlUrl: TRAWL_URL }).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({ name: 'TransportError', kind: 'transport' });
  });

  it.each([401, 403])('preserves an API HTTP %s rejection even when the page looks normal', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      tier: 2, statusCode: 200, html: '<body>Tracking app</body>',
      capturedResponses: [
        { url: TRACK_API, status: 200, body: JSON.stringify(deliveredFixture()) },
        { url: TRACK_API, status, body: null },
      ],
    }));
    const { recorder, records } = stepRecorder();
    await expect(new FedExTracker({ trawlUrl: TRAWL_URL, recorder }).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({ name: 'ChallengeError', kind: 'challenge', status });
    expect(records).toEqual(['trawl:challenge', 'lookup:trawl:challenge']);
  });

  it('accepts a successful reply after an earlier browser rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      tier: 3, statusCode: 200, html: '<body>Tracking app</body>',
      capturedResponses: [
        { url: TRACK_API, status: 403, body: null },
        { url: TRACK_API, status: 200, body: JSON.stringify(deliveredFixture()) },
      ],
    }));
    await expect(new FedExTracker({ trawlUrl: TRAWL_URL }).fetch(DELIVERED_NUMBER))
      .resolves.toMatchObject({ status: 'delivered' });
  });

  it.each([
    [429, { 'retry-after': '120' }, { name: 'RateLimitedError', retryAfterMs: 120_000 }],
    [503, {}, { name: 'UpstreamHttpError', kind: 'maintenance' }],
    [404, {}, { name: 'TransportError', kind: 'transport' }],
  ])('keeps HTTP %s distinct from an unknown shipment', async (status, headers, expected) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      tier: 2, statusCode: 200, html: '<body>Tracking app</body>',
      capturedResponses: [{ url: TRACK_API, status, headers, body: null }],
    }));
    await expect(new FedExTracker({ trawlUrl: TRAWL_URL }).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({ ...expected, status });
  });

  it('preserves recipient-verification and identity errors from a captured reply', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const [body, expected] of [
      [{ output: { packages: [], errorList: [{ code: 'TRACKING.AUTHORIZATION.ERROR' }] } },
        { name: 'InputRequiredError', field: 'recipient verification' }],
      [{ output: { packages: [{ trackingNbr: IN_TRANSIT_NUMBER, keyStatus: 'Delivered' }] } },
        { name: 'SchemaError', message: 'FedEx did not return the requested parcel' }],
    ]) {
      fetcher.mockResolvedValueOnce(Response.json({
        tier: 2, statusCode: 200, html: '<body>Tracking app</body>',
        capturedResponses: [{ url: TRACK_API, status: 200, body: JSON.stringify(body) }],
      }));
      await expect(new FedExTracker({ trawlUrl: TRAWL_URL }).fetch(DELIVERED_NUMBER))
        .rejects.toMatchObject(expected);
    }
  });

  it('rejects a number that is not a FedEx number before any request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('must not fetch'));
    await expect(new FedExTracker({ trawlUrl: TRAWL_URL }).fetch('1Z999AA10123456784'))
      .rejects.toThrow('FedEx tracking numbers must contain 12 or 15 digits');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('FedEx rendered page', () => {
  it('tells a challenge from an inconclusive load', () => {
    expect(parseFedExTrackingHtml('<html><body><h1>Access Denied</h1></body></html>')).toBe('challenged');
    expect(parseFedExTrackingHtml('<html><body>We can’t find that tracking number.</body></html>')).toBe('inconclusive');
  });

  it('builds the canonical tracking URL', () => {
    const url = new URL(fedexTrackingUrl(DELIVERED_NUMBER));
    expect(url.searchParams.get('trknbr')).toBe(DELIVERED_NUMBER);
  });
});
