import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CarrierResult } from '../../core/result';
import { UpstreamHttpError } from '../../core/transport';
import * as trackingBrowser from '../../core/transport/browser';
import {
  DHLEcommerceSessionError, DHLEcommerceTracker, dhlEcommerceTrackingUrl,
  normalizeDHLEcommerceNumber, parseDHLEcommerceResponse,
} from './adapter';

const NUMBER = '33870000000000001';

interface Scan { description: string; statusCode: string; timestamp: string; location: { address: Record<string, unknown> } }
interface Payload {
  shipments: ({ id: string; service: string; status: Scan; events: Scan[]; estimatedTimeOfDelivery?: string; returnFlag?: boolean } & Record<string, unknown>)[];
}

function json<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8')) as T;
}

function event(description = 'EN ROUTE', statusCode = 'transit', timestamp = '2026-09-09T05:40:17', address = { addressLocality: 'FR' }): Scan {
  return { description, statusCode, timestamp, location: { address } };
}
function shipment(): Payload {
  return json<Payload>('./fixtures/in-transit.json');
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

  it('produces every capability declared in carrier.json, without private fields', () => {
    const checks: Record<string, (result: CarrierResult) => unknown> = {
      history: (result) => result.events?.length,
      location: (result) => result.events?.some((scan) => scan.location),
      eta: (result) => result.expected_delivery,
      sender_name: (result) => result.sender_name,
      delivered_at: (result) => result.delivered_at,
    };
    const declared = json<{ capabilities: string[] }>('./carrier.json').capabilities;
    const results = [parseDHLEcommerceResponse(shipment()), parseDHLEcommerceResponse(json<Payload>('./fixtures/delivered.json'))];
    expect(declared.length).toBeGreaterThan(0);
    for (const capability of declared) {
      expect(checks[capability], `no check for capability ${capability}`).toBeDefined();
      expect(results.some((result) => Boolean(checks[capability]!(result))), capability).toBe(true);
    }
    for (const result of results) expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it.each([
    ['MANIFEST DATA RECEIVED', 'unknown', 'registered', 'pending'],
    ['EN ROUTE TO DHL ECOMMERCE OR AWAITING PROCESSING', 'transit', 'registered', 'pending'],
    ['PACKAGE RECEIVED AT DHL ECOMMERCE DISTRIBUTION CENTER', 'transit', 'accepted', 'in_transit'],
    ['OUT FOR DELIVERY', 'transit', 'out_for_delivery', 'out_for_delivery'],
    ['READY FOR COLLECTION', 'transit', 'ready_for_pickup', 'out_for_delivery'],
    ['CUSTOMS CLEARANCE', 'transit', 'customs', 'in_transit'],
    ['CUSTOMS CLEARED', 'transit', 'in_transit', 'in_transit'],
    ['Carrier exception', 'failure', 'failed_attempt', 'exception'],
    ['DELIVERY ATTEMPT FAILED', 'failure', 'failed_attempt', 'exception'],
    ['RETURNED TO SENDER', 'delivered', 'returned', 'exception'],
    ['Signed by PRIVATE', 'delivered', 'delivered', 'delivered'],
  ])('maps %s without inventing progress', (description, code, stage, status) => {
    const payload = shipment(); payload.shipments[0]!.status = event(description, code);
    payload.shipments[0]!.events = [payload.shipments[0]!.status];
    const result = parseDHLEcommerceResponse(payload);
    expect(result).toMatchObject({ current_stage: stage, status });
    if (stage === 'delivered' || stage === 'returned') expect(result.expected_delivery).toBeNull();
    if (stage === 'delivered') expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('handles return delivery flags and invalid delivery estimates', () => {
    const payload = shipment(); payload.shipments[0]!.status = event('Delivered', 'delivered');
    payload.shipments[0]!.returnFlag = true;
    expect(parseDHLEcommerceResponse(payload)).toMatchObject({ current_stage: 'returned', expected_delivery: null });
    payload.shipments[0]!.status = event(); payload.shipments[0]!.estimatedTimeOfDelivery = '2026-02-31';
    expect(parseDHLEcommerceResponse(payload).expected_delivery).toBeNull();
  });

  it('does not fabricate UTC timestamps for unknown localities, and honors explicit offsets', () => {
    const payload = shipment(); payload.shipments[0]!.events = [
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
  it('rejects invalid timeouts before doing any work', () => {
    for (const timeoutMs of [0, -1, Infinity, NaN, 60_001]) {
      expect(() => new DHLEcommerceTracker({ timeoutMs })).toThrow('timeout');
    }
  });

  it('goes straight to the browser without a direct HTTP attempt', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const browser = vi.spyOn(trackingBrowser, 'scrapeUniversalPage').mockImplementation(async (_options, spec, parse) => {
      expect(spec.url).toBe(dhlEcommerceTrackingUrl(NUMBER));
      expect(spec.responseUrl).toBe(`https://www.dhl.com/utapi?trackingNumber=${NUMBER}&language=en&requesterCountryCode=CH&source=tt`);
      return parse(shipment());
    });
    const result = await new DHLEcommerceTracker({ executablePath: '/test/chromium', timeoutMs: 30000 }).fetch(NUMBER);
    expect(result.current_stage).toBe('in_transit');
    expect(fetcher).not.toHaveBeenCalled();
    expect(browser).toHaveBeenCalledOnce();
    expect(browser.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(30000);
  });

  it('propagates browser failures without a direct attempt', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const browser = vi.spyOn(trackingBrowser, 'scrapeUniversalPage').mockRejectedValue(new Error('Browser unavailable'));
    await expect(new DHLEcommerceTracker({ executablePath: '/test/chromium' }).fetch(NUMBER)).rejects.toThrow('Browser unavailable');
    expect(fetcher).not.toHaveBeenCalled();
    expect(browser).toHaveBeenCalledOnce();
  });

  it('names the challenge statuses so the host keeps the upstream status', async () => {
    vi.spyOn(trackingBrowser, 'scrapeUniversalPage').mockRejectedValue(new UpstreamHttpError('DHL eCommerce', 428));
    await expect(new DHLEcommerceTracker({ executablePath: '/test/chromium' }).fetch(NUMBER)).rejects
      .toMatchObject({ name: 'DHLEcommerceSessionError', status: 428 });
    await expect(new DHLEcommerceTracker({ executablePath: '/test/chromium' }).fetch(NUMBER)).rejects
      .toBeInstanceOf(DHLEcommerceSessionError);
    vi.spyOn(trackingBrowser, 'scrapeUniversalPage').mockRejectedValue(new UpstreamHttpError('DHL eCommerce', 503));
    await expect(new DHLEcommerceTracker({ executablePath: '/test/chromium' }).fetch(NUMBER)).rejects
      .toMatchObject({ name: 'UpstreamHttpError', status: 503 });
  });

  it('reports the browser step through the recorder', async () => {
    vi.spyOn(trackingBrowser, 'scrapeUniversalPage').mockImplementation(async (_options, _spec, parse) => parse(shipment()));
    const steps: string[] = [];
    const lookups: (string | null)[] = [];
    await new DHLEcommerceTracker({ executablePath: '/test/chromium', recorder: {
      step: ({ step }) => { steps.push(step); },
      lookup: ({ finalStep }) => { lookups.push(finalStep); },
    } }).fetch(NUMBER);
    expect(steps).toEqual(['browser']);
    expect(lookups).toEqual(['browser']);
  });
});
