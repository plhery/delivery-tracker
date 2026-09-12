import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AmazonShippingNotFoundError,
  AmazonShippingTracker,
  amazonShippingTrackingApiUrl,
  amazonShippingTrackingUrl,
  normalizeAmazonShippingTrackingNumber,
  parseAmazonShippingTrackingResponse,
} from './adapter';
import { amazonShippingStatus } from './status';

const TRACKING_NUMBER = 'FR1234567890';

const fixture = (name: string): Record<string, unknown> => JSON.parse(
  readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
) as Record<string, unknown>;
const deliveredFixture = () => fixture('delivered');
const notFoundFixture = () => fixture('not-found');
const historyExpiredFixture = () => fixture('history-expired');
const capabilities = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

afterEach(() => vi.restoreAllMocks());

describe('Amazon Shipping France input', () => {
  it('normalizes the documented FR plus ten-digit format and builds official URLs', () => {
    expect(normalizeAmazonShippingTrackingNumber(' fr12 3456-7890 '))
      .toBe(TRACKING_NUMBER);
    expect(amazonShippingTrackingUrl(TRACKING_NUMBER))
      .toBe(`https://track.amazon.fr/tracking/${TRACKING_NUMBER}`);
    expect(amazonShippingTrackingApiUrl(TRACKING_NUMBER))
      .toBe(`https://track.amazon.fr/api/tracker/${TRACKING_NUMBER}`);
  });

  it('rejects malformed and injectable identifiers', () => {
    for (const value of [
      'FR123456789',
      'FR12345678901',
      'ZZ1234567890',
      'TBA12345678901',
      'TBA1234567890123',
      'FR123456789A',
      'FR1234567890?admin=true',
      'FR123456789É',
    ]) expect(() => normalizeAmazonShippingTrackingNumber(value)).toThrow('European country prefix');
  });
});

describe('Amazon Shipping France status normalization', () => {
  it.each([
    ['CREATION_CONFIRMED', 'pending'],
    ['PICKUP_DONE', 'in_transit'],
    ['IN_TRANSIT', 'in_transit'],
    ['OUT_FOR_DELIVERY', 'out_for_delivery'],
    ['HOLD_FOR_PICKUP', 'out_for_delivery'],
    ['DELIVERED', 'delivered'],
    ['DELAYED_AND_EDD_UPDATED', 'in_transit'],
    ['DELIVERY_ATTEMPTED', 'exception'],
    ['UNDELIVERABLE_DAMAGED', 'exception'],
    ['RETURNED_TO_SENDER', 'exception'],
    ['NEW_PROVIDER_STATUS', 'unknown'],
  ] as const)('maps %s to %s', (value, expected) => {
    expect(amazonShippingStatus(value)).toBe(expected);
  });
});

describe('Amazon Shipping France response normalization', () => {
  it('sorts safe events and discards recipient, street, postcode, merchant, and proof fields', () => {
    const result = parseAmazonShippingTrackingResponse(deliveredFixture());

    expect(result).toEqual({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-08-11T16:31:56+02:00',
      expected_delivery: '2026-08-11',
      timezone: 'Europe/Paris',
      events: [{
        time: '2026-08-11T16:31:56+02:00',
        description: 'Delivered',
        stage: 'delivered',
        provider_code: 'Delivered',
      }, {
        time: '2026-08-10T22:10:16+02:00',
        location: 'Paris, Île-de-France, FR',
        description: 'Departed facility',
        stage: 'in_transit',
        provider_code: 'Departed',
      }, {
        time: '2026-08-07T23:51:15+02:00',
        description: 'Shipment information received',
        stage: 'registered',
        provider_code: 'CreationConfirmed',
      }],
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'PRIVATE RECIPIENT',
      'PRIVATE STREET',
      'PRIVATE POSTCODE',
      'PRIVATE MERCHANT',
      'private@example.test',
      'PRIVATE DELIVERY IMAGE',
    ]) expect(serialized).not.toContain(privateValue);
  });

  it('covers every capability declared in carrier.json', () => {
    expect(capabilities).toEqual(['history', 'location', 'eta', 'provider_code']);
    const result = parseAmazonShippingTrackingResponse(deliveredFixture());
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(result.events?.some((event) => event.provider_code)).toBe(true);
    expect(result.expected_delivery).toBe('2026-08-11');
  });

  it('uses event history when the summary status is absent', () => {
    const fixtureWithoutSummary = deliveredFixture();
    fixtureWithoutSummary.progressTracker = JSON.stringify({
      summary: { status: null, metadata: {} },
      expectedDeliveryDate: null,
      trackerSource: 'SWA',
    });

    expect(parseAmazonShippingTrackingResponse(fixtureWithoutSummary)).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Delivered',
    });
  });

  it('maps Amazon\'s HTTP 200 not-found payload to a clean 404 error', () => {
    expect(() => parseAmazonShippingTrackingResponse(notFoundFixture()))
      .toThrow(AmazonShippingNotFoundError);
    try {
      parseAmazonShippingTrackingResponse(notFoundFixture());
    } catch (error) {
      expect(error).toMatchObject({
        name: 'AmazonShippingNotFoundError',
        status: 404,
        message: 'Amazon Shipping could not locate the shipment',
      });
    }
  });

  it('rejects malformed and status-free responses instead of inventing a state', () => {
    expect(() => parseAmazonShippingTrackingResponse([]))
      .toThrow('invalid tracking response');
    expect(() => parseAmazonShippingTrackingResponse({ progressTracker: '{' }))
      .toThrow('invalid progress tracker');
    expect(() => parseAmazonShippingTrackingResponse({
      progressTracker: JSON.stringify({ trackerSource: 'SWA', summary: { status: null, metadata: {} } }),
      eventHistory: null,
    })).toThrow('incomplete tracking details');
  });
});

