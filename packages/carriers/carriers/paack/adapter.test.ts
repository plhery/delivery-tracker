import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import {
  PaackTracker,
  normalizePaackPostcode,
  normalizePaackTrackingNumber,
  paackTrackingUrl,
  parsePaackTrackingHtml,
  parsePaackTrackingResponse,
} from './adapter';
import { classifyPaackEvent, statusKey } from './status';

// Paack publishes this synthetic exchange order in its official Postman
// examples: https://www.postman.com/paacklogistics/paack-apis/folder/1uuw6iw/orders-api
// The response below is a fully synthetic provider-shaped fixture.
const OFFICIAL_EXAMPLE_NUMBER = 'EXCHANGE000001D';
const OFFICIAL_EXAMPLE_POSTCODE = '08006';

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'));
}

const carrier = json('./carrier.json') as { capabilities: readonly string[] };

function successRoute(overrides: Record<string, unknown> = {}): unknown {
  return { ...json('./fixtures/delivered-order.json') as Record<string, unknown>, ...overrides };
}

function trackingPage(route: unknown = successRoute()): string {
  const context = {
    state: {
      loaderData: {
        root: { ENV: { PUBLIC_CONFIG: 'not retained' } },
        'routes/tracking.order': route,
      },
    },
  };
  return `<!doctype html><html><body><main>Tracking</main>
    <script>window.__remixContext = ${JSON.stringify(context)};</script>
  </body></html>`;
}

function producedCapabilities(...results: CarrierResult[]): Set<string> {
  const produced = new Set<string>();
  for (const result of results) {
    const events = result.events ?? [];
    if (events.length > 0) produced.add('history');
    if (events.some((event) => event.location)) produced.add('location');
    if (events.some((event) => event.provider_code)) produced.add('provider_code');
    if (result.expected_delivery) produced.add('eta');
    if (result.expected_delivery_from) produced.add('eta_window');
    if (result.sender_name) produced.add('sender_name');
    if (result.pickup_point) produced.add('pickup_point');
    if (result.weight_kg != null) produced.add('weight');
    if (result.dimensions_text) produced.add('dimensions');
    if (result.delivered_at) produced.add('delivered_at');
  }
  return produced;
}

afterEach(() => vi.restoreAllMocks());

describe('Paack anonymous tracking request', () => {
  it('validates the order and 3- to 10-character destination postcode independently', () => {
    expect(normalizePaackTrackingNumber(` ${OFFICIAL_EXAMPLE_NUMBER.toLowerCase()} `))
      .toBe(OFFICIAL_EXAMPLE_NUMBER);
    expect(normalizePaackPostcode(' 75 001 ')).toBe('75001');
    expect(normalizePaackPostcode('4445-027')).toBe('4445-027');
    expect(normalizePaackPostcode('1201')).toBe('1201');
    expect(normalizePaackPostcode('sw1a 1aa')).toBe('SW1A1AA');

    for (const value of [
      'ABC',
      'ABCD',
      'ORDER-NUMBER',
      'ORDER_PRIVATE',
      'ORDER?admin=true',
      'ORDER/PRIVATE',
      'ORDÉR',
      '1'.repeat(41),
    ]) {
      expect(() => normalizePaackTrackingNumber(value)).toThrow('4 to 40 ASCII');
    }
    for (const value of [
      '12',
      '12 - 345',
      '75001&admin=true',
      'ABCDEFGHIJ',
      '75_001',
      '75001É',
    ]) {
      expect(() => normalizePaackPostcode(value)).toThrow('3- to 10-character');
    }
  });

  it('builds the official two-factor query without allowing parameter injection', () => {
    const url = new URL(paackTrackingUrl(
      OFFICIAL_EXAMPLE_NUMBER,
      OFFICIAL_EXAMPLE_POSTCODE,
    ));
    expect(url.origin).toBe('https://mydeliveries.paack.app');
    expect(url.pathname).toBe('/tracking/order');
    expect(url.searchParams.get('tracking_number')).toBe(OFFICIAL_EXAMPLE_NUMBER);
    expect(url.searchParams.get('postal_code')).toBe(OFFICIAL_EXAMPLE_POSTCODE);
    expect([...url.searchParams]).toHaveLength(2);
  });
});

describe('Paack status vocabulary', () => {
  it('keys on the stable identifiers and leaves unknown ones unmapped', () => {
    expect(statusKey('returnedToSender')).toBe('returnedtosender');
    expect(classifyPaackEvent({ id: 'pudoAssignedHeader', label: 'pudoAssignedHeader' }))
      .toMatchObject({ stage: 'in_transit' });
    expect(classifyPaackEvent({ id: 'brandNewState', label: 'brandNewState' })).toEqual({
      status: 'unknown',
      stage: 'in_transit',
      description: 'Shipment update',
    });
  });
});

