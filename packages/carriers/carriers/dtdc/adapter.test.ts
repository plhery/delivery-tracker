import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, DtdcTracker } from './adapter';
import { normalizeDtdcNumber, parseDtdc } from './parser';

const NUMBER = 'N00000001';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));

describe('DTDC parser', () => {
  it('binds the booking reference and returns dated completed history', () => {
    const result = normalizeCarrierResult(parseDtdc(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', timezone: 'Asia/Kolkata' });
    expect(result.events).toHaveLength(5);
    expect(result.events?.[0]).toMatchObject({ description: 'Delivered', stage: 'delivered', location: 'Example destination depot' });
    expect(result.events?.[3]).toMatchObject({ description: 'Picked Up', stage: 'accepted' });
    expect(result.events?.at(-1)).toMatchObject({ description: 'Booked', stage: 'registered' });
    expect(result.last_update).toBe(new Date(1767445200000).toISOString().replace('.000', ''));
    expect(result.delivered_at).toBe(result.last_update);
    expect(result.weight_kg).toBeUndefined();
    expect(result.sender_name).toBeUndefined();
    expect(result.receiver_name).toBeUndefined();
    expect(JSON.stringify(result)).not.toMatch(/Synthetic address|Example recipient|private-example|private_instruction/);
  });

  it('accepts the verified original waybill alias and rejects mixed history', () => {
    const payload = fixture();
    payload.data.tracking[0].awb_number = payload.data.consignment.AWBNo;
    expect(parseDtdc(payload, payload.data.consignment.AWBNo).events).toHaveLength(5);
    payload.data.tracking[0].awb_number = 'N99999999';
    expect(() => parseDtdc(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('uses only returned consignment identity and rejects an input echo', () => {
    const payload = fixture();
    payload.requested = NUMBER;
    payload.data.consignment.referenceNumber = 'N99999999';
    payload.data.consignment.clientNumber = NUMBER;
    expect(() => parseDtdc(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    delete payload.data.consignment;
    expect(() => parseDtdc(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('adds a dated return snapshot without moving forward scans onto the return leg', () => {
    const payload = fixture();
    Object.assign(payload.data, { type: 'rto', status_external: 'RTO Booked', current_event_description: 'RTO Booked',
      status_internal: 'rto_in_transit', timestamp: 1767531600000, rto_awb_num: NUMBER });
    const result = parseDtdc(payload, NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'exception' });
    expect(result.events).toHaveLength(6);
    expect(result.events?.[0]).toMatchObject({ description: 'RTO Booked', stage: 'exception', provider_leg: 'return' });
    expect(result.events?.[1]).toMatchObject({ description: 'Delivered', stage: 'delivered' });
    expect(result.delivered_at).toBeUndefined();
  });

  it('does not classify delivery to the sender as recipient delivery', () => {
    const payload = fixture();
    payload.data.type = 'rto'; payload.data.tracking[0].type = 'rto';
    const result = parseDtdc(payload, NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned' });
    expect(result.events?.[0].stage).toBe('returned');
    expect(result.delivered_at).toBeUndefined();
  });

  it.each([
    ['Booked', 'pending', 'registered'],
    ['Picked Up', 'in_transit', 'accepted'],
    ['In Transit', 'in_transit', 'in_transit'],
    ['Out For Delivery', 'out_for_delivery', 'out_for_delivery'],
    ['RTO Booked', 'exception', 'exception'],
  ])('keeps return %s active until delivery back to the sender', (wording, status, stage) => {
    const payload = fixture();
    Object.assign(payload.data, { type: 'rto', status_external: wording, current_event_description: wording,
      status_internal: 'synthetic_return_movement', timestamp: 1767531600000, rto_awb_num: 'R00000001' });
    payload.data.tracking.push({ ...payload.data.tracking[2], type: 'rto', awb_number: 'R00000001',
      status_external: wording, event_description: wording, status_internal: 'synthetic_return_movement', timestamp: 1767531600000 });
    const result = normalizeCarrierResult(parseDtdc(payload, NUMBER));
    expect(result).toMatchObject({ status, current_stage: stage });
    expect(result.events?.[0]).toMatchObject({ description: wording, stage, provider_leg: 'return' });
    expect(result.events?.filter(event => event.provider_leg === 'return').every(event => event.stage !== 'returned')).toBe(true);
    expect(result.events?.some(event => event.provider_leg !== 'return' && event.stage === 'delivered')).toBe(true);
    expect(result.delivered_at).toBeUndefined();
  });

  it('orders shuffled forward and return scans by their own instants and declared legs', () => {
    const payload = fixture();
    Object.assign(payload.data, { type: 'rto', status_external: 'Delivered', current_event_description: 'Delivered',
      status_internal: 'rto_delivered', timestamp: 1767704400000, rto_awb_num: 'R00000001' });
    const returning = { ...payload.data.tracking[2], timestamp: 1767618000000, type: 'rto', awb_number: 'R00000001' };
    payload.data.tracking = [payload.data.tracking[4], returning, payload.data.tracking[0],
      payload.data.tracking[2], payload.data.tracking[1], payload.data.tracking[3]];
    const result = parseDtdc(payload, NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned' });
    expect(result.events?.slice(0, 3).map(event => [event.description, event.stage, event.provider_leg]))
      .toEqual([['Delivered', 'returned', 'return'], ['In Transit', 'in_transit', 'return'], ['Delivered', 'delivered', undefined]]);
    const times = result.events!.map(event => Date.parse(event.time!));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(result.delivered_at).toBeUndefined();
    returning.type = 'forward';
    expect(() => parseDtdc(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('preserves an unknown return scan label without claiming recipient delivery', () => {
    const payload = fixture();
    Object.assign(payload.data, { type: 'rto', status_external: 'New return state', current_event_description: 'New return state' });
    Object.assign(payload.data.tracking[0], { type: 'rto', status_external: 'New return state', event_description: 'New return state' });
    const result = parseDtdc(payload, NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_status_text: 'New return state' });
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.[0]).toMatchObject({ provider_leg: 'return' });
    expect(result.events?.[0].stage).toBeUndefined();
    expect(result.delivered_at).toBeUndefined();
  });

  it('preserves unmapped wording without letting an older delivered scan drive current state', () => {
    const payload = fixture();
    payload.data.status_external = 'New wording'; payload.data.current_event_description = 'New wording';
    const result = parseDtdc(payload, NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_status_text: 'New wording' });
    expect(result.current_stage).toBeUndefined();
    expect(result.events?.some(scan => scan.stage === 'delivered')).toBe(true);
  });

  it.each([null, 0, -1, 1790000000, '1767445200000', Number.NaN])('rejects ambiguous or invalid epoch milliseconds %s', timestamp => {
    const payload = fixture(); payload.data.tracking[0].timestamp = timestamp;
    expect(() => parseDtdc(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('keeps generic unavailable responses indeterminate', () => {
    expect(() => parseDtdc({ status: 'ERROR', error: { message: 'Unable to fetch tracking data currently' } }, NUMBER))
      .toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    expect(() => parseDtdc({ status: 'OK', data: {} }, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    const payload = fixture(); payload.data.tracking = [{}];
    expect(() => parseDtdc(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('rejects an unknown shipment leg instead of assuming recipient delivery', () => {
    const payload = fixture(); payload.data.type = 'reverse';
    expect(() => parseDtdc(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    payload.data.type = 'forward'; delete payload.data.tracking[0].type;
    expect(() => parseDtdc(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('deduplicates exact history and bounds output after ordering', () => {
    const payload = fixture(); payload.data.tracking.push(payload.data.tracking[0]);
    expect(parseDtdc(payload, NUMBER).events).toHaveLength(5);
    for (let i = 0; i < 110; i++) payload.data.tracking.push({ ...payload.data.tracking[0], location: `Example depot ${i}`, timestamp: 1767531600000 + i * 1000 });
    const result = parseDtdc(payload, NUMBER);
    expect(result.events).toHaveLength(100);
    expect(result.events?.[0].location).toBe('Example depot 109');
    payload.data.tracking = Array.from({ length: 1001 }, () => payload.data.tracking[0]);
    expect(() => parseDtdc(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('backs every declared capability with synthetic data', () => {
    const capabilities = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')).capabilities as string[];
    const result = parseDtdc(fixture(), NUMBER);
    const supported: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.some(event => event.location)) };
    for (const capability of capabilities) expect(supported[capability], capability).toBe(true);
  });
});

describe('DTDC retrieval', () => {
  it('uses one anonymous bounded request for each lookup and preserves the environment seam', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(fixture())));
    const instance = adapter({ fetcher, recorder: NOOP_RECORDER, env: {}, trawl: null, browserExecutablePath: null });
    expect(instance.id).toBe('dtdc'); expect(instance.steps).toEqual(['direct']);
    expect(normalizeDtdcNumber('n-0000 0001')).toBe(NUMBER);
    await instance.track({ number: NUMBER }); await instance.track({ number: NUMBER });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe(`https://ebookingbackend.dtdc.in/trackConsignment?reference_number=${NUMBER}`);
      expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
      expect(new Headers(init?.headers).get('Accept')).toBe('application/json');
      expect(new Headers(init?.headers).has('Authorization')).toBe(false);
      expect(new Headers(init?.headers).has('Cookie')).toBe(false);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each(['123', 'N00000001&reference_number=OTHER', 'N'.repeat(21)])('rejects invalid input %s before I/O', async number => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new DtdcTracker({ fetcher }).fetch(number)).rejects.toMatchObject({ kind: 'input_required' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([[400, 'indeterminate'], [401, 'challenge'], [403, 'challenge'], [404, 'transport'], [410, 'transport'], [429, 'rate_limited'], [503, 'maintenance']])('keeps HTTP %s separate from parcel absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Failure', { status: Number(status) }));
    await expect(new DtdcTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('propagates cancellation, fractional deadlines and response limits', async () => {
    const unused = vi.fn<typeof fetch>();
    await expect(new DtdcTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>(resolve => init?.signal?.addEventListener('abort', () => resolve(), { once: true }));
      init?.signal?.throwIfAborted(); return new Response(JSON.stringify(fixture()));
    });
    await expect(new DtdcTracker({ fetcher: slow }).fetch(NUMBER, { budgetMs: 20.5 })).rejects.toThrow();
    const oversized = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new DtdcTracker({ fetcher: oversized }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
  });
});
