import { describe, expect, it } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import fixture from './fixtures/returned.json';
import { NinjaVanTracker, adapter } from './adapter';
import { normalizeNinjaVanNumber, parseNinjaVan, parseNinjaVanNotFound } from './parser';

const NUMBER = 'NLMYA00000000';
const clone = () => structuredClone(fixture);

describe('Ninja Van parser', () => {
  it('keeps the latest public scan and completed return, hiding later internal routing', () => {
    const result = normalizeCarrierResult(parseNinjaVan(clone(), NUMBER));
    expect(result.status).toBe('exception');
    expect(result.current_stage).toBe('returned');
    expect(result.last_status_text).toBe('Returned to sender');
    expect(result.last_update).toBe('2026-04-02T09:00:00Z');
    expect(result.delivered_at).toBeUndefined();
    expect(result.expected_delivery).toBeNull();
    expect(result.events).toHaveLength(5);
    expect(result.events?.[0]).toMatchObject({ provider_code: 'DELIVERY_SUCCESS', stage: 'returned', provider_leg: 'return' });
    expect(result.events?.at(-1)).toMatchObject({ provider_code: 'RTS', stage: 'exception', provider_leg: 'return' });
    expect(result.events?.every(event => !['ADDED_TO_SHIPMENT', 'PARCEL_ROUTING_SCAN'].includes(event.provider_code ?? ''))).toBe(true);
  });

  it('keeps movement on the return leg in transit until explicit sender delivery', () => {
    const payload = clone();
    payload.events = payload.events.slice(0, 6);
    payload.granular_status = 'En Route to Sorting Hub';
    payload.status = 'Transit';
    const result = parseNinjaVan(payload, NUMBER);
    expect(result.current_stage).toBe('in_transit');
    expect(result.status).toBe('in_transit');
    expect(result.events?.[0]?.provider_leg).toBe('return');
    expect(result.delivered_at).toBeUndefined();
  });

  it('accepts recipient delivery only without a return marker', () => {
    const payload = clone();
    payload.events = payload.events.slice(1, 7);
    const delivered = payload.events.at(-1)!;
    delivered.data = { is_rts: false };
    payload.granular_status = 'Completed';
    const result = parseNinjaVan(payload, NUMBER);
    expect(result.current_stage).toBe('delivered');
    expect(result.delivered_at).toBe('2026-04-02T09:00:00Z');
    expect(result.events?.[0]?.provider_leg).toBeUndefined();
  });

  it('does not call ambiguous return delivery a recipient delivery', () => {
    const payload = clone();
    delete (payload.events.at(-2)!.data as { is_rts?: boolean }).is_rts;
    const result = parseNinjaVan(payload, NUMBER);
    expect(result.current_stage).toBe('exception');
    expect(result.delivered_at).toBeUndefined();
  });

  it('keeps an unresolved newest clock without borrowing the older scan time', () => {
    const payload = clone();
    payload.events.at(-2)!.time = '2026-02-30T09:00:00Z';
    const result = parseNinjaVan(payload, NUMBER);
    expect(result.status).toBe('exception');
    expect(result.last_update).toBeNull();
    expect(result.events?.[0]).toMatchObject({ provider_time_text: '2026-02-30T09:00:00Z' });
    expect(result.events?.[0]?.time).toBeUndefined();
  });

  it('requires the returned parcel and all visible scans to belong to the request', () => {
    const wrong = clone();
    wrong.tracking_id = 'NLMYA99999999';
    expect(() => parseNinjaVan(wrong, NUMBER)).toThrowError();
    const crossOrder = clone();
    crossOrder.events[2]!.order_id = 99999;
    expect(() => parseNinjaVan(crossOrder, NUMBER)).toThrowError();
    const noScans = clone();
    noScans.events = [];
    expect(() => parseNinjaVan(noScans, NUMBER)).toThrowError();
  });

  it('distinguishes exact absent ID from a generic 404', () => {
    const exact = { error: { code: 150002, title: 'Not Found', message: `order by tracking id ${NUMBER} not found.` } };
    expect(() => parseNinjaVanNotFound(exact, NUMBER)).toThrowError(expect.objectContaining({ kind: 'not_found' }));
    expect(() => parseNinjaVanNotFound({ error: { code: 150002, title: 'Not Found', message: 'Unable to fetch order details' } }, NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parseNinjaVanNotFound({ error: { ...exact.error, message: 'order by tracking id NLMYA99999999 not found.' } }, NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it('requires a scoped Malaysian parcel format', () => {
    expect(normalizeNinjaVanNumber('nlmya 00000000')).toBe(NUMBER);
    expect(() => normalizeNinjaVanNumber('NLIDA00000000')).toThrow(TypeError);
    expect(() => normalizeNinjaVanNumber('NVMYA00000000')).toThrow(TypeError);
  });
});

describe('Ninja Van adapter', () => {
  it('uses the official single-order request and returns a normalized parcel', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async (url, init) => {
      calls += 1;
      const request = new URL(String(url));
      expect(request.origin).toBe('https://walrus.ninjavan.co');
      expect(request.pathname).toBe('/my/dash/1.2/public/orders');
      expect(request.searchParams.get('tracking_id')).toBe(NUMBER);
      expect(init?.signal).toBeDefined();
      return Response.json(clone());
    };
    const result = normalizeCarrierResult(await new NinjaVanTracker({ fetcher }).fetch(NUMBER));
    expect(result.current_stage).toBe('returned');
    expect(calls).toBe(1);
  });

  it('recognizes exact absence and leaves a generic negative inconclusive', async () => {
    const exact = { error: { code: 150002, title: 'Not Found', message: `order by tracking id ${NUMBER} not found.` } };
    const unknown = adapter({ trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {},
      fetcher: async () => Response.json(exact, { status: 404 }) });
    await expect(unknown.recognize?.(NUMBER)).resolves.toEqual({ known: false });
    const generic = adapter({ trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {},
      fetcher: async () => Response.json({ error: { code: 150002, title: 'Not Found', message: 'Unable to fetch order details' } }, { status: 404 }) });
    await expect(generic.recognize?.(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
    await expect(generic.recognize?.('NLIDA00000000')).resolves.toEqual({ known: false });
  });
});
