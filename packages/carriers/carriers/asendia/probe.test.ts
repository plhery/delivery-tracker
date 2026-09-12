import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChallengeError, NotFoundError, SchemaError } from '../../core/errors';
import type { CarrierResult } from '../../core/result';
import {
  AsendiaTracker,
  asendiaConfigApiUrl,
  asendiaEnvironmentUrl,
  asendiaHitToken,
  asendiaTrackingApiUrl,
  asendiaTrackingUrl,
  normalizeAsendiaTrackingNumber,
  parseAsendiaPublicHitKey,
  parseAsendiaTrackingResponse,
} from './probe';
import { classifyAsendiaStatus, comparableText } from './status';

// Official Asendia documentation examples include ASE12345678 and S10 parcel
// identifiers such as LF092919653FR:
// https://send.asendia.com/es/tracking/
// https://www.asendia.dk/hubfs/Asendia%20Benelux%20onboarding%20docs/Asendia%20Sync%20-%20User%20Guide%201.pdf
const TRACKING_NUMBER = 'LF092919653FR';
const WRONG_TRACKING_NUMBER = 'ASE00000000';
// Public browser value captured only to make the official checksum algorithm deterministic.
const PUBLIC_HIT_KEY = '931c3f2dc020270300657b964e83679f8b2dd84301730a1c5ac21f33cf4a5618'; // gitleaks:allow
const TURNSTILE_TOKEN = `0.${'a'.repeat(64)}.${'b'.repeat(64)}`;
const FIXED_DATE = new Date('2026-08-30T12:00:00Z');

function json(relativePath: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'));
}

const carrier = json('./carrier.json') as { capabilities: readonly string[]; tracking: { adapter: string } };

function environmentScript(): string {
  return `window.__ENV = ${JSON.stringify({
    NEXT_PUBLIC_NODE_ENV: 'production',
    NEXT_PUBLIC_BRANDED_HIT_KEY: PUBLIC_HIT_KEY,
  })};`;
}

function configFixture(): unknown {
  return json('./fixtures/tenant-config.json');
}

// Provider-shaped fields are taken from Asendia's current official tracking
// bundle. The fixture is deterministic and deliberately includes private fields
// to prove that the probe never returns them.
function deliveredFixture(trackingNumber = TRACKING_NUMBER): {
  data: Array<Record<string, unknown>>;
} {
  const payload = json('./fixtures/delivered-parcel.json') as { data: Array<Record<string, unknown>> };
  payload.data[0]!.tracking_id = trackingNumber;
  payload.data[0]!.upper_tracking_id = trackingNumber;
  return payload;
}

afterEach(() => vi.restoreAllMocks());

describe('Asendia tracking input and public protocol', () => {
  it('accepts documented identifier families and builds official URLs', () => {
    expect(normalizeAsendiaTrackingNumber('lf09 2919-653fr')).toBe(TRACKING_NUMBER);
    expect(normalizeAsendiaTrackingNumber('ASE12345678')).toBe('ASE12345678');
    expect(normalizeAsendiaTrackingNumber('123456789012345678901234567890'))
      .toBe('123456789012345678901234567890');
    expect(asendiaTrackingUrl(TRACKING_NUMBER))
      .toBe(`https://track.asendia.com/track/${TRACKING_NUMBER}`);
    expect(asendiaTrackingApiUrl())
      .toBe('https://track.asendia.com/api/1.0/branded-url/branded-parcel-search?sort=shipment_date');
    expect(asendiaConfigApiUrl()).toContain('/api/1.0/branded-url/get-config-data/');
    expect(asendiaEnvironmentUrl()).toBe('https://track.asendia.com/__env.js');
  });

  it('rejects unsafe identifiers', () => {
    for (const value of [
      'ABC1234',
      'ABCDEFGH',
      'LF092919653FR?admin=true',
      'LF092919653/FR',
      'LF092919653FÉ',
      '1'.repeat(41),
    ]) expect(() => normalizeAsendiaTrackingNumber(value)).toThrow('8 to 40 ASCII');
  });

  it('reads the public frontend checksum key and reproduces its daily token', () => {
    expect(parseAsendiaPublicHitKey(environmentScript())).toBe(PUBLIC_HIT_KEY);
    expect(asendiaHitToken(WRONG_TRACKING_NUMBER, '2026-08-30', PUBLIC_HIT_KEY))
      .toBe('550a419b8b7a4955233a9937704f4ff67f7658508d59f95e711bb9cedc803450');
    expect(() => parseAsendiaPublicHitKey('window.__ENV = {};'))
      .toThrow(SchemaError);
    expect(() => parseAsendiaPublicHitKey('window.__ENV = {};'))
      .toThrow('valid request checksum key');
  });

  it('stays out of the adapter registry because Asendia is tracked universally', () => {
    expect(carrier.tracking.adapter).toBe('universal');
  });
});

