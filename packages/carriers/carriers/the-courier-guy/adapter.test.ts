import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { CourierGuyTracker } from './adapter';
import { normalizeCourierGuyNumber, parseCourierGuy } from './parser';
import { courierGuyStatus } from './status';

const NUMBER = 'TESTA1';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const payload = () => structuredClone(fixture);

describe('The Courier Guy shipment projection', () => {
  it('keeps aggregate history, explicit scan instants and pickup readiness without private messages', () => {
    const result = normalizeCarrierResult(parseCourierGuy(payload(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: '2026-01-06T12:00:00.123Z',
      delivered_at: '2026-01-06T12:00:00.123Z', expected_delivery: null });
    expect(result.events?.map(event => event.stage)).toEqual(['delivered', 'out_for_delivery', 'ready_for_pickup', 'accepted', 'registered']);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|recipient|shipment_time|estimated_delivery|message/);
    const declared = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    const evidence: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.[0]?.location), delivered_at: Boolean(result.delivered_at) };
    for (const capability of declared.capabilities) expect(evidence[capability], capability).toBe(true);
  });

  it('rejects wrong carriers, aliases, piece references and duplicated shipment matches', () => {
    for (const changes of [{ provider_id: 8 }, { short_tracking_reference: 'TESTA2' }, { short_tracking_reference: 'TESTA1 ' }]) {
      const value = payload(); Object.assign(value.shipments[0], changes);
      expect(() => parseCourierGuy(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    expect(() => parseCourierGuy(payload(), 'TCG0000000001')).toThrowError(expect.objectContaining({ kind: 'schema' }));
    const duplicates = payload(); duplicates.shipments.push(duplicates.shipments[0]);
    expect(() => parseCourierGuy(duplicates, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('never promotes one delivered piece or an internal operation to shipment completion', () => {
    const value = payload(); const shipment = value.shipments[0];
    shipment.status = 'in-transit';
    shipment.tracking_events[0].status = 'in-transit';
    shipment.tracking_events.unshift({ parcel_id: 1, status: 'delivered', date: '2026-01-07T12:00:00Z', location: 'Example Hub' });
    shipment.tracking_events.unshift({ parcel_id: 0, status: 'operational-event', date: '2026-01-08T12:00:00Z', location: '' });
    expect(parseCourierGuy(value, NUMBER)).toMatchObject({ status: 'in_transit', last_update: '2026-01-06T12:00:00.123Z' });
    shipment.status = 'operational-event';
    expect(parseCourierGuy(value, NUMBER).status).toBe('in_transit');
    shipment.tracking_events = [{ parcel_id: 1, status: 'delivered', date: '2026-01-07T12:00:00Z', location: '' }];
    expect(() => parseCourierGuy(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('requires a complete piece list and the latest public scan to match the summary', () => {
    for (const changes of [{ parcel_count: 1 }, { parcel_count: 0 }, { parcel_count: '2' },
      { parcel_tracking_references: ['TCG0000000001', 'TCG0000000001'] }, { parcel_tracking_references: [null, null] }]) {
      const value = payload(); Object.assign(value.shipments[0], changes);
      expect(() => parseCourierGuy(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const value = payload(); value.shipments[0].status = 'at-hub';
    expect(() => parseCourierGuy(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    for (const value of [{ shipments: [] }, { shipments: [{ ...payload().shipments[0], tracking_events: [] }] }]) {
      expect(() => parseCourierGuy(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
  });

  it('rejects an old terminal scan before newer movement and ambiguous hidden summaries', () => {
    for (const summary of ['delivered', 'operational-event']) {
      const value = payload(); value.shipments[0].status = summary;
      value.shipments[0].tracking_events[1].status = 'in-transit';
      value.shipments[0].tracking_events[1].date = '2026-01-07T12:00:00Z';
      expect(() => parseCourierGuy(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
    for (const date of ['2026-01-06T12:00:00.123Z', '2026-01-06T14:00:00.123+02:00', '', '2026-01-06T11:00:00']) {
      const value = payload(); value.shipments[0].status = 'operational-event';
      value.shipments[0].tracking_events[1].date = date;
      expect(() => parseCourierGuy(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const value = payload(); value.shipments[0].status = 'operational-event';
    expect(parseCourierGuy(value, NUMBER)).toMatchObject({ status: 'delivered', last_update: '2026-01-06T12:00:00.123Z' });
  });

  it.each(['2026-02-30T12:00:00Z', '2026-01-06T24:00:00Z', '2026-01-06T12:00:00+02:99',
    '2026-01-06T12:00:00+15:00', '12:00', '', null])('preserves an unresolved newest clock %s', clock => {
    const value = payload(); value.shipments[0].tracking_events[0].date = clock;
    const result = parseCourierGuy(value, NUMBER);
    expect(result.status).toBe('delivered'); expect(result.last_update).toBeNull();
    expect(result).not.toHaveProperty('delivered_at'); expect(result.events?.[0]).not.toHaveProperty('time');
    if (clock) expect(result.events?.[0]).toMatchObject({ provider_time_text: clock });
  });

  it('retains offsetless clocks, unknown codes and provider order without borrowing modified dates', () => {
    const value = payload(); value.shipments[0].tracking_events[0].date = '2026-01-06T12:00:00';
    expect(parseCourierGuy(value, NUMBER)).toMatchObject({ last_update: null, last_update_local: '2026-01-06T12:00:00.000' });
    value.shipments[0].status = value.shipments[0].tracking_events[0].status = 'new-provider-status';
    expect(parseCourierGuy(value, NUMBER)).toMatchObject({ status: 'unknown' });
    expect(parseCourierGuy(value, NUMBER)).not.toHaveProperty('current_stage');
    expect(courierGuyStatus('constructor')).toBeUndefined();
    expect(courierGuyStatus('returned-to-hub')?.stage).toBe('in_transit');
    expect(courierGuyStatus('delivery-scheduled')?.status).toBe('in_transit');
    expect(courierGuyStatus('delivery-failed-attempt')?.status).toBe('exception');
  });

  it('deduplicates exact projected scans and bounds the timeline', () => {
    const value = payload(); value.shipments[0].tracking_events.unshift({ ...value.shipments[0].tracking_events[0], id: 6, message: 'PRIVATE other' });
    expect(parseCourierGuy(value, NUMBER).events).toHaveLength(5);
    value.shipments[0].status = 'in-transit';
    value.shipments[0].tracking_events = Array.from({ length: 101 }, (_, i) => ({ parcel_id: 0, status: 'in-transit', date: '', location: `Example hub ${i}` }));
    expect(parseCourierGuy(value, NUMBER).events).toHaveLength(100);
    value.shipments[0].tracking_events = Array(501).fill(value.shipments[0].tracking_events[0]);
    expect(() => parseCourierGuy(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    for (const row of [null, {}, { parcel_id: 0, status: 'delivered', date: 123 }]) {
      const invalid = payload(); invalid.shipments[0].tracking_events[0] = row;
      expect(() => parseCourierGuy(invalid, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
  });

  it.each([
    ['collected-from-locker', 'delivered', 'delivered'], ['collected-from-counter', 'delivered', 'delivered'],
    ['returned-to-sender', 'exception', 'returned'], ['undeliverable', 'exception', 'exception'],
    ['delivery-scheduled', 'in_transit', 'in_transit'], ['in-locker', 'in_transit', 'ready_for_pickup'],
  ])('classifies the explicit public milestone %s', (code, status, stage) => {
    const value = payload(); value.shipments[0].status = value.shipments[0].tracking_events[0].status = code;
    const result = parseCourierGuy(value, NUMBER);
    expect(result).toMatchObject({ status, current_stage: stage });
    if (status === 'delivered') expect(result.delivered_at).toBe(result.last_update);
    else expect(result).not.toHaveProperty('delivered_at');
  });
});

describe('The Courier Guy bounded anonymous transport', () => {
  it('uses one credential-free GET with the public provider identity', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload()));
    await new CourierGuyTracker({ fetcher }).fetch('test a1');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`https://api.portal.thecourierguy.co.za/tracking/shipments?tracking_reference=${NUMBER}&provider_id=7`);
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
  });

  it('accepts only the exact absence signature, leaving generic and different-reference 404s inconclusive', async () => {
    for (const [body, kind] of [[`could not find shipment or parcel with reference ${NUMBER}`, 'not_found'],
      ['could not find shipment or parcel with reference TESTA2', 'indeterminate'], ['Not found', 'indeterminate']]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 404 }));
      await expect(new CourierGuyTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it.each([[410, 'indeterminate'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])('preserves HTTP %s failures', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Unavailable', { status: Number(status) }));
    await expect(new CourierGuyTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('does not reuse the verified 404 absence signature for an unobserved 410 response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(`could not find shipment or parcel with reference ${NUMBER}`, { status: 410 }));
    await expect(new CourierGuyTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
  });

  it('rejects invalid inputs before I/O and bounds cancellation, bytes and malformed responses', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const number of ['123', 'TESTA1&secret=value', 'X'.repeat(41)]) expect(() => normalizeCourierGuyNumber(number)).toThrow(TypeError);
    await expect(new CourierGuyTracker({ fetcher }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new CourierGuyTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const invalid = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Unavailable</html>'));
    await expect(new CourierGuyTracker({ fetcher: invalid }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });
});
