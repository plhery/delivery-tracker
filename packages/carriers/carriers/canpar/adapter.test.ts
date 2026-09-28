import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, CanparTracker } from './adapter';
import { parseCanpar } from './parser';
import { canparStatus } from './status';

const NUMBER = 'C000000000000000000001';
const OTHER = 'C000000000000000000002';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));

describe('Canpar parcel history', () => {
  it('retains native local scans, trims codes and excludes private detail and stale estimates', () => {
    const result = normalizeCarrierResult(parseCanpar(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: null,
      last_update_local: '2026-01-05T10:00:00', expected_delivery: null });
    expect(result.events).toHaveLength(6);
    expect(result.events?.[0]).toMatchObject({ provider_code: 'DEL', stage: 'delivered', location: 'Example City, EX' });
    expect(result.events?.[1]).toMatchObject({ provider_code: 'WC', stage: 'out_for_delivery' });
    expect(result.events?.[3]).toMatchObject({ stage: 'returned' });
    expect(result.events?.at(-1)).toMatchObject({ stage: 'accepted' });
    expect(result).not.toHaveProperty('delivered_at');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|time_shift|signed_by|reference_num|signature|estimated_delivery|web_description/);
    const metadata = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    expect(metadata.capabilities).toEqual(['history', 'location']);
  });

  it('accepts the public client package envelope without retaining pickup address data', () => {
    const value = fixture(); value.result = { packages: value.result, pickup_location: { address: 'PRIVATE' } };
    expect(parseCanpar(value, NUMBER).events).toHaveLength(6);
    expect(JSON.stringify(parseCanpar(value, NUMBER))).not.toContain('PRIVATE');
  });

  it('requires exactly one matching parcel and never merges a shipment or duplicate match', () => {
    const wrong = fixture(); wrong.result[0].barcode = OTHER;
    const duplicate = fixture(); duplicate.result.push(duplicate.result[0]);
    const shipment = fixture(); shipment.result.push({ ...shipment.result[0], barcode: OTHER });
    for (const value of [null, {}, { result: {} }, wrong, duplicate, shipment, { result: Array(26).fill({}) }]) {
      expect(() => parseCanpar(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it('keeps empty identity-shaped placeholders and upstream errors inconclusive', () => {
    const value = fixture(); value.result[0].events = []; value.result[0].shipping_date = null;
    value.result[0].status = 0; value.result[0].delivered = false;
    for (const input of [value, { error: null, result: [] }, { error: 'Unavailable', result: fixture().result }]) {
      expect(() => parseCanpar(input, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    }
  });

  it('uses the newest actual scan over the package summary or a prior completed return', () => {
    const value = fixture(); value.result[0].events.shift();
    expect(parseCanpar(value, NUMBER)).toMatchObject({ status: 'out_for_delivery', current_stage: 'out_for_delivery' });
    value.result[0].events[0].code = 'NEW'; value.result[0].events[0].code_description_en = 'Awaiting review';
    const unknown = parseCanpar(value, NUMBER);
    expect(unknown).toMatchObject({ status: 'unknown', last_status_text: 'Awaiting review' });
    expect(unknown.events?.[0]).not.toHaveProperty('stage');
    expect(canparStatus('toString')).toBeUndefined();
    expect(canparStatus('COA')).toMatchObject({ status: 'in_transit' });
    expect(canparStatus('NL')).toMatchObject({ stage: 'failed_attempt' });
  });

  it.each([3, 6, 7, null, 'unknown'])('does not treat shift %s as an offset', time_shift => {
    const value = fixture(); value.result[0].events[0].time_shift = time_shift;
    expect(parseCanpar(value, NUMBER).events?.[0]).toMatchObject({ local_time: '2026-01-05T10:00:00' });
    expect(parseCanpar(value, NUMBER).events?.[0]).not.toHaveProperty('time');
  });

  it('preserves unresolved or malformed newest clocks without borrowing an older time', () => {
    const value = fixture(); value.result[0].events[0].local_date_time = '20260230 100000';
    expect(parseCanpar(value, NUMBER)).toMatchObject({ last_update: null, last_update_local: null });
    expect(parseCanpar(value, NUMBER).events?.[0]).toMatchObject({ provider_time_text: '20260230 100000' });
    delete value.result[0].events[0].local_date_time;
    expect(parseCanpar(value, NUMBER).events?.[0]).not.toHaveProperty('local_time');
  });

  it.each([123, true, {}, []])('rejects a non-text clock field %j', local_date_time => {
    const value = fixture(); value.result[0].events[0].local_date_time = local_date_time;
    expect(() => parseCanpar(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['20260105 240000', '20260105 126000'])('preserves invalid clock digits %s without rolling to another day', local_date_time => {
    const value = fixture(); value.result[0].events[0].local_date_time = local_date_time;
    const result = parseCanpar(value, NUMBER);
    expect(result.events?.[0]).toMatchObject({ provider_time_text: local_date_time });
    expect(result.events?.[0]).not.toHaveProperty('local_time');
    expect(result.last_update_local).toBeNull();
  });

  it('bounds and validates histories while preserving source order on equal clocks', () => {
    for (const row of [null, {}, { ...fixture().result[0].events[0], code: '' }, { ...fixture().result[0].events[0], code_description_en: '' }]) {
      const value = fixture(); value.result[0].events[0] = row;
      expect(() => parseCanpar(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
    const value = fixture(); value.result[0].events.splice(1, 0, value.result[0].events[0]);
    expect(parseCanpar(value, NUMBER).events).toHaveLength(6);
    for (let i = 0; i < 110; i++) value.result[0].events.push({ ...value.result[0].events[0], code_description_en: `Public scan ${i}` });
    expect(parseCanpar(value, NUMBER).events).toHaveLength(100);
    value.result[0].events = Array(501).fill(value.result[0].events[0]);
    expect(() => parseCanpar(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });
});

describe('Canpar retrieval', () => {
  it('uses one anonymous parcel-only request and recognizes unresolved history', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture()));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });
    await expect(instance.recognize!('123')).resolves.toEqual({ known: false });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(instance.recognize!(NUMBER)).resolves.toEqual({ known: true, lastActivityAt: null });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://canship.canpar.com/api/CanparAddons/trackByBarcodeV2');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
    expect(JSON.parse(String(init?.body))).toEqual({ barcode: NUMBER, track_shipment: false });
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    const empty = fixture(); empty.result[0].events = [];
    fetcher.mockResolvedValueOnce(Response.json(empty));
    await expect(instance.recognize!(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
  });

  it.each([[404, 'transport'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])('keeps HTTP %s distinct from absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status: Number(status) }));
    await expect(new CanparTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects invalid inputs before I/O and bounds cancellation, elapsed time and response size', async () => {
    const unused = vi.fn<typeof fetch>();
    for (const number of ['123', `${NUMBER}&barcode=OTHER`, 'W000000000001']) {
      await expect(new CanparTracker({ fetcher: unused }).fetch(number)).rejects.toThrow(TypeError);
    }
    await expect(new CanparTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted(); return new Response('{}');
    });
    await expect(new CanparTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toThrow();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new CanparTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Unavailable</html>'));
    await expect(new CanparTracker({ fetcher: malformed }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });
});
