import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepRecorder } from '../../core/telemetry';
import { normalizeUSPSNumber, parseUSPSTrackingHtml, USPSTracker, uspsTrackingUrl } from './adapter';
import { uspsStage, uspsStatus } from './status';

// 9400111899223397910421 and 9400111899223397910438 are made-up numbers in
// USPS's published format. No real shipment, recipient or signatory appears
// in this file.
const DELIVERED_NUMBER = '9400111899223397910421';
const IN_TRANSIT_NUMBER = '9400111899223397910438';
const TRAWL_URL = 'http://trawl.internal:8191';
const DELIVERED_PAGE = readFileSync(new URL('./fixtures/delivered.html', import.meta.url), 'utf8');
const IN_TRANSIT_PAGE = readFileSync(new URL('./fixtures/in-transit.html', import.meta.url), 'utf8');
const CAPABILITIES = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

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

describe('USPS international numbers', () => {
  // Synthetic S10 serial; the check digit is independent of the country suffix.
  it.each(['CN', 'GB', 'CH', 'US'])('accepts a valid postal number issued in %s', (country) => {
    const raw = `lz 123.456-785 ${country.toLowerCase()}`;
    const expected = `LZ123456785${country}`;
    expect(normalizeUSPSNumber(raw)).toBe(expected);
    expect(new URL(uspsTrackingUrl(raw)).searchParams.get('tLabels')).toBe(expected);
  });

  it.each(['LZ123456789CN', 'LZ123456789US', 'LZ12345678CN', 'LZ123456785C'])
    ('rejects invalid international number %s before making a request', async (number) => {
      const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not fetch'));
      await expect(new USPSTracker({ trawlUrl: TRAWL_URL }).fetch(number)).rejects.toThrow('checksum-valid UPU S10');
      expect(fetcher).not.toHaveBeenCalled();
    });
});

describe('USPS status vocabulary', () => {
  it('maps the wording, and nothing else', () => {
    expect(uspsStage('Delivered, In/At Mailbox')).toBe('delivered');
    expect(uspsStage('Out for Delivery')).toBe('out_for_delivery');
    expect(uspsStage('Notice Left')).toBe('failed_attempt');
    expect(uspsStage('Pre-Shipment')).toBe('registered');
    expect(uspsStage('Available for Pickup')).toBe('ready_for_pickup');
    expect(uspsStatus('Delivered')).toBe('delivered');
    expect(uspsStatus('Out for Delivery')).toBe('out_for_delivery');
    // Unrecognized wording only means "moving" once the shipment has scans.
    expect(uspsStatus('Wording USPS has not used before')).toBe('unknown');
    expect(uspsStatus('Wording USPS has not used before', true)).toBe('in_transit');
    expect(uspsStage('Wording USPS has not used before')).toBeNull();
  });
});

