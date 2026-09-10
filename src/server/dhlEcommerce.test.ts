import { afterEach, describe, expect, it, vi } from 'vitest';
import { DHLEcommerceTracker, dhlEcommerceTrackingUrl, normalizeDHLEcommerceNumber, parseDHLEcommerceResponse } from './dhlEcommerce';
import { CarrierTrackingAdapter } from './trackingSync';

const NUMBER = '33870000000000001';
function event(description = 'EN ROUTE', statusCode = 'transit', timestamp = '2026-09-09T05:40:17', address = { addressLocality: 'FR' }) {
  return { description, statusCode, timestamp, location: { address } };
}
function shipment() {
  return { shipments: [{ id: 'customer-confirmation-alias', service: 'ecommerce', status: event(),
    estimatedTimeOfDelivery: '2026-09-14', returnFlag: false,
    destination: { address: { streetAddress: 'PRIVATE ADDRESS' } },
    details: { references: [{ number: 'PRIVATE REFERENCE' }] },
    events: [event(), event('LABEL CREATED', 'pre-transit', '2026-08-31T03:11:58', { addressLocality: 'Hebron, KY, US' })] }] };
}

afterEach(() => vi.restoreAllMocks());

describe('DHL eCommerce normalization', () => {
  it('reads aliases, converts local timestamps, keeps announcement stages and discards private fields', () => {
    const result = parseDHLEcommerceResponse(shipment());
    expect(result).toMatchObject({ status: 'in_transit', current_stage: 'in_transit', last_update: '2026-09-09T03:40:17.000Z', expected_delivery: '2026-09-14' });
    expect(result.events?.[1]).toMatchObject({ time: '2026-08-31T07:11:58.000Z', stage: 'registered' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(result)).not.toContain('customer-confirmation');
  });
  it.each([
    ['MANIFEST DATA RECEIVED', 'unknown', 'registered', 'pending'],
    ['EN ROUTE TO DHL ECOMMERCE OR AWAITING PROCESSING', 'transit', 'registered', 'pending'],
    ['PACKAGE RECEIVED AT DHL ECOMMERCE DISTRIBUTION CENTER', 'transit', 'accepted', 'in_transit'],
    ['OUT FOR DELIVERY', 'transit', 'out_for_delivery', 'out_for_delivery'],
    ['READY FOR COLLECTION', 'transit', 'ready_for_pickup', 'out_for_delivery'],
    ['CUSTOMS CLEARANCE', 'transit', 'customs', 'in_transit'],
    ['CUSTOMS CLEARED', 'transit', 'in_transit', 'in_transit'],
    ['DELIVERY ATTEMPT FAILED', 'failure', 'failed_attempt', 'exception'],
    ['RETURNED TO SENDER', 'delivered', 'returned', 'exception'],
    ['Signed by PRIVATE', 'delivered', 'delivered', 'delivered'],
  ])('maps %s without inventing progress', (description, code, stage, status) => {
    const payload = shipment(); payload.shipments[0].status = event(description, code);
    payload.shipments[0].events = [payload.shipments[0].status];
    const result = parseDHLEcommerceResponse(payload);
    expect(result).toMatchObject({ current_stage: stage, status });
    if (stage === 'delivered' || stage === 'returned') expect(result.expected_delivery).toBeNull();
    if (stage === 'delivered') expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('handles return delivery flags and invalid delivery estimates', () => {
    const payload = shipment(); payload.shipments[0].status = event('Delivered', 'delivered');
    payload.shipments[0].returnFlag = true;
    expect(parseDHLEcommerceResponse(payload)).toMatchObject({ current_stage: 'returned', expected_delivery: null });
    payload.shipments[0].status = event(); payload.shipments[0].estimatedTimeOfDelivery = '2026-02-31';
    expect(parseDHLEcommerceResponse(payload).expected_delivery).toBeNull();
  });
  it('does not fabricate UTC timestamps for unknown localities, and honors explicit offsets', () => {
    const payload = shipment(); payload.shipments[0].events = [
      event('EN ROUTE', 'transit', '2026-09-01T09:00:00', { addressLocality: 'Unknown' }),
      event('PROCESSED', 'transit', '2026-09-01T09:00:00-05:00', { addressLocality: 'Unknown' }),
      event('EN ROUTE', 'transit', 'invalid'),
    ];
    expect(parseDHLEcommerceResponse(payload).events).toEqual([
      expect.objectContaining({ time: '2026-09-01T14:00:00.000Z' }),
    ]);
  });
  it('rejects ambiguous, malformed and other-division responses', () => {
    for (const payload of [{}, { shipments: [] }, { shipments: [shipment().shipments[0], shipment().shipments[0]] },
      { shipments: [{ ...shipment().shipments[0], service: 'express' }] },
      { shipments: [{ ...shipment().shipments[0], status: {} }] },
      { shipments: [{ ...shipment().shipments[0], events: {} }] }]) {
      expect(() => parseDHLEcommerceResponse(payload)).toThrow();
    }
  });
  it('normalizes numbers and creates the global tracking link', () => {
    expect(normalizeDHLEcommerceNumber('gm 1234-5678.9012 3456')).toBe('GM1234567890123456');
    expect(dhlEcommerceTrackingUrl(NUMBER)).toContain(`tracking-id=${NUMBER}&submit=1`);
    expect(() => normalizeDHLEcommerceNumber('https://evil.example')).toThrow();
  });
});

describe('DHL eCommerce fetching', () => {
  it('dispatches to the eCommerce adapter', async () => {
    const fetcher = vi.spyOn(DHLEcommerceTracker.prototype, 'fetch').mockResolvedValue({ status: 'in_transit' });
    expect(await new CarrierTrackingAdapter().fetch('dhl-ecommerce', NUMBER, null)).toMatchObject({ status: 'in_transit' });
    expect(fetcher).toHaveBeenCalledWith(NUMBER);
  });
  it('queries the exact requested alias at the fixed official endpoint', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(shipment()));
    await new DHLEcommerceTracker({ trawlUrl: '' }).fetch(NUMBER);
    expect(String(fetcher.mock.calls[0][0])).toBe(`https://www.dhl.com/utapi?trackingNumber=${NUMBER}&language=en&requesterCountryCode=CH&source=tt`);
  });
  it.each([403, 428])('bootstraps HTTP %s sessions, filters cookies and reuses the session', async (status) => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('Blocked', { status }))
      .mockResolvedValueOnce(Response.json({ tier: 3, statusCode: 200, url: dhlEcommerceTrackingUrl(NUMBER), userAgent: 'browser-agent', cookies: [
        { name: 'session', value: 'good', domain: '.dhl.com' },
        { name: 'foreign', value: 'bad', domain: 'evil.example' },
      ] }))
      .mockImplementation(async () => Response.json(shipment()));
    const tracker = new DHLEcommerceTracker({ trawlUrl: 'http://browser:8191/v1' });
    await tracker.fetch(NUMBER); await tracker.fetch(NUMBER);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[1][0]).toEqual(new URL('http://browser:8191/scrape'));
    const headers = new Headers(fetcher.mock.calls[2][1]?.headers);
    expect(headers.get('cookie')).toBe('session=good');
    expect(headers.get('user-agent')).toBe('browser-agent');
  });
  it.each([429, 500, 404])('does not bootstrap for HTTP %s', async (status) => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));
    await expect(new DHLEcommerceTracker({ trawlUrl: 'http://browser:8191' }).fetch(NUMBER)).rejects.toThrow(`HTTP ${status}`);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not bootstrap on invalid data or accept unrelated browser pages', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({}));
    const tracker = new DHLEcommerceTracker({ trawlUrl: 'http://browser:8191' });
    await expect(tracker.fetch(NUMBER)).rejects.toThrow('invalid tracking response');
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(Response.json({ tier: 3, statusCode: 200, url: 'https://evil.example', cookies: [] }));
    await expect(tracker.fetch(NUMBER)).rejects.toThrow('rejected');
  });
});
