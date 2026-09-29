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
      jsonResponse({ data: { items: [{ item: POSTNL_WRONG_NUMBER, events: [{ category: 'Processing', datetime_local: '2026-08-30T12:00:00Z', country_code: 'NL' }] }] } }),
    ];
    responses.splice(step === 'authentication' ? 0 : 1, 0, new Response('', {
      status: 429, headers: { 'Retry-After': '6' },
    }));
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => responses.shift()!);
    const result = fetchPostNL(POSTNL_WRONG_NUMBER);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(fetcher).toHaveBeenCalledTimes(step === 'authentication' ? 1 : 2);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ status: 'in_transit', events: [{ stage: 'accepted' }] });
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

    await expect(fetchPostNL(POSTNL_WRONG_NUMBER)).rejects.toThrow('different or ambiguous shipment');
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
        data: { items: [{ item: POSTNL_WRONG_NUMBER, events: [{ category: 'Processing', datetime_local: '2026-08-30T12:00:00Z', country_code: 'NL' }] }] },
      }));
    const global = vi.spyOn(globalThis, 'fetch');

    await expect(new PostNLTracker({ fetcher }).fetch(POSTNL_WRONG_NUMBER))
      .resolves.toMatchObject({ status: 'in_transit' });
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

  it('leaves an unfamiliar category and the shipment status unknown', () => {
    expect(postNLStatus('Handed to partner')).toBeUndefined();
    const result = parsePostNLTrackingResponse({
      data: {
        items: [{
          item: POSTNL_WRONG_NUMBER,
          events: [{ category: 'Handed to partner', datetime_local: '2026-08-30T12:00:00Z' }],
        }],
      },
    }, POSTNL_WRONG_NUMBER);
    expect(result.status).toBe('unknown');
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

  it.each([
    ['CH', 'CH'], [' fi ', 'FI'], ['Switzerland', undefined], [123, undefined], [null, undefined],
  ])('projects only a structured destination code: %s', (destination_code, expected) => {
    const result = parsePostNLTrackingResponse({ data: { items: [{
      item: 'LX123456785NL', destination_code,
      events: [{ category: 'Processing', country_code: 'NL' }],
    }] } }, 'LX123456785NL');
    expect(result.destination_country).toBe(expected);
    expect(result.delivery_carrier).toBeUndefined();
    expect(result.status).toBe('in_transit');
  });

  it('never treats a transit scan country as the shipment destination', () => {
    const result = parsePostNLTrackingResponse({ data: { items: [{ item: 'LX123456785NL',
      events: [{ category: 'Arrived', country_code: 'CH', country_name: 'Switzerland' }],
    }] } }, 'LX123456785NL');
    expect(result.destination_country).toBeUndefined();
  });

  it('keeps the journey, the country of each scan and the webshop name', () => {
    expect(delivered).toMatchObject({
      status: 'delivered',
      current_stage: 'delivered',
      last_status_text: 'Shipment delivered',
      last_update: '2026-09-03T10:12:00+02:00',
      // PostNL's international tracker publishes no estimate.
      expected_delivery: null,
      sender_name: 'Example Webshop',
      delivered_at: '2026-09-03T10:12:00+02:00',
    });
    expect(delivered.events?.map((event) => [event.stage, event.location])).toEqual([
      ['delivered', 'Netherlands'],
      ['out_for_delivery', 'Netherlands'],
      ['customs', 'Netherlands'],
      ['registered', 'CN'],
    ]);
  });

  it('reads each scan in its own country\'s zone, not as the UTC PostNL labels it', () => {
    expect(delivered.events?.map((event) => event.time)).toEqual([
      '2026-09-03T10:12:00+02:00', '2026-09-03T06:40:00+02:00', '2026-09-01T19:05:00+02:00', '2026-08-28T11:00:00+08:00',
    ]);
    const multiZone = parsePostNLTrackingResponse({ data: { items: [{ item: 'LX123456785NL',
      events: [{ category: 'Processing', datetime_local: '2026-09-02T08:00:00Z', country_code: 'US' }],
    }] } }, 'LX123456785NL');
    // A country with several zones cannot be resolved; the provider's text is kept.
    expect(multiZone.events?.[0]).toMatchObject({ local_time: '2026-09-02T08:00:00' });
    expect(multiZone.events?.[0]).not.toHaveProperty('time');
    expect(multiZone.last_update).toBeNull();
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

describe('PostNL ambiguity and clock safety', () => {
  const number = 'LX123456785NL';
  const payload = (events: Record<string, unknown>[]) => ({ data: { items: [{ item: number, events }] } });

  it.each([
    ['Processing', 'The item is out for delivery', 'out_for_delivery'],
    ['Processing', 'The item is at the local sorting centre', 'accepted'],
    ['Processing', 'The item will be out for delivery', 'accepted'],
    ['Processing', 'Not out for delivery', 'accepted'],
    ['Future category', 'The item is out for delivery', undefined],
  ])('refines only the observed category and exact label: %s / %s', (category, description, stage) => {
    const result = parsePostNLTrackingResponse(payload([{ category, status_description: description }]), number);
    expect(result.events?.[0]?.stage).toBe(stage);
    expect(result.current_stage).toBe(stage);
  });

  it('refuses duplicate matching identities and an echo with empty history', () => {
    const value = payload([{ category: 'Processing' }]);
    value.data.items.push(value.data.items[0]!);
    expect(() => parsePostNLTrackingResponse(value, number)).toThrow('ambiguous shipment');
    expect(() => parsePostNLTrackingResponse(payload([]), number)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    const unrelated = payload([{ category: 'Processing' }]);
    unrelated.data.items.unshift({ item: 'LX000000005NL', events: [{ category: 'Delivered' }] });
    expect(parsePostNLTrackingResponse(unrelated, number).status).toBe('in_transit');
  });

  it.each([
    ['US', '2026-09-02T08:00:00Z', '2026-09-02T08:00:00'],
    ['ES', '2026-09-02T08:00:00Z', '2026-09-02T08:00:00'],
    ['PT', '2026-09-02T08:00:00Z', '2026-09-02T08:00:00'],
    ['NL', '2026-03-29T02:30:00Z', '2026-03-29T02:30:00'],
    ['NL', '2026-10-25T02:30:00Z', '2026-10-25T02:30:00'],
  ])('retains unresolved local digits for %s / %s without a delivery instant', (country_code, datetime_local, local_time) => {
    const result = parsePostNLTrackingResponse(payload([
      { category: 'Delivered', country_code, datetime_local },
      { category: 'Delivered', country_code: 'NL', datetime_local: '2026-09-01T10:00:00Z' },
    ]), number);
    expect(result.events?.[0]).toMatchObject({ local_time, stage: 'delivered' });
    expect(result.events?.[0]).not.toHaveProperty('time');
    expect(result.events?.[1]?.time).toBe('2026-09-01T10:00:00+02:00');
    expect(result.last_update).toBeNull();
    expect(result.last_update_local).toBe(local_time);
    expect(result.delivered_at).toBeUndefined();
  });

  it('reads PostNL\'s own records on Amsterdam time and precise customs stamps as UTC', () => {
    // Newest first, as PostNL lists them: only these readings keep that order.
    const result = parsePostNLTrackingResponse(payload([
      { category: 'Transit', country_code: 'NL', datetime_local: '2026-03-11T19:29:53.2942876Z', status_description: 'Item is nested to commercial bag' },
      { category: 'Transit', country_code: 'NL', datetime_local: '2026-03-11T19:49:00Z', status_description: 'Consignment received at the PostNL Acceptance Centre' },
      { category: 'Transit', country_code: 'NL', datetime_local: '2026-03-05T11:14:24.1629877Z', status_description: 'Pre-declaration of the item has been received by customs' },
      { category: 'Preparing', country_code: null, datetime_local: '2026-03-05T12:01:00Z', status_description: 'The item is ready for shipment' },
      { category: 'Pre-advised', country_code: null, datetime_local: '2026-03-05T10:01:00Z', status_description: 'The item is pre-advised to PostNL' },
    ]), number);
    expect(result.events?.map((event) => event.time)).toEqual([
      '2026-03-11T19:29:53.294Z', '2026-03-11T19:49:00+01:00', '2026-03-05T11:14:24.162Z',
      '2026-03-05T12:01:00+01:00', '2026-03-05T10:01:00+01:00',
    ]);
    // Summer time, with nothing dated around it.
    const summer = parsePostNLTrackingResponse(payload([
      { category: 'Pre-advised', country_code: '', country_name: null, datetime_local: '2026-09-14T15:20:00Z' },
    ]), number);
    expect(summer).toMatchObject({ last_update: '2026-09-14T15:20:00+02:00', current_stage: 'registered' });
  });

  it.each([
    ['one of its dated neighbours', '2026-03-05T12:30:00Z', new Date('2026-03-12T00:00:00Z')],
    ['the lookup, beyond an hour of clock skew', '2026-03-05T12:01:00Z', new Date('2026-03-05T09:59:00Z')],
  ])('keeps a record local when its Amsterdam reading contradicts %s', (_label, datetime_local, readAt) => {
    const result = parsePostNLTrackingResponse(payload([
      { category: 'Transit', country_code: 'NL', datetime_local: '2026-03-05T11:14:24.1629877Z' },
      { category: 'Preparing', country_code: null, datetime_local },
    ]), number, readAt);
    expect(result.events?.[1]).toMatchObject({ local_time: datetime_local.slice(0, 19) });
    expect(result.events?.[1]).not.toHaveProperty('time');
  });

  it('keeps malformed current clock text separate from older dated scans', () => {
    const result = parsePostNLTrackingResponse(payload([
      { category: 'Delivered', country_code: 'NL', datetime_local: '2026-02-30T12:00:00Z' },
      { category: 'Processing', country_code: 'NL', datetime_local: '2026-02-28T12:00:00Z' },
    ]), number);
    expect(result.events?.[0]).toMatchObject({ provider_time_text: '2026-02-30T12:00:00Z' });
    expect(result.last_update).toBeNull();
    expect(result.delivered_at).toBeUndefined();
  });

  it.each(['+02:00', '-05:00', '+0130'])('preserves an unexpected nonzero offset %s without reinterpreting its clock', offset => {
    const datetime_local = `2026-09-02T08:00:00${offset}`;
    const result = parsePostNLTrackingResponse(payload([
      { category: 'Delivered', country_code: 'NL', datetime_local },
      { category: 'Processing', country_code: 'NL', datetime_local: '2026-09-01T10:00:00Z' },
    ]), number);
    expect(result.events?.[0]).toMatchObject({ provider_time_text: datetime_local, stage: 'delivered' });
    expect(result.events?.[0]).not.toHaveProperty('time');
    expect(result.events?.[0]).not.toHaveProperty('local_time');
    expect(result.events?.[1]?.time).toBe('2026-09-01T10:00:00+02:00');
    expect(result.last_update).toBeNull();
    expect(result.last_update_local).toBeUndefined();
    expect(result.delivered_at).toBeUndefined();
  });

  it('does not manufacture midnight from a calendar day', () => {
    const result = parsePostNLTrackingResponse(payload([{ category: 'Processing', country_code: 'NL', datetime_local: '2026-09-02' }]), number);
    expect(result.events?.[0]).toMatchObject({ provider_time_text: '2026-09-02' });
    expect(result.events?.[0]).not.toHaveProperty('time');
    expect(result.events?.[0]).not.toHaveProperty('local_time');
  });

  it('does not use an inconsistent country label to resolve a multi-zone country code', () => {
    const result = parsePostNLTrackingResponse(payload([{ category: 'Processing', country_code: 'US',
      country_name: 'Netherlands', datetime_local: '2026-09-02T08:00:00Z' }]), number);
    expect(result.events?.[0]).toMatchObject({ local_time: '2026-09-02T08:00:00' });
    expect(result.events?.[0]).not.toHaveProperty('time');
  });

  it('bounds the projected history and refuses excessive input', () => {
    const scans = Array.from({ length: 101 }, () => ({ category: 'Processing' }));
    expect(parsePostNLTrackingResponse(payload(scans), number).events).toHaveLength(100);
    expect(() => parsePostNLTrackingResponse(payload(Array(501).fill(scans[0])), number)).toThrow('excessive');
  });
});

describe('PostNL complete lookup budget', () => {
  it('stops on caller cancellation and on a deadline during authentication', async () => {
    const unused = vi.fn<typeof fetch>();
    await expect(new PostNLTracker({ fetcher: unused }).fetch(POSTNL_WRONG_NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted();
      return jsonResponse({ access_token: 'visitor-token' });
    });
    await expect(new PostNLTracker({ fetcher: slow }).fetch(POSTNL_WRONG_NUMBER, { budgetMs: 20.5 })).rejects.toMatchObject({ kind: 'transport' });
    expect(slow).toHaveBeenCalledOnce();
  });

  it('cancels a rate-limit delay before starting another request', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'retry-after': '6' } }));
    const pending = new PostNLTracker({ fetcher }).fetch(POSTNL_WRONG_NUMBER, { signal: abort.signal });
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    abort.abort();
    await rejected;
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([404, 410])('treats HTTP %s as endpoint failure rather than parcel absence', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status }));
    await expect(new PostNLTracker({ fetcher }).fetch(POSTNL_WRONG_NUMBER)).rejects.toMatchObject({ kind: 'transport' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
