import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { PostnordTracker } from './adapter';
import { normalizePostnordNumber, parsePostnord } from './parser';
import { classifyPostnordStatus } from './status';

const NUMBER = '00573000000000000001';
const OTHER_NUMBER = '00573000000000000002';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const payload = () => structuredClone(fixture);

describe('PostNord direct tracking', () => {
  it('uses item summary status and excludes confirmed administrative notices from shipment history', () => {
    const result = parsePostnord(payload(), NUMBER);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: '2026-01-04T12:00:00Z',
      delivered_at: '2026-01-04T12:00:00Z', expected_delivery: null, weight_kg: 1.5, dimensions_text: '40 × 30 × 20 cm' });
    expect(result.events?.map((event) => event.stage)).toEqual(['delivered', 'ready_for_pickup', 'out_for_delivery', 'in_transit', 'registered']);
    expect(JSON.stringify(result.events)).not.toContain('text message');
    const declared = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    expect(declared.capabilities).toEqual(['history', 'weight', 'dimensions']);
  });

  it('rejects missing, mismatched, ambiguous and group identities', () => {
    const wrongShipment = payload(); wrongShipment.shipmentId = OTHER_NUMBER;
    const wrongSelected = payload(); wrongSelected.actualReturnedId = OTHER_NUMBER;
    const wrongItem = payload(); wrongItem.items[0].itemId = OTHER_NUMBER;
    const duplicate = payload(); duplicate.items.push(duplicate.items[0]);
    const group = payload(); group.items[0].itemId = OTHER_NUMBER; group.actualReturnedId = OTHER_NUMBER;
    for (const value of [null, {}, { ...payload(), items: [] }, { ...payload(), items: [null] }, wrongShipment, wrongSelected, wrongItem, duplicate, group]) {
      expect(() => parsePostnord(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    // An unrelated item never determines the requested item's summary or history.
    const multiple = payload(); multiple.items.unshift({ ...payload().items[0], itemId: OTHER_NUMBER, status: { code: 'RETURNED' }, events: [] });
    expect(parsePostnord(multiple, NUMBER)).toMatchObject({ status: 'delivered', events: expect.any(Array) });
  });

  it('sorts scans by instant while preserving offsets and distinct tied scans', () => {
    const value = payload();
    value.items[0].events[3].eventTime = '2026-01-04T13:01:00+02:00';
    const result = parsePostnord(value, NUMBER);
    expect(result.last_update).toBe('2026-01-04T12:00:00Z');
    expect(result.events?.[1]?.time).toBe('2026-01-04T13:01:00+02:00');
    value.items[0].events.push({ ...value.items[0].events[1], status: 'OTHER', eventDescription: 'The shipment item has been loaded.', eventTime: '2026-01-04T12:00:00Z' });
    value.items[0].events.push(structuredClone(value.items[0].events[4]));
    expect(parsePostnord(value, NUMBER).events).toHaveLength(6);
    expect(parsePostnord(value, NUMBER).events?.slice(0, 2).map((event) => event.provider_code)).toEqual(['DELIVERED', 'OTHER']);
  });

  it('removes only confirmed administrative OTHER rows after validation and treats notice-only replies as inconclusive', () => {
    const value = payload();
    value.items[0].events = [
      'Suggested delivery time.',
      'Information to the driver added by the recipient.',
      'A text message notification has been delivered to the recipient.',
      'Notification sent via APP.',
    ].map((eventDescription) => ({ ...payload().items[0].events[5], eventDescription }));
    expect(() => parsePostnord(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    value.items[0].events[0].eventTime = 'invalid';
    expect(() => parsePostnord(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    value.items[0].events = [{ ...payload().items[0].events[5], eventDescription: 'Unfamiliar provider wording' }];
    expect(parsePostnord(value, NUMBER).events).toEqual([expect.objectContaining({ description: 'Unfamiliar provider wording', provider_code: 'OTHER' })]);
    expect(parsePostnord(value, NUMBER).events?.[0]).not.toHaveProperty('stage');
  });

  it('rejects incomplete scans, invalid dates and unknown-offset clocks', () => {
    for (const scan of [null, {}, { ...payload().items[0].events[5], eventDescription: '' },
      { ...payload().items[0].events[5], status: null },
      ...['2026-01-04T12:01:00', '2026-02-30T12:01:00Z', '2026-01-04', '2026-01-04T12:01:00+99:00', ''].map((eventTime) => ({ ...payload().items[0].events[5], eventTime }))]) {
      const value = payload(); value.items[0].events.push(scan);
      expect(() => parsePostnord(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const empty = payload(); empty.items[0].events = [];
    expect(() => parsePostnord(empty, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    const noSummary = payload(); delete noSummary.items[0].status;
    expect(() => parsePostnord(noSummary, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    const tooMany = payload(); tooMany.items[0].events = Array.from({ length: 501 }, () => payload().items[0].events[0]);
    expect(() => parsePostnord(tooMany, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
  });

  it.each([
    ['AVAILABLE_FOR_DELIVERY', 'The shipment item has been delivered to a service point.', 'in_transit', 'ready_for_pickup'],
    ['DELIVERY_IMPOSSIBLE', 'Delivery was not possible.', 'exception', 'failed_attempt'],
    ['RETURNED', 'Returned', 'exception', 'returned'],
    ['CUSTOMS_STOPPED_VAT', 'Stopped', 'exception', 'customs'],
    ['EN_ROUTE', 'The delivery of the shipment item is in progress.', 'out_for_delivery', 'out_for_delivery'],
    ['OTHER', 'The shipment item has been loaded.', 'in_transit', 'in_transit'],
  ])('maps %s independently from final-delivery wording', (code, description, status, stage) => {
    expect(classifyPostnordStatus(code, description)).toEqual({ status, stage });
    const value = payload(); value.items[0].status = { code, header: description };
    const result = normalizeCarrierResult(parsePostnord(value, NUMBER));
    expect(result).toMatchObject({ status, current_stage: stage });
    expect(result).not.toHaveProperty('delivered_at');
  });

  it.each([
    ['OTHER', 'A text message notification has been delivered to the recipient.'],
    ['OTHER', 'Notification sent via APP.'],
    ['OTHER', 'Suggested delivery time.'],
    ['OTHER', 'Information to the driver added by the recipient.'],
    ['DELIVERY_TODAY', 'delivery today'],
    ['ESTIMATED_DELIVERY_DAYS', 'Estimated delivery'],
    ['NEW_CODE', 'Delivered'],
  ])('leaves administrative or unproven code %s unmapped', (code, description) => {
    expect(classifyPostnordStatus(code, description)).toBeUndefined();
    const value = payload(); value.items[0].status = { code, header: description };
    const result = parsePostnord(value, NUMBER);
    expect(result.status).toBe('unknown');
    expect(result).not.toHaveProperty('current_stage');
    expect(result).not.toHaveProperty('delivered_at');
    expect(result.last_status_text).toBe(description);
  });

  it('excludes private fields, bounds history and keeps only unambiguous supported measurements', () => {
    const value = payload(); value.items[0].events[0].eventDescription = 'x'.repeat(600);
    expect(JSON.stringify(parsePostnord(value, NUMBER))).not.toMatch(/Private|Address|99999|references|receiver|sender|deliveryInformation/);
    expect(parsePostnord(value, NUMBER).events?.at(-1)?.description).toHaveLength(500);
    value.items[0].measurements[3] = { name: 'weight', unit: 'kg', value: 2.5 };
    expect(parsePostnord(value, NUMBER).weight_kg).toBe(2.5);
    for (const measurement of [{ name: 'weight', unit: 'g', value: 0 }, { name: 'weight', unit: 'lb', value: 1 }, { name: 'weight', unit: 'kg', value: -1 }]) {
      value.items[0].measurements[3] = measurement;
      expect(parsePostnord(value, NUMBER)).not.toHaveProperty('weight_kg');
    }
    value.items[0].measurements[0].unit = 'mm';
    expect(parsePostnord(value, NUMBER)).not.toHaveProperty('dimensions_text');
    value.items[0].measurements.push({ name: 'weight', unit: 'kg', value: 1 }, { name: 'weight', unit: 'g', value: 1000 });
    expect(parsePostnord(value, NUMBER)).not.toHaveProperty('weight_kg');
    value.items[0].events = Array.from({ length: 101 }, (_, index) => ({ ...payload().items[0].events[0], eventTime: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() }));
    expect(parsePostnord(value, NUMBER).events).toHaveLength(100);
  });

  it('sends the complete official anonymous request and a valid fresh proof bound to its number', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('Origin')).toBe('https://tracking.postnord.com');
      expect(headers.get('x-bap-key')).toBe('web-tracking-sc');
      const decoded = Buffer.from(headers.get('X-CustomHeader')!, 'base64');
      expect(decoded.subarray(64, 66).toString()).toBe('--');
      const nonce = decoded.subarray(66).toString();
      expect(nonce).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
      const digest = createHash('sha512').update(NUMBER + nonce).digest();
      expect(decoded.subarray(0, 64)).toEqual(digest);
      expect(digest[0]).toBe(0);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify(payload()));
    });
    const tracker = new PostnordTracker({ fetcher });
    await tracker.fetch(NUMBER);
    await tracker.fetch(NUMBER);
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe('https://api2.postnord.com/rest/shipment/v1/trackingweb/shipmentInformation');
    expect(Object.fromEntries(url.searchParams)).toEqual({ shipmentId: NUMBER, locale: 'en', timeZone: 'UTC' });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('X-CustomHeader')).not.toBe(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('X-CustomHeader'));
    expect(normalizePostnordNumber('00573 000000000000001')).toBe(NUMBER);
    expect(normalizePostnordNumber('rr 000000005 se')).toBe('RR000000005SE');
    for (const invalid of ['123', 'RR000000006SE', `${NUMBER}?id=other`]) expect(() => normalizePostnordNumber(invalid)).toThrow(TypeError);
  });

  it('requires the observed negative schema and keeps challenges, throttling and outages distinct', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const tracker = new PostnordTracker({ fetcher });
    for (const [status, body, kind] of [
      [404, JSON.stringify({ message: 'Shipment was not found.' }), 'not_found'],
      [404, '<h1>Not Found</h1>', 'indeterminate'],
      [404, '{}', 'indeterminate'],
      [410, JSON.stringify({ message: 'Shipment was not found.' }), 'indeterminate'],
      [403, 'Forbidden', 'challenge'],
      [503, 'Unavailable', 'maintenance'],
    ] as const) {
      fetcher.mockResolvedValue(new Response(body, { status }));
      await expect(tracker.fetch(NUMBER)).rejects.toMatchObject({ kind });
    }
    fetcher.mockResolvedValue(new Response('Too many requests', { status: 429, headers: { 'Retry-After': '600' } }));
    await expect(tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 600_000 });
    fetcher.mockResolvedValue(new Response('{}'));
    await expect(tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
    fetcher.mockResolvedValue(new Response('<h1>Unexpected service page</h1>'));
    await expect(tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });

  it('honors cancellation before proof generation and during the fetch, and exhausted budgets make no request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const tracker = new PostnordTracker({ fetcher });
    const cancelled = new AbortController(); cancelled.abort();
    await expect(tracker.fetch(NUMBER, { signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(tracker.fetch(NUMBER, { budgetMs: 0 })).rejects.toMatchObject({ kind: 'budget' });
    expect(fetcher).not.toHaveBeenCalled();
    const controller = new AbortController();
    fetcher.mockImplementation(async (_url, init) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw init?.signal?.reason;
    });
    await expect(tracker.fetch(NUMBER, { signal: controller.signal })).rejects.toMatchObject({ kind: 'transport' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
