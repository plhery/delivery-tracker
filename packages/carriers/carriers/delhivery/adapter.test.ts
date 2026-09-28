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
  it('passes the website headers and bounded cancellation into the public read', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload())));
    await new DelhiveryTracker({ fetcher }).fetch(NUMBER, { budgetMs: 1000 });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://dlv-api.delhivery.com/v3/unified-tracking-new?wbn=${NUMBER}`);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Origin: 'https://www.delhivery.com', Referer: 'https://www.delhivery.com/' });
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
