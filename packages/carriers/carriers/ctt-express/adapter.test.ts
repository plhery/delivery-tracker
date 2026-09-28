import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/pickup.json';
import statuses from './statuses.json';
import { normalizeCarrierResult } from '../../core/result';
import { CttExpressTracker, adapter } from './adapter';
import { normalizeCttExpressNumber, parseCttExpress } from './parser';
import { classifyCttExpressStatus } from './status';

const NUMBER = '0000000000000000000001';
const OTHER = '0000000000000000000002';
const clone = () => structuredClone(fixture);
const json = (payload: unknown) => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });

describe('CTT Express direct tracking', () => {
  it('projects actual history newest first, retaining pickup availability and subsecond clocks', () => {
    const result = normalizeCarrierResult(parseCttExpress(fixture, NUMBER));
    expect(result).toMatchObject({ status: 'in_transit', current_stage: 'ready_for_pickup', last_status_text: 'Disponible en Punto Collectt Express', last_update: '2026-01-04T10:00:00Z', expected_delivery: null });
    expect(result.events).toHaveLength(7);
    expect(result.events?.map((event) => event.stage)).toEqual(['ready_for_pickup', 'out_for_delivery', 'out_for_delivery', 'exception', 'out_for_delivery', 'in_transit', 'registered']);
    expect(result.events?.[1].time).toBe('2026-01-03T12:00:01.017Z');
    expect(result.events?.[2].time).toBe('2026-01-03T12:00:00.970Z');
    expect(result.delivered_at).toBeUndefined();
    expect(result.weight_kg).toBeUndefined();
    expect(result.events?.every((event) => !event.location)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
    for (const row of statuses.entries) expect(classifyCttExpressStatus(row.code)?.stage).toBe(row.stage);
    expect(classifyCttExpressStatus('constructor')).toBeUndefined();
  });

  it('binds one exact shipment and its single package, rejecting multi-piece completion', () => {
    expect(normalizeCttExpressNumber('000000 000000 0000000001')).toBe(NUMBER);
    for (const raw of ['1000000000000000000001', '0000000000000000000001001', 'DT000000005PT', '', NUMBER + '?']) expect(() => normalizeCttExpressNumber(raw)).toThrow(TypeError);
    const wrongShipment = clone(); wrongShipment.data.shipping_code = OTHER;
    const wrongPiece = clone(); wrongPiece.data.shipping_history.item_code = OTHER + '001';
    const ambiguousPiece = clone(); ambiguousPiece.data.shipping_history.item_code = NUMBER + '002';
    for (const payload of [wrongShipment, wrongPiece, ambiguousPiece]) expect(() => parseCttExpress(payload, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    for (const count of [undefined, 0, 2, '1']) {
      const multi = { ...fixture, data: { ...fixture.data, item_count: count } };
      expect(() => parseCttExpress(multi, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
  });

  it('keeps token errors, unbound errors and echoed empty history inconclusive', async () => {
    for (const payload of [{ error: 'Invalid token.' }, { data: null, error: { errorDescription: 'Unknown shipment' } },
      { data: { shipping_code: NUMBER, shipping_history: { item_code: null, events: [] } }, error: null }]) {
      expect(() => parseCttExpress(payload, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const fetcher = vi.fn(async () => json({ error: 'Invalid token.' })) as unknown as typeof fetch;
    await expect(new CttExpressTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('requires complete bounded supported scan rows and preserves unknown codes', () => {
    for (const row of [null, {}, { ...fixture.data.shipping_history.events[0], type: 'PARTNER' },
      { ...fixture.data.shipping_history.events[0], source: 'PARTNER_STATUS' },
      { ...fixture.data.shipping_history.events[0], description: '' }, { ...fixture.data.shipping_history.events[0], code: 'invalid' }]) {
      const data = { ...fixture.data, shipping_history: { ...fixture.data.shipping_history, events: [row] } };
      expect(() => parseCttExpress({ data, error: null }, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    for (const payload of [null, [], {}, { ...fixture, data: null }, { ...fixture, data: { ...fixture.data, shipping_history: [] } },
      { ...fixture, data: { ...fixture.data, shipping_history: { ...fixture.data.shipping_history, events: Array(501).fill(fixture.data.shipping_history.events[0]) } } }]) {
      expect(() => parseCttExpress(payload, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const unknown = clone();
    unknown.data.shipping_history.events.push({ ...unknown.data.shipping_history.events[0], code: '9999', description: 'Unmapped scan', event_date: '2026-01-05T10:00:00Z' });
    expect(parseCttExpress(unknown, NUMBER)).toMatchObject({ status: 'unknown', last_status_text: 'Unmapped scan' });
    expect(parseCttExpress(unknown, NUMBER).current_stage).toBeUndefined();
  });

  it('maps older V1 source independently and does not claim completed return or failed pickup acceptance', () => {
    for (const [code, wording] of [['0600', 'Recogida fallida'], ['2500', 'En devolución']]) {
      const payload = clone();
      payload.data.shipping_history.events = [{ ...payload.data.shipping_history.events[0], code, description: wording, source: 'ITEM_STATUS_CHANGE_V1' }];
      const result = normalizeCarrierResult(parseCttExpress(payload, NUMBER));
      expect(result).toMatchObject({ status: 'exception', current_stage: 'exception' });
      expect(result.delivered_at).toBeUndefined();
    }
  });

  it.each([
    ['1000', 'in_transit', 'in_transit'],
    ['1500', 'out_for_delivery', 'out_for_delivery'],
    ['2400', 'out_for_delivery', 'out_for_delivery'],
    ['2310', 'in_transit', 'ready_for_pickup'],
    ['2100', 'exception', 'returned'],
    ['2110', 'exception', 'returned'],
  ])('preserves the return leg through later scan %s without completing recipient delivery or promising outbound ETA', (code, status, stage) => {
    const payload = clone();
    const row = payload.data.shipping_history.events[0];
    payload.data.committed_delivery_datetime = '2026-01-06';
    payload.data.shipping_history.events = [
      { ...row, code: '1000', description: 'Enviado', event_date: '2026-01-01T10:00:00Z' },
      { ...row, code: '2500', description: 'En devolución', event_date: '2026-01-03T10:00:00Z' },
      { ...row, code, description: 'Later provider scan', event_date: '2026-01-04T10:00:00Z' },
    ];
    for (const events of [payload.data.shipping_history.events, [...payload.data.shipping_history.events].reverse()]) {
      const result = normalizeCarrierResult(parseCttExpress({ ...payload, data: { ...payload.data,
        shipping_history: { ...payload.data.shipping_history, events } } }, NUMBER));
      expect(result).toMatchObject({ status, current_stage: stage, last_update: '2026-01-04T10:00:00Z', expected_delivery: null });
      expect(result.delivered_at).toBeUndefined();
      expect(result.events?.[0]).toMatchObject({ provider_code: code, provider_leg: 'return', stage });
      expect(result.events?.[1]).toMatchObject({ provider_code: '2500', provider_leg: 'return', stage: 'exception' });
      expect(result.events?.[2]).not.toHaveProperty('provider_leg');
    }
  });

  it.each(['', '2026-02-30T10:00:00Z', 'Clock missing'])('keeps an unresolved newest return scan in source order for clock %s', event_date => {
    const payload = clone();
    const row = payload.data.shipping_history.events[0];
    payload.data.shipping_history.events = [
      { ...row, code: '2100', description: 'Earlier outbound delivery', event_date: '2026-01-01T10:00:00Z' },
      { ...row, code: '2500', description: 'En devolución', event_date: '2026-01-03T10:00:00Z' },
      { ...row, code: '9999', description: 'Unknown newest return scan', event_date },
    ];
    const result = parseCttExpress(payload, NUMBER);
    expect(result).toMatchObject({ status: 'unknown', last_update: null, last_status_text: 'Unknown newest return scan', expected_delivery: null });
    expect(result).not.toHaveProperty('current_stage');
    expect(result).not.toHaveProperty('delivered_at');
    expect(result.events?.map(event => event.provider_code)).toEqual(['9999', '2500', '2100']);
    expect(result.events?.[0]).toMatchObject({ provider_leg: 'return' });
    expect(result.events?.[0]).not.toHaveProperty('time');
    expect(result.events?.[2]).toMatchObject({ stage: 'delivered' });
    expect(result.events?.[2]).not.toHaveProperty('provider_leg');
  });

  it('establishes the return leg before removing repeated return-start scans', () => {
    const payload = clone();
    const row = { ...payload.data.shipping_history.events[0], code: '2500', description: 'En devolución', event_date: '2026-01-03T10:00:00Z' };
    payload.data.shipping_history.events = [row, { ...row, code: '1500', description: 'En reparto' },
      structuredClone(row), { ...row, code: '2100', description: 'Entregado', event_date: '2026-01-04T10:00:00Z' }];
    const result = parseCttExpress(payload, NUMBER);
    expect(result).toMatchObject({ status: 'exception', current_stage: 'returned', expected_delivery: null });
    expect(result.events?.map(event => event.provider_code)).toEqual(['2100', '2500', '1500']);
    expect(result.events?.every(event => event.provider_leg === 'return')).toBe(true);
    expect(result).not.toHaveProperty('delivered_at');
  });

  it('orders dated scans and keeps an unresolved newest scan from yielding to older delivery', () => {
    const unsorted = clone();
    unsorted.data.shipping_history.events.reverse();
    expect(parseCttExpress(unsorted, NUMBER).last_update).toBe('2026-01-04T10:00:00Z');
    for (const rawTime of ['', '2026-01-05', '2026-02-30T10:00:00Z', '2026-01-05T10:00:00+99:00', 'Tomorrow at noon']) {
      const payload = clone();
      payload.data.shipping_history.events[0].code = '2100';
      payload.data.shipping_history.events.push({ ...payload.data.shipping_history.events[0], code: '9999', description: 'New scan', event_date: rawTime });
      const result = parseCttExpress(payload, NUMBER);
      expect(result).toMatchObject({ status: 'unknown', last_status_text: 'New scan', last_update: null });
      expect(result.delivered_at).toBeUndefined();
      expect(result.events?.[0].time).toBeUndefined();
      if (rawTime) expect(result.events?.[0].provider_time_text).toBe(rawTime);
    }
    const wall = clone();
    wall.data.shipping_history.events.push({ ...wall.data.shipping_history.events[0], code: '2100', description: 'Delivery scan', event_date: '2026-01-05T10:00:00' });
    expect(parseCttExpress(wall, NUMBER)).toMatchObject({ status: 'delivered', last_update: null, last_update_local: '2026-01-05T10:00:00' });
    expect(parseCttExpress(wall, NUMBER).delivered_at).toBeUndefined();
  });

  it('uses only the latest delivery scan instant and deduplicates scans after projection', () => {
    const payload = clone();
    payload.data.shipping_history.events.push({ ...payload.data.shipping_history.events[0], code: '2100', description: 'Delivery scan', event_date: '2026-01-05T10:00:00+01:00' });
    payload.data.shipping_history.events.push(structuredClone(payload.data.shipping_history.events.at(-1)!));
    expect(parseCttExpress(payload, NUMBER)).toMatchObject({ status: 'delivered', delivered_at: '2026-01-05T10:00:00+01:00' });
    expect(parseCttExpress(payload, NUMBER).events).toHaveLength(8);
    payload.data.shipping_history.events.push({ ...payload.data.shipping_history.events[0], code: '2110', description: 'New delivery scan', event_date: 'Clock missing' });
    expect(parseCttExpress(payload, NUMBER).delivered_at).toBeUndefined();
    expect(parseCttExpress(payload, NUMBER).last_update).toBeNull();
  });

  it('keeps the newest provider position when equal-time scans repeat around another status', () => {
    const payload = clone();
    const row = { ...payload.data.shipping_history.events[0], event_date: '2026-01-05T10:00:00Z', code: '1500', description: 'En reparto' };
    payload.data.shipping_history.events = [row, { ...row, code: '1600', description: 'Incidencia en el reparto' }, structuredClone(row)];
    const result = parseCttExpress(payload, NUMBER);
    expect(result).toMatchObject({ status: 'out_for_delivery', current_stage: 'out_for_delivery' });
    expect(result.events?.map((event) => event.provider_code)).toEqual(['1500', '1600']);
  });

  it('retains valid current calendar estimates without inventing an instant or retaining stale promises', () => {
    const payload = clone();
    payload.data.shipping_history.events = [payload.data.shipping_history.events[1]];
    expect(parseCttExpress(payload, NUMBER).expected_delivery).toBe('2026-01-04');
    for (const eta of ['', '2026-01-01', '2026-02-30', '2026-01-04T12:00:00Z', 'Unknown']) {
      payload.data.committed_delivery_datetime = eta;
      expect(parseCttExpress(payload, NUMBER).expected_delivery).toBeNull();
    }
    payload.data.committed_delivery_datetime = '2026-01-04';
    for (const code of ['1600', '2100', '2110', '2310', '2500', '9999']) {
      payload.data.shipping_history.events[0].code = code;
      expect(parseCttExpress(payload, NUMBER).expected_delivery).toBeNull();
    }
    payload.data.shipping_history.events[0].code = '1000';
    const held = { ...payload, data: { ...payload.data, shipping_history: { ...payload.data.shipping_history,
      events: [{ ...payload.data.shipping_history.events[0], detail: { incident_type_code: '21_INCT' } }] } } };
    expect(parseCttExpress(held, NUMBER).expected_delivery).toBeNull();
    payload.data.shipping_history.events[0].event_date = 'Unknown';
    expect(parseCttExpress(payload, NUMBER).expected_delivery).toBeNull();
  });

  it('requests the current anonymous route once, through the factory and bounded transport', async () => {
    const fetcher = vi.fn(async (url, init) => {
      expect(new URL(String(url)).href).toBe('https://wct.cttexpress.com/p_track_redis_v2.php?sc=' + NUMBER);
      expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get('origin')).toBe('https://shipping-tracking.production.cloud2.cttexpress.com');
      expect(new Headers(init?.headers).get('cookie')).toBeNull();
      expect(new Headers(init?.headers).get('authorization')).toBeNull();
      return json(fixture);
    }) as unknown as typeof fetch;
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: { step() {}, lookup() {} } });
    expect((await instance.track({ number: NUMBER })).current_stage).toBe('ready_for_pickup');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(instance.recognize).toBeTypeOf('function');
  });

  it('recognizes only identity-bound scans, skips unsupported numbers and preserves inconclusive failures', async () => {
    const fetcher = vi.fn(async () => json(fixture)) as unknown as typeof fetch;
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: { step() {}, lookup() {} } });
    expect(await instance.recognize!('invalid')).toEqual({ known: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await instance.recognize!(NUMBER)).toEqual({ known: true, lastActivityAt: '2026-01-04T10:00:00.000Z' });
    const payload = { data: { shipping_code: NUMBER, shipping_history: { item_code: null, events: [] } }, error: null };
    const empty = adapter({ fetcher: vi.fn(async () => json(payload)) as unknown as typeof fetch, trawl: null, browserExecutablePath: null, env: {}, recorder: { step() {}, lookup() {} } });
    await expect(empty.recognize!(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
    const wrong = clone(); wrong.data.shipping_code = OTHER;
    const mismatched = adapter({ fetcher: vi.fn(async () => json(wrong)) as unknown as typeof fetch, trawl: null, browserExecutablePath: null, env: {}, recorder: { step() {}, lookup() {} } });
    await expect(mismatched.recognize!(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });

  it('preserves failure kinds and rejects large bodies and malformed JSON without retrying', async () => {
    for (const [status, kind] of [[404, 'indeterminate'], [410, 'indeterminate'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']] as const) {
      const fetcher = vi.fn(async () => new Response('unavailable', { status })) as unknown as typeof fetch;
      await expect(new CttExpressTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const broken = vi.fn(async () => new Response('<html>changed</html>')) as unknown as typeof fetch;
    await expect(new CttExpressTracker({ fetcher: broken }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
    const large = vi.fn(async () => new Response(new Uint8Array(1_000_001))) as unknown as typeof fetch;
    await expect(new CttExpressTracker({ fetcher: large }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    expect(large).toHaveBeenCalledTimes(1);
  });

  it('cancels before and during retrieval and enforces the lookup budget', async () => {
    const immediate = vi.fn(async () => json(fixture)) as unknown as typeof fetch;
    const tracker = new CttExpressTracker({ fetcher: immediate });
    await expect(tracker.fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toBeInstanceOf(Error);
    await expect(tracker.fetch(NUMBER, { budgetMs: 0 })).rejects.toMatchObject({ kind: 'budget' });
    expect(immediate).not.toHaveBeenCalled();
    const controller = new AbortController();
    const waiting = vi.fn(async (_url, init) => {
      init?.signal?.throwIfAborted();
      await new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
      return json(fixture);
    }) as unknown as typeof fetch;
    const active = new CttExpressTracker({ fetcher: waiting }).fetch(NUMBER, { signal: controller.signal });
    controller.abort();
    await expect(active).rejects.toMatchObject({ kind: 'transport' });
    await expect(new CttExpressTracker({ fetcher: waiting }).fetch(NUMBER, { budgetMs: 20 })).rejects.toMatchObject({ kind: 'transport' });
    expect(waiting).toHaveBeenCalledTimes(2);
  });
});