describe('USPS rendered page', () => {
  it('projects the delivered history with state-zone timestamps', () => {
    const result = parseUSPSTrackingHtml(DELIVERED_PAGE, DELIVERED_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2025-03-14T08:00:00-04:00',
      expected_delivery: null,
    });
    expect(result.events).toEqual([
      { time: '2025-03-14T08:00:00-04:00', location: 'WASHINGTON, DC 20212', description: 'Delivered', stage: 'delivered' },
      { time: '2025-03-14T07:00:00-04:00', location: 'WASHINGTON, DC 20212', description: 'Out for Delivery', stage: 'out_for_delivery' },
      { time: '2025-03-13T18:15:00-04:00', location: 'WASHINGTON, DC 20212', description: 'Arrived at Post Office', stage: 'ready_for_pickup' },
      { time: '2025-03-12T09:30:00-04:00', location: 'LAUREL, MD 20707', description: 'Accepted at USPS Origin Facility', stage: 'accepted' },
    ]);
  });

  it('projects an in-transit parcel with its estimate', () => {
    const result = parseUSPSTrackingHtml(IN_TRANSIT_PAGE, IN_TRANSIT_NUMBER);
    expect(result).toMatchObject({
      status: 'in_transit',
      current_stage: 'in_transit',
      last_status_text: 'In Transit to Next Facility. Expected Delivery by Monday, March 17, 2025',
      last_update: '2025-03-15T23:20:00-05:00',
      expected_delivery: '2025-03-17',
    });
    expect(result.events).toHaveLength(3);
  });

  it('keeps the signatory out of the result', () => {
    const serialized = JSON.stringify(parseUSPSTrackingHtml(DELIVERED_PAGE, DELIVERED_NUMBER));
    expect(serialized).not.toContain('PRIVATE RECIPIENT');
  });

  it('produces every capability carrier.json declares', () => {
    expect(CAPABILITIES).toEqual(['history', 'location', 'eta']);
    const result = parseUSPSTrackingHtml(DELIVERED_PAGE, DELIVERED_NUMBER);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(parseUSPSTrackingHtml(IN_TRANSIT_PAGE, IN_TRANSIT_NUMBER).expected_delivery).toBeTruthy();
  });

  it('reports an unavailable number as unlocated and verifies the requested number', () => {
    const unavailable = DELIVERED_PAGE.replace(
      '<div class="banner-header">Delivered</div>',
      '<div class="banner-header">Tracking Not Available</div>');
    expect(parseUSPSTrackingHtml(unavailable, DELIVERED_NUMBER)).toMatchObject({
      status: 'unknown',
      events: [],
      last_status_text: 'USPS could not locate the shipment',
    });
    expect(() => parseUSPSTrackingHtml(DELIVERED_PAGE, IN_TRANSIT_NUMBER))
      .toThrow('USPS did not return the requested parcel');
    expect(() => parseUSPSTrackingHtml('<html><body>challenge shell</body></html>', DELIVERED_NUMBER))
      .toThrow('USPS challenged the browser tracking session');
  });
});

describe('USPS lookup steps', () => {
  function trawlReply(html: string, number = DELIVERED_NUMBER) {
    return Response.json({
      tier: 3,
      statusCode: 200,
      url: uspsTrackingUrl(number),
      html,
      cookies: [],
      userAgent: 'Mozilla/5.0 (test browser)',
      capturedResponses: [],
    });
  }

  it('reports the missing browser service without any request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('must not fetch'));
    await expect(new USPSTracker({ trawlUrl: '' }).fetch(DELIVERED_NUMBER))
      .rejects.toMatchObject({
        name: 'ChallengeError',
        message: 'USPS challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
      });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads the page the browser rendered', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(trawlReply(DELIVERED_PAGE));
    const { recorder, records } = stepRecorder();

    const result = await new USPSTracker({ timeoutMs: 2_000, trawlUrl: TRAWL_URL, recorder }).fetch(DELIVERED_NUMBER);

    expect(result).toMatchObject({
      status: 'delivered',
      tracking_source: 'rendered-page',
      tracking_url: uspsTrackingUrl(DELIVERED_NUMBER),
    });
    expect(result.events?.length ?? 0).toBeGreaterThan(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      url: uspsTrackingUrl(DELIVERED_NUMBER),
      skipHttp: true,
      maxTier: 3,
    });
    expect(records).toEqual(['trawl:ok', 'lookup:trawl:ok']);
  });

  it('retrieves incoming international mail under its original number and verifies the response identity', async () => {
    const number = 'LZ123456785CN';
    const html = DELIVERED_PAGE.replaceAll(DELIVERED_NUMBER, number);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(trawlReply(html, number));
    const result = await new USPSTracker({ trawlUrl: TRAWL_URL }).fetch(number);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).url).toBe(uspsTrackingUrl(number));
    expect(result).toMatchObject({ status: 'delivered', tracking_url: uspsTrackingUrl(number) });
    expect(result.events).toHaveLength(4);

    // A response for another country's identifier is not a verified handoff.
    fetcher.mockResolvedValueOnce(trawlReply(html.replaceAll(number, 'LZ123456785US'), number));
    await expect(new USPSTracker({ trawlUrl: TRAWL_URL }).fetch(number))
      .rejects.toThrow('USPS did not return the requested parcel');
  });

  it('rejects a number that is not a USPS number before any request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('must not fetch'));
    await expect(new USPSTracker({ trawlUrl: TRAWL_URL }).fetch('1Z999AA10123456784'))
      .rejects.toThrow('USPS tracking numbers must contain 20 or 22 digits');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('builds the canonical tracking URL', () => {
    expect(new URL(uspsTrackingUrl(DELIVERED_NUMBER)).searchParams.get('tLabels')).toBe(DELIVERED_NUMBER);
  });
});
