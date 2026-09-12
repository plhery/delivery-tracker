import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CarrierResult } from '../../core/result';
import { fetchPostNL, parsePostNLTrackingResponse, PostNLTracker } from './adapter';
import { postNLStatus } from './status';

const folder = path.dirname(fileURLToPath(import.meta.url));
const carrier = JSON.parse(
  readFileSync(path.join(folder, 'carrier.json'), 'utf8'),
) as { capabilities: string[] };

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(folder, 'fixtures', name), 'utf8'));
}

const POSTNL_WRONG_NUMBER = 'LT000000000NL';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PostNL transient failures', () => {
  beforeEach(() => vi.useFakeTimers());

  it.each(['authentication', 'tracking'])('recovers from a rate-limited %s request', async (step) => {
    const responses = [
      jsonResponse({ access_token: 'visitor-token' }),
      jsonResponse({ data: { items: [{ item: POSTNL_WRONG_NUMBER, events: [] }] } }),
    ];
    responses.splice(step === 'authentication' ? 0 : 1, 0, new Response('', {
      status: 429, headers: { 'Retry-After': '6' },
    }));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses.shift()!);
    const result = fetchPostNL(POSTNL_WRONG_NUMBER);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(fetcher).toHaveBeenCalledTimes(step === 'authentication' ? 1 : 2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ status: 'unknown', events: [] });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const trackingRequests = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/tracking-items'));
    for (const [, init] of trackingRequests) {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer visitor-token' });
      expect(JSON.parse(String(init?.body))).toEqual({ items: [POSTNL_WRONG_NUMBER], language_code: 'en' });
    }
  });
});

describe('PostNL wrong-number handling', () => {
  it('maps the explicit barcode-not-found item to a privacy-safe 404', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'visitor-token' }))
      .mockResolvedValueOnce(jsonResponse({
        status: 'success',
        data: {
          items: [{
            item: POSTNL_WRONG_NUMBER,
            message: 'The shipment barcode was not found. Private upstream details',
            events: [],
          }],
        },
      }));

    try {
      await fetchPostNL(POSTNL_WRONG_NUMBER);
      throw new Error('Expected the lookup to fail');
    } catch (error) {
      expect(error).toMatchObject({ name: 'NotFoundError', status: 404, kind: 'not_found' });
      expect(String(error)).toContain('PostNL could not locate the shipment');
      expect(String(error)).not.toContain('Private upstream details');
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [, init] = fetcher.mock.calls[1]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      items: [POSTNL_WRONG_NUMBER],
      language_code: 'en',
    });
  });

  it('rejects an answer describing a different shipment', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'visitor-token' }))
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [{ item: 'LT111111111NL', events: [] }] },
      }));

    await expect(fetchPostNL(POSTNL_WRONG_NUMBER)).rejects.toThrow('different shipment');
  });

  it('refuses a visitor token that is missing or implausibly long', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: '' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'x'.repeat(16_385) }));

    await expect(fetchPostNL(POSTNL_WRONG_NUMBER)).rejects.toThrow('invalid visitor token');
    await expect(fetchPostNL(POSTNL_WRONG_NUMBER)).rejects.toThrow('invalid visitor token');
  });

  it('uses the environment fetcher the factory hands the tracker', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'visitor-token' }))
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [{ item: POSTNL_WRONG_NUMBER, events: [] }] },
      }));
    const global = vi.spyOn(globalThis, 'fetch');

    await expect(new PostNLTracker({ fetcher }).fetch(POSTNL_WRONG_NUMBER))
      .resolves.toMatchObject({ status: 'unknown' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(global).not.toHaveBeenCalled();
  });
});

