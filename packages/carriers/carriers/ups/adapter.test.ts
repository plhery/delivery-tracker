import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepRecorder } from '../../core/telemetry';
import { UPSTracker, parseUPSTrackingHtml, parseUPSTrackingResponse, upsTrackingUrl } from './adapter';
import { UPS_PROGRESS_STATUS, upsStatus } from './status';

// 1Z999AA10123456784 is a made-up number in UPS's published format; it is the
// same value numbers.json records as synthetic. No real shipment, recipient or
// session cookie appears in this file.
const TRACKING_NUMBER = '1Z999AA10123456784';
const STATUS_API = 'https://webapis.ups.com/track/api/Track/GetStatus?loc=en_US';
const TRAWL_URL = 'http://trawl.internal:8191';
const OUT_FOR_DELIVERY = JSON.parse(
  readFileSync(new URL('./fixtures/out-for-delivery.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;
// The day the fixture's scans happen on, so the year-less scheduled delivery
// date resolves without rolling into the next year.
const TODAY = new Date('2026-08-04T06:00:00Z');
const RENDERED_PAGE = `
  <html><head><meta name="stapp-tracknum" content="${TRACKING_NUMBER}"></head>
  <body>
    <span id="stApp_nameKey">Delivered <span>check_circle</span></span>
    <p id="stApp_deliveredToAddress">ZUERICH CH</p>
  </body></html>
`;

function fixture(): Record<string, unknown> {
  return structuredClone(OUT_FOR_DELIVERY);
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

describe('UPS status vocabulary', () => {
  it('maps the progress token, the prose, and nothing else', () => {
    expect(UPS_PROGRESS_STATUS.outfordelivery).toBe('out_for_delivery');
    expect(UPS_PROGRESS_STATUS.manifestupload).toBe('pending');
    expect(upsStatus('Returned to Sender')).toBe('exception');
    expect(upsStatus('Your package was left at the front door')).toBe('delivered');
    expect(upsStatus('Label Created')).toBe('pending');
    // Unrecognized wording only means "moving" once the shipment has scans.
    expect(upsStatus('Wording UPS has not used before')).toBe('unknown');
    expect(upsStatus('Wording UPS has not used before', true)).toBe('in_transit');
  });
});

describe('UPS structured response', () => {
  it('projects the scan history and prefers the UTC pair for each scan', () => {
    const result = parseUPSTrackingResponse(fixture(), TRACKING_NUMBER, TODAY);
    expect(result).toMatchObject({
      status: 'out_for_delivery',
      last_status_text: 'Out For Delivery Today',
      last_update: '2026-08-04T07:12:04+00:00',
      expected_delivery: '2026-08-04',
    });
    expect(result.events).toEqual([
      { time: '2026-08-04T07:12:04+00:00', location: 'ZUERICH, CH', description: 'Out For Delivery Today' },
      { time: '2026-08-04T03:03:51+00:00', location: 'ZUERICH, CH', description: 'Arrived at Facility' },
      {
        time: '2026-08-03T21:41:10+00:00',
        location: 'KOELN, DE',
        description: 'Departed from Facility — Your package is on the way',
      },
    ]);
  });

  it('keeps the recipient block out of the result', () => {
    const serialized = JSON.stringify(parseUPSTrackingResponse(fixture(), TRACKING_NUMBER, TODAY));
    for (const value of [
      'PRIVATE RECIPIENT', '10 PRIVATE STREET', 'PRIVATE CITY', 'PRIVATE POSTCODE',
      'PRIVATE-SIGNATURE-LINK', 'PRIVATE-PHOTO-LINK', 'receivedBy', 'signatureLink',
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it('produces every capability carrier.json declares', () => {
    const result = parseUPSTrackingResponse(fixture(), TRACKING_NUMBER, TODAY);
    expect(CAPABILITIES).toEqual(['history', 'location', 'eta']);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(result.expected_delivery).toBeTruthy();
  });

  it('fails closed on another parcel and reports an unavailable API as inconclusive', () => {
    const other = fixture();
    (other.trackDetails as Record<string, unknown>[])[0]!.trackingNumber = '1Z999AA10123456793';
    expect(() => parseUPSTrackingResponse(other, TRACKING_NUMBER, TODAY))
      .toThrow('UPS did not return the requested parcel');
    expect(() => parseUPSTrackingResponse({ statusCode: '500', statusText: 'Unavailable' }, TRACKING_NUMBER))
      .toThrow('Unavailable');
    expect(() => parseUPSTrackingResponse('not an object', TRACKING_NUMBER))
      .toThrow('UPS returned an invalid tracking response');
  });
});

describe('UPS lookup steps', () => {
  it('reports the missing browser service when the direct session is challenged', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('<html>challenge</html>', { status: 403 }));
    const { recorder, records } = stepRecorder();

    await expect(new UPSTracker({
      timeoutMs: 2_000,
      directTimeoutMs: 1_000,
      trawlUrl: '',
      recorder,
    }).fetch(TRACKING_NUMBER)).rejects.toMatchObject({
      name: 'ChallengeError',
      status: 403,
      message: 'UPS challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('ups.com/track');
    expect(records).toEqual(['direct:challenge', 'lookup:direct:challenge']);
  });

  it('reads the status reply the browser captured instead of replaying its cookies', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
      tier: 2,
      statusCode: 200,
      url: upsTrackingUrl(TRACKING_NUMBER),
      html: RENDERED_PAGE,
      cookies: [{ name: 'X-XSRF-TOKEN-ST', value: 'token', domain: '.ups.com', path: '/' }],
      userAgent: 'Mozilla/5.0 (test browser)',
      capturedResponses: [
        { url: STATUS_API, status: 200, headers: {}, body: null, truncated: false, base64Encoded: false, error: 'unreadable' },
        { url: STATUS_API, status: 200, headers: {}, body: JSON.stringify(fixture()), truncated: false, base64Encoded: false, error: null },
      ],
    }));
    const { recorder, records } = stepRecorder();

    const result = await new UPSTracker({ timeoutMs: 2_000, trawlUrl: TRAWL_URL, recorder }).fetch(TRACKING_NUMBER);

    expect(result).toMatchObject({
      status: 'out_for_delivery',
      tracking_source: 'structured-web-response',
      tracking_url: upsTrackingUrl(TRACKING_NUMBER),
    });
    expect(result.events?.length ?? 0).toBeGreaterThan(1);
    // One browser call and nothing else: no direct session, no cookie replay.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${TRAWL_URL}/scrape`);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      url: upsTrackingUrl(TRACKING_NUMBER),
      skipHttp: true,
      maxTier: 3,
      captureResponses: [STATUS_API],
    });
    expect(records).toEqual(['trawl:ok', 'lookup:trawl:ok']);
  });

  it('falls back to the page the browser rendered when no status reply was captured', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        tier: 3,
        statusCode: 200,
        url: upsTrackingUrl(TRACKING_NUMBER),
        html: RENDERED_PAGE,
        cookies: [],
        userAgent: 'Mozilla/5.0 (test browser)',
        capturedResponses: [
          { url: STATUS_API, status: 200, headers: {}, body: 'not json', truncated: false, base64Encoded: false, error: null },
        ],
      }), { headers: { 'Content-Type': 'application/json' } }));
    const { recorder, records } = stepRecorder();

    const result = await new UPSTracker({
      timeoutMs: 2_000,
      directTimeoutMs: 1_000,
      trawlUrl: 'http://trawl.internal:8191/v1',
      recorder,
    }).fetch(TRACKING_NUMBER);

    expect(result).toMatchObject({
      status: 'delivered',
      last_status_text: 'Delivered',
      tracking_source: 'rendered-page',
      tracking_url: upsTrackingUrl(TRACKING_NUMBER),
      events: [{ location: 'ZUERICH CH' }],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe('http://trawl.internal:8191/scrape');
    expect(records).toEqual(['trawl:ok', 'lookup:trawl:ok']);
  });

  it('rejects a number that is not a UPS number before any request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('must not fetch'));
    await expect(new UPSTracker({ trawlUrl: '' }).fetch('1Z999'))
      .rejects.toThrow('UPS tracking numbers must start with 1Z');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('UPS rendered page', () => {
  it('verifies the requested number before reading the status banner', () => {
    expect(parseUPSTrackingHtml(RENDERED_PAGE, TRACKING_NUMBER)).toMatchObject({
      status: 'delivered',
      last_status_text: 'Delivered',
      events: [{ location: 'ZUERICH CH' }],
    });
    expect(() => parseUPSTrackingHtml('<body>another parcel</body>', TRACKING_NUMBER))
      .toThrow('UPS did not return the requested parcel');
  });
});

it('never opens a plain HTTP session while a browser service is configured', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).includes('/scrape')
    ? Response.json({ tier: 3, statusCode: 200, html: RENDERED_PAGE, cookies: [] })
    : new Response('challenge', { status: 403 }));
  const tracker = new UPSTracker({ trawlUrl: TRAWL_URL });
  await tracker.fetch(TRACKING_NUMBER);
  await tracker.fetch(TRACKING_NUMBER);
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('ups.com'))).toHaveLength(0);
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/scrape'))).toHaveLength(2);
});