describe('Asendia status vocabulary', () => {
  it('normalizes harmonized wording and keeps failure phrases ahead of delivery ones', () => {
    expect(comparableText('Arrived at destination')).toBe('arrived at destination');
    expect(classifyAsendiaStatus('Not delivered')).toEqual({ status: 'exception', stage: 'failed_attempt' });
    expect(classifyAsendiaStatus('Delivered')).toEqual({ status: 'delivered', stage: 'delivered' });
    expect(classifyAsendiaStatus('Held in customs')).toEqual({ status: 'in_transit', stage: 'customs' });
    expect(classifyAsendiaStatus('Brand new harmonized wording'))
      .toEqual({ status: 'unknown', stage: 'in_transit' });
  });
});

describe('Asendia response normalization', () => {
  it('parses and sorts current official event fields without retaining private shipment data', () => {
    const result = parseAsendiaTrackingResponse(deliveredFixture(), TRACKING_NUMBER);
    expect(result).toMatchObject({
      status: 'delivered',
      last_status_text: 'Delivered',
      last_update: '2026-08-29T11:42:00+02:00',
      expected_delivery: null,
      timezone: 'Europe/Zurich',
    });
    expect(result.events).toEqual([{
      time: '2026-08-29T11:42:00+02:00',
      location: 'Zurich, CH',
      description: 'Delivered',
      stage: 'delivered',
      provider_code: 'DELIVERED',
    }, {
      time: '2026-08-28T07:18:00+02:00',
      location: 'Zurich, CH',
      description: 'Arrived at destination',
      stage: 'in_transit',
      provider_code: 'ARRIVED_DESTINATION',
    }, {
      time: '2026-08-25T16:03:00+02:00',
      location: 'Paris, FR',
      description: 'Information received',
      stage: 'registered',
      provider_code: 'INFO_RECEIVED',
    }]);
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      'Private Recipient',
      'Private Street',
      'private-order-reference',
      'private@example.test',
      '8000 Private City',
    ]) expect(serialized).not.toContain(privateValue);
  });

  it('produces every capability carrier.json declares', () => {
    const delivered = parseAsendiaTrackingResponse(deliveredFixture(), TRACKING_NUMBER);
    const inFlight = deliveredFixture();
    inFlight.data[0]!.status = 'In transit';
    inFlight.data[0]!.estimated_delivery_date = '2026-08-29';
    const results: CarrierResult[] = [delivered, parseAsendiaTrackingResponse(inFlight, TRACKING_NUMBER)];
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
    expect(carrier.capabilities.length).toBeGreaterThan(0);
    for (const capability of carrier.capabilities) expect([...produced]).toContain(capability);
  });

  it('rejects a wrong number, a mismatched response, and malformed data', () => {
    expect(() => parseAsendiaTrackingResponse({ data: [] }, WRONG_TRACKING_NUMBER))
      .toThrow(NotFoundError);
    expect(() => parseAsendiaTrackingResponse(deliveredFixture('LF092919654FR'), TRACKING_NUMBER))
      .toThrow('different shipment');
    expect(() => parseAsendiaTrackingResponse([], TRACKING_NUMBER))
      .toThrow('invalid tracking response');
  });

  it('classifies not-delivered wording before the delivered substring', () => {
    const fixture = deliveredFixture();
    fixture.data[0]!.status = 'Not delivered';
    fixture.data[0]!.events = [{
      eventDateTime: '29/08/2026 11:42',
      eventRate: 5,
      harmonizedCode: 'NOT_DELIVERED',
      harmonizedEvent: 'Not delivered',
      eventDesc: 'Not delivered',
      scanningLocation: 'Zurich, CH',
    }];
    expect(parseAsendiaTrackingResponse(fixture, TRACKING_NUMBER)).toMatchObject({
      status: 'exception',
      events: [{ stage: 'failed_attempt' }],
    });
  });
});