describe('Paack response normalization', () => {
  it('parses a provider-shaped fixture while excluding order and event variables', () => {
    const result = parsePaackTrackingResponse(successRoute(), OFFICIAL_EXAMPLE_NUMBER);

    expect(result).toMatchObject({
      status: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2024-07-28T13:02:00.000Z',
      expected_delivery: null,
      timezone: 'Europe/Paris',
    });
    expect(result.events).toEqual([
      {
        time: '2024-07-28T13:02:00.000Z',
        description: 'Delivered',
        stage: 'delivered',
      },
      {
        time: '2024-07-28T10:05:00.000Z',
        description: 'Out for delivery',
        stage: 'out_for_delivery',
      },
      {
        time: '2024-07-27T16:30:00.000Z',
        description: 'Delivery issue',
        stage: 'failed_attempt',
      },
    ]);
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'PRIVATE INTERNAL ORDER',
      'PRIVATE RETAILER',
      'PRIVATE RECIPIENT',
      'private@example.test',
      'PRIVATE PHONE',
      'PRIVATE STREET',
    ]) expect(serialized).not.toContain(privateValue);
  });

  it('extracts the Remix loader response from provider HTML', () => {
    expect(parsePaackTrackingHtml(trackingPage(), OFFICIAL_EXAMPLE_NUMBER))
      .toMatchObject({ status: 'delivered', last_status_text: 'Delivered' });
  });

  it('retains an expected date only for a non-terminal shipment', () => {
    const result = parsePaackTrackingResponse(successRoute({
      eventList: [{
        id: 'driver-assigned',
        label: 'inProgress',
        timestamp: '2024-07-28T12:05:00+02:00',
        timeline: true,
      }],
      activeEvent: {
        id: 'driver-assigned',
        label: 'inProgress',
        time: '2024-07-28T12:05:00+02:00',
      },
    }), OFFICIAL_EXAMPLE_NUMBER);
    expect(result).toMatchObject({
      status: 'out_for_delivery',
      expected_delivery: '2024-07-28',
    });
  });

  it('produces every capability carrier.json declares', () => {
    const delivered = parsePaackTrackingResponse(successRoute(), OFFICIAL_EXAMPLE_NUMBER);
    const inFlight = parsePaackTrackingResponse(successRoute({
      eventList: [{
        id: 'driver-assigned',
        label: 'inProgress',
        timestamp: '2024-07-28T12:05:00+02:00',
        timeline: true,
      }],
      activeEvent: { id: 'driver-assigned', label: 'inProgress' },
    }), OFFICIAL_EXAMPLE_NUMBER);
    const produced = producedCapabilities(delivered, inFlight);
    expect(carrier.capabilities.length).toBeGreaterThan(0);
    for (const capability of carrier.capabilities) expect([...produced]).toContain(capability);
  });

  it('classifies not-delivered wording before the delivered substring', () => {
    const result = parsePaackTrackingResponse(successRoute({
      eventList: [{
        id: 'not-delivered',
        label: 'notDelivered',
        timestamp: '2024-07-28T15:02:00+02:00',
        timeline: true,
      }],
      activeEvent: {
        id: 'not-delivered',
        label: 'notDelivered',
      },
    }), OFFICIAL_EXAMPLE_NUMBER);
    expect(result).toMatchObject({
      status: 'exception',
      events: [{ stage: 'failed_attempt' }],
    });
  });

  it('maps the official Paack return and recipient-absent identifiers', () => {
    const returned = parsePaackTrackingResponse(successRoute({
      eventList: [{
        id: 'returnedToSender',
        label: 'returnedToSender',
        timestamp: '2024-07-28T15:02:00+02:00',
        timeline: true,
      }],
      activeEvent: {
        id: 'returnedToSender',
        label: 'returnedToSender',
      },
    }), OFFICIAL_EXAMPLE_NUMBER);
    expect(returned).toMatchObject({
      status: 'exception',
      events: [{ stage: 'returned' }],
    });

    const absent = parsePaackTrackingResponse(successRoute({
      eventList: [{
        id: 'absent',
        label: 'absent',
        timestamp: '2024-07-28T15:02:00+02:00',
        timeline: true,
      }],
      activeEvent: {
        id: 'absent',
        label: 'absent',
      },
    }), OFFICIAL_EXAMPLE_NUMBER);
    expect(absent).toMatchObject({
      status: 'exception',
      events: [{ stage: 'failed_attempt' }],
    });
  });

  it.each(['returnToSenderScheduled', 'returnAbsent', 'returnOther'])(
    'keeps the non-final %s return state active',
    (identifier) => {
      const result = parsePaackTrackingResponse(successRoute({
        eventList: [{
          id: identifier,
          label: identifier,
          timestamp: '2024-07-28T15:02:00+02:00',
          timeline: true,
        }],
        activeEvent: { id: identifier, label: identifier },
      }), OFFICIAL_EXAMPLE_NUMBER);
      expect(result).toMatchObject({
        status: 'exception',
        events: [{ stage: 'failed_attempt' }],
      });
    },
  );

  it('uses the official active event when it is newer than the timeline', () => {
    const result = parsePaackTrackingResponse(successRoute({
      eventList: [{
        id: 'received-at-hub',
        label: 'receivedAtHub',
        timestamp: '2024-07-28T12:05:00+02:00',
        timeline: true,
      }],
      activeEvent: {
        id: 'returnedToSender',
        label: 'returnedToSender',
      },
    }), OFFICIAL_EXAMPLE_NUMBER);
    expect(result).toMatchObject({
      status: 'exception',
      last_status_text: 'Shipment returned',
      events: [{ stage: 'in_transit' }],
    });
  });

  it.each([
    ['scannedAtOriginHeader', 'in_transit', 'accepted'],
    ['orderReactivated', 'pending', 'registered'],
    ['appointmentBroughtForward', 'pending', 'registered'],
    ['appointmentRescheduled', 'pending', 'registered'],
    ['pudoAssignedHeader', 'in_transit', 'in_transit'],
    ['integrationError', 'exception', 'failed_attempt'],
  ] as const)('maps the official active label %s', (label, status, stage) => {
    const result = parsePaackTrackingResponse(successRoute({
      eventList: [{
        id: label,
        label,
        timestamp: '2024-07-28T15:02:00+02:00',
        timeline: true,
      }],
      activeEvent: { id: label, label },
    }), OFFICIAL_EXAMPLE_NUMBER);
    expect(result).toMatchObject({
      status,
      events: [{ stage }],
    });
    expect(result.last_status_text).toBeTruthy();
  });

  it('rejects mismatched or malformed success data and maps explicit not-found', () => {
    expect(() => parsePaackTrackingResponse(successRoute({
      orderTrackData: { external_id: 'EXCHANGE000001R' },
    }), OFFICIAL_EXAMPLE_NUMBER)).toThrow(SchemaError);
    expect(() => parsePaackTrackingResponse(successRoute({
      orderTrackData: { external_id: 'EXCHANGE000001R' },
    }), OFFICIAL_EXAMPLE_NUMBER)).toThrow('different shipment');
    expect(() => parsePaackTrackingResponse({ orderTrackData: {
      external_id: OFFICIAL_EXAMPLE_NUMBER,
    } }, OFFICIAL_EXAMPLE_NUMBER)).toThrow('incomplete tracking details');
    expect(() => parsePaackTrackingHtml(
      '<main>Order not found. Incorrect order number or postal code.</main>',
      OFFICIAL_EXAMPLE_NUMBER,
    )).toThrow(NotFoundError);
  });
});