describe('Amazon Shipping France tracker', () => {
  it('fetches the bounded public JSON endpoint with the matching public-page referer', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify(deliveredFixture()),
      { headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(new AmazonShippingTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .resolves.toMatchObject({ status: 'delivered' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(amazonShippingTrackingApiUrl(TRACKING_NUMBER));
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cache: 'no-store',
      redirect: 'error',
      headers: expect.objectContaining({
        Accept: 'application/json',
        Referer: amazonShippingTrackingUrl(TRACKING_NUMBER),
      }),
    });
  });

  it('exercises a valid-shaped wrong number through the real adapter path', async () => {
    const wrongNumber = 'FR0000000000';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify(notFoundFixture()),
      { headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(new AmazonShippingTracker({ timeoutMs: 1_000 }).fetch(wrongNumber))
      .rejects.toMatchObject({
        name: 'AmazonShippingNotFoundError',
        status: 404,
      });
  });

  it('enforces the response-size limit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', {
      headers: { 'Content-Length': '2000001' },
    }));

    await expect(new AmazonShippingTracker({ timeoutMs: 1_000 }).fetch(TRACKING_NUMBER))
      .rejects.toThrow('unexpectedly large response');
  });
});

describe('Amazon Shipping discovery boundaries', () => {
  it.each(['FR', 'DE', 'BE', 'UK', 'GB', 'IT', 'ES', 'NL', 'AT', 'IE', 'PL', 'SE', 'PT', 'CH'])(
    'supports the %s format', (prefix) => expect(normalizeAmazonShippingTrackingNumber(`${prefix}0000000001`)).toBe(`${prefix}0000000001`),
  );
  it('uses official regional portals and recognizes US numbers', () => {
    expect(amazonShippingTrackingApiUrl('UK0000000001')).toBe('https://track.amazon.co.uk/api/tracker/UK0000000001');
    expect(amazonShippingTrackingApiUrl('IT0000000001')).toContain('track.amazon.it');
    expect(amazonShippingTrackingApiUrl('ES0000000001')).toContain('track.amazon.es');
    expect(amazonShippingTrackingApiUrl('TBA000000000001')).toContain('track.amazon.com/api/tracker/TBA000000000001');
    expect(amazonShippingTrackingApiUrl('BE0000000001')).toContain('track.amazon.fr');
  });
  it('does not mistake an expired shipment placeholder for real movement', () => {
    expect(() => parseAmazonShippingTrackingResponse(historyExpiredFixture()))
      .toThrow('history has expired');
  });
  it('rejects contradictory identity even with usable tracking history', () => {
    expect(() => parseAmazonShippingTrackingResponse({ ...deliveredFixture(), trackingId: 'FR0000000002' }, 'Europe/Paris', 'FR0000000001'))
      .toThrow('different tracking number');
  });
  it('uses the UK timezone and does not invent US timezones', () => {
    const uk = parseAmazonShippingTrackingResponse(deliveredFixture(), 'Europe/London');
    expect(uk.events?.[0]?.time).toContain('+01:00');
    const us = parseAmazonShippingTrackingResponse(deliveredFixture(), null);
    expect(us.events?.every((event) => event.time === undefined)).toBe(true);
    expect(us.last_update).toBeNull();
    expect(us.timezone).toBeUndefined();
  });
});