describe('Asendia probe', () => {
  it('uses the live frontend configuration and constructs the structured search request', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === asendiaEnvironmentUrl()) return new Response(environmentScript());
      if (url === asendiaConfigApiUrl()) return new Response(JSON.stringify(configFixture()));
      if (url === asendiaTrackingApiUrl()) {
        expect(init).toMatchObject({
          method: 'POST',
          cache: 'no-store',
          redirect: 'error',
          headers: expect.objectContaining({
            'x-tenant-id': 'track.asendia.com',
            'X-Hit-Token': asendiaHitToken(TRACKING_NUMBER, '2026-08-30', PUBLIC_HIT_KEY),
          }),
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          ids: [TRACKING_NUMBER],
          id: 1,
          subsidiary: ['Asendia HQ'],
          subsidiary_id: [1],
          brand_id: '*',
          turnstile_token: TURNSTILE_TOKEN,
        });
        return new Response(JSON.stringify(deliveredFixture()));
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(new AsendiaTracker({
      timeoutMs: 1_000,
      now: () => FIXED_DATE,
      turnstileTokenProvider: () => TURNSTILE_TOKEN,
    }).fetch(TRACKING_NUMBER)).resolves.toMatchObject({
      status: 'delivered',
      tracking_url: asendiaTrackingUrl(TRACKING_NUMBER),
      tracking_source: 'structured-web-response',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('fails closed before network access when no fresh Turnstile token is available', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(new AsendiaTracker({ turnstileTokenProvider: () => '' })
      .fetch(TRACKING_NUMBER)).rejects.toThrow(ChallengeError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('recognizes the official Turnstile rejection without leaking its response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === asendiaEnvironmentUrl()) return new Response(environmentScript());
      if (url === asendiaConfigApiUrl()) return new Response(JSON.stringify(configFixture()));
      return new Response(JSON.stringify({
        summary: 'Turnstile token is required.',
        data: null,
        context_code: 1100,
      }), { status: 400 });
    });
    await expect(new AsendiaTracker({
      turnstileTokenProvider: () => TURNSTILE_TOKEN,
    }).fetch(WRONG_TRACKING_NUMBER)).rejects.toMatchObject({
      name: 'ChallengeError',
      kind: 'challenge',
      provider: 'Asendia',
      message: 'Asendia rejected the Cloudflare Turnstile token',
      status: 403,
    });
  });

  it('recognizes the current forbidden response for an invalid Turnstile token', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === asendiaEnvironmentUrl()) return new Response(environmentScript());
      if (url === asendiaConfigApiUrl()) return new Response(JSON.stringify(configFixture()));
      return new Response(JSON.stringify({ summary: 'Forbidden.', data: null }), { status: 403 });
    });
    await expect(new AsendiaTracker({
      turnstileTokenProvider: () => TURNSTILE_TOKEN,
    }).fetch(WRONG_TRACKING_NUMBER)).rejects.toMatchObject({
      name: 'ChallengeError',
      kind: 'challenge',
      message: 'Asendia rejected the Cloudflare Turnstile token',
      status: 403,
    });
  });

  it('maps an authenticated empty search result to a clean wrong-number error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === asendiaEnvironmentUrl()) return new Response(environmentScript());
      if (url === asendiaConfigApiUrl()) return new Response(JSON.stringify(configFixture()));
      return new Response(JSON.stringify({ summary: 'No parcels found.', data: [], context_code: 1000 }));
    });
    await expect(new AsendiaTracker({
      turnstileTokenProvider: () => TURNSTILE_TOKEN,
    }).fetch(WRONG_TRACKING_NUMBER)).rejects.toMatchObject({
      name: 'NotFoundError',
      kind: 'not_found',
      provider: 'Asendia',
      message: 'Asendia could not locate the shipment',
      status: 404,
    });
  });
});