describe('official PostNL status categories', () => {
  it.each([
    ['Pre-advised', 'pending', 'registered'],
    ['Preparing', 'pending', 'registered'],
    ['Processing', 'in_transit', 'accepted'],
    ['Departed', 'in_transit', 'in_transit'],
    ['Arrived', 'in_transit', 'in_transit'],
    ['In transit', 'in_transit', 'in_transit'],
    ['Transit', 'in_transit', 'in_transit'],
    ['Customs', 'in_transit', 'customs'],
    ['Out for delivery', 'out_for_delivery', 'out_for_delivery'],
    ['Pick-up point', 'out_for_delivery', 'ready_for_pickup'],
    ['Delivered', 'delivered', 'delivered'],
    // PostNL's own spelling, kept next to the corrected one.
    ['Unsuccesfull', 'exception', 'failed_attempt'],
    ['Unsuccessful', 'exception', 'failed_attempt'],
    ['Undelivered', 'exception', 'failed_attempt'],
    ['Returned', 'exception', 'returned'],
    ['Exception', 'exception', 'exception'],
  ] as const)('maps %s to %s / %s', async (category, status, stage) => {
    expect(postNLStatus(category)).toEqual({ status, stage });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'visitor-token' }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [{
            item: POSTNL_WRONG_NUMBER,
            events: [{
              category,
              datetime_local: '2026-08-30T12:00:00Z',
              status_description: `${category} event`,
            }],
          }],
        },
      }));

    await expect(fetchPostNL(POSTNL_WRONG_NUMBER)).resolves.toMatchObject({
      status,
      current_stage: stage,
      events: [{ stage }],
    });
  });

  it('leaves an unfamiliar category unmapped and the shipment moving', () => {
    expect(postNLStatus('Handed to partner')).toBeUndefined();
    const result = parsePostNLTrackingResponse({
      data: {
        items: [{
          item: POSTNL_WRONG_NUMBER,
          events: [{ category: 'Handed to partner', datetime_local: '2026-08-30T12:00:00Z' }],
        }],
      },
    }, POSTNL_WRONG_NUMBER);
    expect(result.status).toBe('in_transit');
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.[0]?.stage).toBeUndefined();
  });
});

describe('PostNL declared capabilities and privacy', () => {
  const delivered = parsePostNLTrackingResponse(fixture('delivered.json'), 'LX123456785NL');
  const checks: Record<string, (result: CarrierResult) => boolean> = {
    history: (result) => (result.events?.length ?? 0) > 0,
    location: (result) => (result.events ?? []).some((event) => Boolean(event.location)),
    eta: (result) => Boolean(result.expected_delivery),
    eta_window: (result) => Boolean(result.expected_delivery_from),
    sender_name: (result) => Boolean(result.sender_name),
    pickup_point: (result) => Boolean(result.pickup_point),
    weight: (result) => result.weight_kg != null,
    dimensions: (result) => Boolean(result.dimensions_text),
    delivered_at: (result) => Boolean(result.delivered_at),
    provider_code: (result) => (result.events ?? []).some((event) => Boolean(event.provider_code)),
  };

  it('keeps the journey, the country of each scan and the webshop name', () => {
    expect(delivered).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Shipment delivered',
      last_update: '2026-09-03T10:12:00',
      // PostNL's international tracker publishes no estimate.
      expected_delivery: null,
      sender_name: 'Example Webshop',
      delivered_at: '2026-09-03T10:12:00',
    });
    expect(delivered.events?.map((event) => [event.stage, event.location])).toEqual([
      ['delivered', 'Netherlands'],
      ['out_for_delivery', 'Netherlands'],
      ['customs', 'Netherlands'],
      ['registered', 'CN'],
    ]);
  });

  it.each(carrier.capabilities)('declares %s and a fixture proves it', (capability) => {
    const check = checks[capability];
    expect(check, `unknown capability ${capability}`).toBeTypeOf('function');
    expect(check!(delivered)).toBe(true);
  });

  it('drops the recipient and the signature', () => {
    const projected = JSON.stringify(delivered);
    for (const value of ['Made Up Recipient', 'Example Street 1', 'proof-of-delivery']) {
      expect(projected).not.toContain(value);
    }
  });
});
