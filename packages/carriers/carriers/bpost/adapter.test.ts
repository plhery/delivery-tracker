import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { NOOP_RECORDER } from '../../core/telemetry';
import { normalizeCarrierResult } from '../../core/result';
import { adapter, BpostTracker } from './adapter';
import { normalizeBpostNumber, parseBpost } from './parser';
import { classifyBpostStatus } from './status';

const NUMBER = '000000000000000000000001';
const OTHER = '000000000000000000000002';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const payload = () => structuredClone(fixture);

describe('bpost direct history', () => {
  it('reads the identity-bound timeline and preserves clocks without inventing offsets', () => {
    const result = normalizeCarrierResult(parseBpost(payload(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: null,
      last_update_local: '2026-01-04T12:00:00', weight_kg: 0.32, dimensions_text: '26.1 × 7.5 × 38.4 cm', expected_delivery: null });
    expect(result.events?.map((event) => event.stage)).toEqual(['delivered', 'ready_for_pickup', 'out_for_delivery', 'in_transit', 'registered']);
    expect(result.events?.every((event) => event.local_time && !event.time)).toBe(true);
    expect(result).not.toHaveProperty('delivered_at');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|recipient|receiver|sender|actualDeliveryTime|activeStep/);
    const declared = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    const evidence: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.[0]?.location),
      weight: typeof result.weight_kg === 'number', dimensions: Boolean(result.dimensions_text) };
    for (const capability of declared.capabilities) expect(evidence[capability], capability).toBe(true);
  });

  it('requires both parcel and search identity and rejects ambiguous results', () => {
    const wrong = payload(); wrong.items[0].itemCode = OTHER;
    const alias = payload(); alias.items[0].searchCode = OTHER;
    const duplicate = payload(); duplicate.items.push(duplicate.items[0]);
    for (const value of [null, {}, { items: [] }, { items: [null] }, wrong, alias, duplicate]) {
      expect(() => parseBpost(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const multiple = payload(); multiple.items.unshift({ ...payload().items[0], itemCode: OTHER, searchCode: OTHER, events: [] });
    expect(parseBpost(multiple, NUMBER).status).toBe('delivered');
  });

  it('accepts only the explicit batch negative and leaves other errors inconclusive', () => {
    expect(() => parseBpost({ error: 'NO_DATA_FOUND' }, NUMBER)).toThrowError(expect.objectContaining({ kind: 'not_found' }));
    for (const value of [{ error: 'NO_DATA_FOUND', items: [] }, { error: 'INVALID_POSTAL_CODE' }, { error: 'MAINTENANCE' }]) {
      expect(() => parseBpost(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const empty = payload(); empty.items[0].events = [];
    expect(() => parseBpost(empty, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });

  it.each(['2026-02-30', '2026-13-01', '', '01/04/2026'])('rejects invalid date %s without promoting earlier progress', (date) => {
    const value = payload(); value.items[0].events[0].date = date;
    expect(() => parseBpost(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['25:00', '12:60', '', '12:00Z'])('rejects invalid clock %s', (time) => {
    const value = payload(); value.items[0].events[0].time = time;
    expect(() => parseBpost(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
  });

  it('rejects malformed or excessive scans and keeps provider order across countries', () => {
    for (const scan of [null, {}, { ...payload().items[0].events[0], key: { EN: { description: '' } } }]) {
      const value = payload(); value.items[0].events[0] = scan;
      expect(() => parseBpost(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const excessive = payload(); excessive.items[0].events = Array(501).fill(excessive.items[0].events[0]);
    expect(() => parseBpost(excessive, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    const order = payload(); order.items[0].events[1].date = '2026-01-05';
    expect(parseBpost(order, NUMBER).last_update_local).toBe('2026-01-04T12:00:00');
    order.items[0].events.push(order.items[0].events[0]);
    expect(parseBpost(order, NUMBER).events).toHaveLength(5);
  });

  it('keeps pickup availability, unrecognized scans and return delivery distinct', () => {
    const pickup = payload(); pickup.items[0].events.shift();
    expect(parseBpost(pickup, NUMBER)).toMatchObject({ status: 'in_transit', current_stage: 'ready_for_pickup' });
    const unknown = payload(); unknown.items[0].events[0].key.EN.description = 'Delivery expected';
    expect(parseBpost(unknown, NUMBER).status).toBe('unknown');
    expect(parseBpost(unknown, NUMBER).events?.[0]).not.toHaveProperty('stage');
    const returned = payload(); returned.items[0].retourOrBackToSender = true;
    expect(() => parseBpost(returned, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    returned.items[0].activeStep.knownProcessStep = 'DELIVERED_TO_SENDER';
    expect(parseBpost(returned, NUMBER)).toMatchObject({ status: 'exception', current_stage: 'returned' });
    expect(parseBpost(returned, NUMBER).events?.[0]).toMatchObject({ provider_leg: 'return', stage: 'returned' });
    expect(classifyBpostStatus('Item available at Pick-up point')?.stage).toBe('ready_for_pickup');
    for (const wording of ['__proto__', 'constructor', 'Delivery expected']) expect(classifyBpostStatus(wording)).toBeUndefined();
  });

  it('keeps only explicitly labelled positive measurements', () => {
    for (const weightInGrams of [0, -1, '320', null, Infinity]) {
      const value = payload(); value.items[0].weightInGrams = weightInGrams;
      expect(parseBpost(value, NUMBER)).not.toHaveProperty('weight_kg');
    }
    for (const dimensionsInCm of ['26 x 7 x 38', '0cm x 7cm x 38cm', '26in x 7in x 38in', '']) {
      const value = payload(); value.items[0].dimensionsInCm = dimensionsInCm;
      expect(parseBpost(value, NUMBER)).not.toHaveProperty('dimensions_text');
    }
  });
});

describe('bpost anonymous batch request', () => {
  it('recognizes matching history and explicit absence while preserving lookup failures', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    await expect(instance.recognize!('123')).resolves.toEqual({ known: false });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(payload())));
    await expect(instance.recognize!(NUMBER)).resolves.toEqual({ known: true, lastActivityAt: null });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'NO_DATA_FOUND' })));
    await expect(instance.recognize!(NUMBER)).resolves.toEqual({ known: false });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'INVALID_POSTAL_CODE' })));
    await expect(instance.recognize!(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ ...payload(), items: [] })));
    await expect(instance.recognize!(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });

  it('sends one bounded request without postcode, session or authentication', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload())));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    await expect(instance.track({ number: '000000 000000 000000 000001' })).resolves.toMatchObject({ status: 'delivered' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://track.bpost.cloud/track/items');
    expect(init).toMatchObject({ method: 'POST', body: JSON.stringify({ barcodes: [NUMBER] }), cache: 'no-store', redirect: 'error' });
    const headers = new Headers(init?.headers);
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.has('Cookie')).toBe(false);
    expect(headers.has('Authorization')).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(normalizeBpostNumber('rr 000000005 be')).toBe('RR000000005BE');
  });

  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])('keeps HTTP %s distinct from a parcel negative', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('failure', { status: Number(status) }));
    await expect(new BpostTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects unsupported inputs before I/O, propagates cancellation and bounds response size', async () => {
    const unused = vi.fn<typeof fetch>();
    for (const invalid of ['123', 'RR000000006BE', `${NUMBER}&postalCode=1234`]) {
      await expect(new BpostTracker({ fetcher: unused }).fetch(invalid)).rejects.toThrow(TypeError);
    }
    await expect(new BpostTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(unused).not.toHaveBeenCalled();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new BpostTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const invalidJson = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Unavailable</html>'));
    await expect(new BpostTracker({ fetcher: invalidJson }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });
});