describe('Paack tracker', () => {
  it('uses a bounded no-redirect request with both recipient inputs', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(trackingPage()));

    await expect(new PaackTracker({ timeoutMs: 1_000 }).fetch(
      OFFICIAL_EXAMPLE_NUMBER,
      OFFICIAL_EXAMPLE_POSTCODE,
    )).resolves.toMatchObject({ status: 'delivered' });
    expect(fetcher.mock.calls[0]?.[0]).toBe(paackTrackingUrl(
      OFFICIAL_EXAMPLE_NUMBER,
      OFFICIAL_EXAMPLE_POSTCODE,
    ));
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      cache: 'no-store',
      redirect: 'manual',
    });
  });

  it('maps the official wrong-number redirect and 404 to a clean not-found error', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    fetcher.mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: '/tracking?tracking_number=00000000&postal_code=75001&err=true' },
    }));
    await expect(new PaackTracker().fetch('00000000', '75001')).rejects.toMatchObject({
      name: 'NotFoundError',
      kind: 'not_found',
      provider: 'Paack',
      message: 'Paack could not locate the shipment',
      status: 404,
    });

    fetcher.mockResolvedValueOnce(new Response('Not found', { status: 404 }));
    await expect(new PaackTracker().fetch('00000000', '75001'))
      .rejects.toMatchObject({ status: 404 });
  });
});
