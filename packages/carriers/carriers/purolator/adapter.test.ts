import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { PurolatorTracker } from './adapter';
import { normalizePurolatorNumber, parsePurolator } from './parser';

const NUMBER = '100000000001';
const OTHER = '100000000002';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const payload = () => structuredClone(fixture);

describe('Purolator direct tracking', () => {
  it('maps each historical code and preserves cross-country clocks without assigning a zone', () => {
    const result = normalizeCarrierResult(parsePurolator(payload(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_status_text: 'Shipment delivered',
      last_update: null, last_update_local: '2026-01-04T14:00:00', expected_delivery: null });
    expect(result.events?.map((event) => event.stage)).toEqual(['delivered', 'ready_for_pickup', 'failed_attempt', 'out_for_delivery', 'in_transit', 'accepted', 'registered']);
    expect(result.events?.[0]).toMatchObject({ local_time: '2026-01-04T14:00:00', location: 'Example City, QC, CA', provider_code: '9500' });
    expect(result.events?.every((event) => !event.time)).toBe(true);
    expect(result).not.toHaveProperty('delivered_at');
    expect(result.weight_kg).toBeCloseTo(0.90718474);
  });

  it('binds the returned search indexes to an exact unique package rather than selecting the first shipment', () => {
    const wrongSearch = payload(); wrongSearch.searchResult[0].trackingId = OTHER;
    const wrongItem = payload(); wrongItem.shipment[0].package[0].pin = OTHER;
    const duplicate = payload(); duplicate.shipment[0].package.push(duplicate.shipment[0].package[0]);
    const missingIndex = payload(); delete missingIndex.searchResult[0].packageIndex;
    const badIndex = payload(); badIndex.searchResult[0].shipmentIndex = 99;
    const refSearch = payload(); refSearch.searchResult[0].type = 'REFERENCE';
    for (const value of [null, {}, wrongSearch, wrongItem, duplicate, missingIndex, badIndex, refSearch]) {
      expect(() => parsePurolator(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const multiple = payload(); multiple.shipment[0].package.unshift({ ...payload().shipment[0].package[0], pin: OTHER, events: [] });
    multiple.shipment[0].pieceTotalCount = 2; multiple.searchResult[0].packageIndex = 1;
    expect(parsePurolator(multiple, NUMBER)).toMatchObject({ status: 'delivered' });
    expect(parsePurolator(multiple, NUMBER)).not.toHaveProperty('weight_kg');
  });

  it('preserves newest-first order across offset and unresolved clocks, never moving old delivery to current', () => {
    const value = payload(); value.shipment[0].package[0].events[1].dateTime = '2026-01-03T16:00:00-05:00';
    const result = parsePurolator(value, NUMBER);
    expect(result.last_update).toBeNull();
    expect(result.last_update_local).toBe('2026-01-04T14:00:00');
    expect(result.events?.[1]?.time).toBe('2026-01-03T16:00:00-05:00');
    value.shipment[0].package[0].events.unshift({ dateTime: '2026-01-05 10:00:00', code: 'NEW', description: 'Unfamiliar provider wording' });
    expect(parsePurolator(value, NUMBER)).toMatchObject({ status: 'unknown', last_status_text: 'Unfamiliar provider wording', last_update_local: '2026-01-05T10:00:00' });
    expect(parsePurolator(value, NUMBER)).not.toHaveProperty('current_stage');
    value.shipment[0].package[0].events[0].dateTime = '2026-02-30 10:00:00';
    expect(parsePurolator(value, NUMBER).events?.[0]).toMatchObject({ provider_time_text: '2026-02-30 10:00:00' });
    expect(parsePurolator(value, NUMBER).events?.[0]).not.toHaveProperty('local_time');
    value.shipment[0].package[0].events[0].dateTime = '2026-01-05T10:00:00+99:00';
    expect(parsePurolator(value, NUMBER).events?.[0]).toMatchObject({ provider_time_text: '2026-01-05T10:00:00+99:00' });
    expect(parsePurolator(value, NUMBER).events?.[0]).not.toHaveProperty('time');
  });

  it('leaves arbitrary prototype property names unmapped', () => {
    for (const code of ['constructor', 'toString', '__proto__']) {
      const value = payload();
      value.shipment[0].package[0].events.unshift({ code, description: 'Unfamiliar provider wording', dateTime: '2026-01-05 10:00:00' });
      const result = normalizeCarrierResult(parsePurolator(value, NUMBER));
      expect(result.status).toBe('unknown');
      expect(result).not.toHaveProperty('current_stage');
      expect(result.events?.[0]).not.toHaveProperty('stage');
    }
  });

  it('does not mistake pickup availability for delivery even when the presentation summary says delivered', () => {
    const value = payload(); value.shipment[0].package[0].events.shift();
    expect(normalizeCarrierResult(parsePurolator(value, NUMBER))).toMatchObject({ status: 'in_transit', current_stage: 'ready_for_pickup' });
    expect(parsePurolator(value, NUMBER)).not.toHaveProperty('delivered_at');
    value.shipment[0].package[0].events[0].dateTime = '2026-01-03T16:00:00-05:00';
    expect(parsePurolator(value, NUMBER).last_update).toBe('2026-01-03T16:00:00-05:00');
    const delivered = payload(); delivered.shipment[0].package[0].events[0].dateTime = '2026-01-04T14:00:00-05:00';
    expect(parsePurolator(delivered, NUMBER).delivered_at).toBe('2026-01-04T14:00:00-05:00');
  });

  it('rejects incomplete and empty histories, excessive rows and ambiguous unknown replies', () => {
    for (const scan of [null, {}, { code: '3010' }]) {
      const value = payload(); value.shipment[0].package[0].events.unshift(scan);
      expect(() => parsePurolator(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const empty = payload(); empty.shipment[0].package[0].events = [];
    expect(() => parsePurolator(empty, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    const excessive = payload(); excessive.shipment[0].package[0].events = Array.from({ length: 501 }, () => payload().shipment[0].package[0].events[0]);
    expect(() => parsePurolator(excessive, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    const conflict = { searchResult: [{ sequenceId: 1, trackingId: NUMBER, status: 'CONFLICT', shipmentIndex: -1,
      errors: [{ code: '2003', description: 'The search criteria provided results in more than one PIN returned.  Please refine the search criteria.' }] }], shipment: [] };
    expect(() => parsePurolator(conflict, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('deduplicates scans, bounds text and excludes recipient, reference and proof data', () => {
    const value = payload(); value.shipment[0].package[0].events.push(structuredClone(value.shipment[0].package[0].events[0]));
    expect(parsePurolator(value, NUMBER).events).toHaveLength(7);
    expect(JSON.stringify(parsePurolator(value, NUMBER))).not.toMatch(/Private|Z0Z0Z0|private-proof|receiverName|deliveryDetails|estimatedDeliveryDate/);
    value.shipment[0].details.weight = { unit: 'KG', value: 2.5 };
    expect(parsePurolator(value, NUMBER).weight_kg).toBe(2.5);
    for (const weight of [{ unit: 'KG', value: 0 }, { unit: 'LB', value: -1 }, { unit: 'OZ', value: 1 }]) {
      value.shipment[0].details.weight = weight;
      expect(parsePurolator(value, NUMBER)).not.toHaveProperty('weight_kg');
    }
    value.shipment[0].package[0].events[0].description = 'x'.repeat(600);
    expect(parsePurolator(value, NUMBER).events?.[0]?.description).toHaveLength(500);
  });

  it('uses the actual anonymous POST and no account, session bootstrap or retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload())));
    await new PurolatorTracker({ fetcher }).fetch(NUMBER);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://public-tracking.purolator.com/tracking/data');
    expect(request?.method).toBe('POST');
    expect(JSON.parse(String(request?.body))).toEqual({ search: [{ trackingId: NUMBER, sequenceId: 1, eventSortOrder: 'd' }], language: 'en' });
    const headers = new Headers(request?.headers);
    expect(headers.get('User-Agent')).toMatch(/Mozilla\/5.0.*Chrome\/\d+/);
    expect(headers.get('x-api-key')).toBeTruthy();
    expect(headers.has('Authorization')).toBe(false);
    expect(headers.has('Cookie')).toBe(false);
    expect(normalizePurolatorNumber('100 000 000.001')).toBe(NUMBER);
    for (const invalid of ['123', 'BYS000000000', `${NUMBER}?tracking=other`]) expect(() => normalizePurolatorNumber(invalid)).toThrow(TypeError);
  });

  it('classifies explicit AWS challenge replies, generic missing resources, malformed JSON, throttling and outages separately', async () => {
    const fetcher = vi.fn<typeof fetch>(); const tracker = new PurolatorTracker({ fetcher });
    for (const [status, action, body, kind] of [
      [405, 'captcha', '<html>AWS challenge</html>', 'challenge'],
      [202, 'challenge', '', 'challenge'],
      [405, '', '', 'indeterminate'],
      [404, '', '<h1>Not found</h1>', 'indeterminate'],
      [410, '', '', 'indeterminate'],
      [403, '', 'Forbidden', 'challenge'],
      [503, '', 'Unavailable', 'maintenance'],
      [200, '', '<h1>Unexpected service page</h1>', 'schema'],
    ] as const) {
      fetcher.mockResolvedValue(new Response(body, { status, headers: { 'x-amzn-waf-action': action } }));
      await expect(tracker.fetch(NUMBER)).rejects.toMatchObject({ kind });
    }
    fetcher.mockResolvedValue(new Response('Too many requests', { status: 429, headers: { 'Retry-After': '600' } }));
    await expect(tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 600_000 });
  });

  it('stops on cancellation before and during the request and respects exhausted budgets', async () => {
    const fetcher = vi.fn<typeof fetch>(); const tracker = new PurolatorTracker({ fetcher });
    const cancelled = new AbortController(); cancelled.abort();
    await expect(tracker.fetch(NUMBER, { signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(tracker.fetch(NUMBER, { budgetMs: 0 })).rejects.toMatchObject({ kind: 'budget' });
    expect(fetcher).not.toHaveBeenCalled();
    const controller = new AbortController();
    fetcher.mockImplementation(async (_url, request) => { controller.abort(); expect(request?.signal?.aborted).toBe(true); throw request?.signal?.reason; });
    await expect(tracker.fetch(NUMBER, { signal: controller.signal })).rejects.toMatchObject({ kind: 'transport' });
  });
});