describe('UPS rendered progress bar', () => {
  const page = (nameKey: string) => `
    <html><head><meta name="stapp-tracknum" content="${TRACKING_NUMBER}"></head>
    <body>
      <span id="stApp_nameKey">${nameKey}</span>
      <ups-ac-progress-bar id="stApp_shpmtProgress">
        <ol><li class="progress-step active" aria-current="true"></li><li class="progress-step inactive"></li></ol>
        <ol>
          <li class="progress-step active" aria-current="true"><button class="step-label"><span>Label Created </span></button><span class="sr-only">active</span></li>
          <li class="progress-step inactive"><button class="step-label"><span>On the Way </span></button><span class="sr-only">inactive</span></li>
          <li class="progress-step inactive"><button class="step-label"><span>Out for Delivery </span></button><span class="sr-only">inactive</span></li>
        </ol>
      </ups-ac-progress-bar>
    </body></html>`;

  it('reads only the active milestone, not every milestone still ahead', () => {
    expect(parseUPSTrackingHtml(page('Label Created'), TRACKING_NUMBER)).toMatchObject({
      status: 'pending',
      last_status_text: 'Label Created',
    });
    expect(parseUPSTrackingHtml(page(''), TRACKING_NUMBER)).toMatchObject({
      status: 'pending',
      last_status_text: 'Label Created',
    });
  });
});
