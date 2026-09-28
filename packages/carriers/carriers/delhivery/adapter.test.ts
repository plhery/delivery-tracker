import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { DelhiveryTracker } from './adapter';
import { parseDelhivery } from './parser';

const NUMBER = '0000000000001';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const payload = () => structuredClone(fixture);
describe('Delhivery direct tracking', () => {
  it('uses the current timestamp once and excludes future rails and private fields', () => {
    const result = parseDelhivery(payload(), NUMBER);
    expect(result).toMatchObject({ status: 'delivered', last_update: '2026-01-03T14:00:00+05:30', delivered_at: '2026-01-03T14:00:00+05:30' });
    expect(result.events).toHaveLength(3);
    expect(result.events?.[1]).not.toHaveProperty('time');
    expect(result.events?.[2]?.stage).toBe('in_transit');
    expect(result.events?.[0]).toMatchObject({ summary_snapshot: true });
    expect(JSON.stringify(result)).not.toMatch(/Private|private-reference|Example Address|Out For Delivery/);
    expect(JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')).capabilities).toEqual(['history']);
  });
  it('requires one matching identity and the specific negative outcome', () => {
    for (const value of [null, {}, { statusCode: 200, data: [] }, { ...payload(), data: [payload().data[0], payload().data[0]] }]) {
      expect(() => parseDelhivery(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const value = payload(); value.data[0].awb = '0000000000002';
    expect(() => parseDelhivery(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    expect(() => parseDelhivery({ statusCode: 200, data: [], message: 'invalid AWB or very old package' }, NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'not_found' }));
  });
  it('keeps unknown status and historical scan semantics separate', () => {
    const value = payload(); value.data[0].status = { status: 'New current status', statusDateTime: 'not a date' };
    value.data[0].trackingStates[0].scans[0].scan = 'New scan';
    const result = parseDelhivery(value, NUMBER);
    expect(result.status).toBe('unknown'); expect(result.last_update).toBeNull();
    expect(result.events?.[0]).not.toHaveProperty('stage');
  });
  it('never stamps repeated historical labels with the current snapshot time', () => {
    const value = payload(); value.data[0].status.status = 'In Transit';
    value.data[0].trackingStates = [{ label: 'In Transit', scans: [
      { scan: 'In Transit', cityLocation: 'Earlier hub' }, { scan: 'In Transit', cityLocation: 'Later hub' },
    ] }];
    const result = parseDelhivery(value, NUMBER);
    expect(result.events?.filter(event => event.time)).toEqual([expect.objectContaining({ summary_snapshot: true, description: 'In Transit' })]);
    expect(result.events?.filter(event => event.location).every(event => !event.time)).toBe(true);
  });
  it('keeps calendar days unresolved rather than creating midnight scans or delivery times', () => {
    const value = payload(); value.data[0].status.statusDateTime = '2026-01-03';
    value.data[0].trackingStates[0].scans[0].scanDateTime = '2026-01-03';
    const result = parseDelhivery(value, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', last_update: null });
    expect(result.delivered_at).toBeUndefined();
    expect(result.events?.[0]).toMatchObject({ summary_snapshot: true, provider_time_text: '2026-01-03' });
    expect(result.events?.[1]).toMatchObject({ location: 'Example City', provider_time_text: '2026-01-03' });
    expect(result.events?.every(event => !event.time)).toBe(true);
  });
  it('deduplicates a current scan by its instant across equivalent timezone representations', () => {
    const value = payload();
    value.data[0].trackingStates[0].scans[0].scanDateTime = '2026-01-03T08:30:00Z';
    const result = parseDelhivery(value, NUMBER);
    expect(result.events).toHaveLength(2);
    expect(result.events?.[0]).toMatchObject({ description: 'Delivered', time: '2026-01-03T08:30:00Z', location: 'Example City' });
    expect(result.events?.some(event => event.summary_snapshot)).toBe(false);
  });
  it('keeps an undated current summary separate from repeated historical labels', () => {
    const value = payload();
    value.data[0].status.statusDateTime = '';
    value.data[0].trackingStates[0].scans = [
      { scan: 'Delivered', cityLocation: 'Earlier delivery office', scanDateTime: '' },
      { scan: 'Delivered', cityLocation: 'Later delivery office', scanDateTime: '' },
    ];
    const result = parseDelhivery(value, NUMBER);
    expect(result.last_update).toBeNull(); expect(result.delivered_at).toBeUndefined();
    expect(result.events?.[0]).toMatchObject({ description: 'DELIVERED', summary_snapshot: true });
    expect(result.events?.[0].location).toBeUndefined();
    expect(result.events?.filter(event => event.location)).toHaveLength(3);
    expect(result.events?.every(event => !event.time)).toBe(true);
  });
  it('keeps current return delivery distinct from recipient delivery history', () => {
    const value = payload(); value.data[0].status.status = 'RTO DELIVERED';
    const result = parseDelhivery(value, NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned' });
    expect(result.events?.[0]).toMatchObject({ stage: 'returned', summary_snapshot: true });
    expect(result.events?.[1].stage).toBe('delivered');
    expect(result.delivered_at).toBeUndefined();
  });
  it('distinguishes future rail states from malformed completed history', () => {
    for (const state of [null, { scans: {} }, { scans: [null] }, { scans: [{}] }]) {
      const value = payload(); value.data[0].trackingStates = [state];
      expect(() => parseDelhivery(value, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    }
    const value = payload(); value.data[0].trackingStates = [{ label: 'Out For Delivery' }];
    const result = parseDelhivery(value, NUMBER);
    expect(result.events).toHaveLength(1);
    expect(result.events?.[0]).toMatchObject({ description: 'DELIVERED', summary_snapshot: true });
  });
  it('passes the website headers and bounded cancellation into the public read', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload())));
    await new DelhiveryTracker({ fetcher }).fetch(NUMBER, { budgetMs: 1000 });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://dlv-api.delhivery.com/v3/unified-tracking-new?wbn=${NUMBER}`);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Origin: 'https://www.delhivery.com', Referer: 'https://www.delhivery.com/' });
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
