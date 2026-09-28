import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { NOOP_RECORDER } from '../../core/telemetry';
import { normalizeCarrierResult } from '../../core/result';
import { adapter, NzPostTracker } from './adapter';
import { normalizeNzPostNumber, parseNzPost } from './parser';
import { classifyNzPostStatus } from './status';

const NUMBER = '00000000000000000001';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const payload = () => structuredClone(fixture);
const absent = () => ({ success: true, status_code: 2, results: [{ tracking_reference: NUMBER,
  errors: [{ code: 400002, message: 'Invalid parameter(s)', details: 'No data found for this Tracking Reference' }] }] });

describe('NZ Post exact-reference projection', () => {
  it('returns actual scans, UTC instants and depot names while excluding recipient fields', () => {
    const result = normalizeCarrierResult(parseNzPost(payload(), NUMBER));
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: '2026-01-06T12:00:00Z',
      delivered_at: '2026-01-06T12:00:00Z', expected_delivery: null });
    expect(result.events?.map(event => event.stage)).toEqual(['delivered', 'out_for_delivery', 'in_transit', 'accepted', 'registered']);
    expect(result.events?.[0]).toMatchObject({ location: 'Example Depot', description: 'Delivered', provider_code: '22' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|signed_by|seqref|run_name|source/);
    const declared = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    const evidence: Record<string, boolean> = { history: Boolean(result.events?.length),
      location: Boolean(result.events?.[0]?.location), delivered_at: Boolean(result.delivered_at) };
    for (const capability of declared.capabilities) expect(evidence[capability], capability).toBe(true);
  });

  it('rejects unrelated, duplicated or expanded references and malformed envelopes', () => {
    const wrong = payload(); wrong.results[0].tracking_reference = '00000000000000000002';
    const punctuation = payload(); punctuation.results[0].tracking_reference = '0000000000 0000000001';
    const duplicates = payload(); duplicates.results.push(duplicates.results[0]);
    for (const value of [null, {}, { success: true, status_code: 1 }, wrong, punctuation, duplicates]) {
      expect(() => parseNzPost(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const padding = payload(); padding.results[0].tracking_reference = ` ${NUMBER} `;
    expect(parseNzPost(padding, NUMBER).status).toBe('delivered');
  });

  it('accepts only the identity-bound absence signature and leaves unknown outcomes inconclusive', () => {
    expect(() => parseNzPost(absent(), NUMBER)).toThrowError(expect.objectContaining({ kind: 'not_found' }));
    const generic = absent(); generic.results[0].errors[0].details = 'Invalid reference';
    const incomplete = absent(); incomplete.results[0].errors.push(incomplete.results[0].errors[0]);
    const mixed = { ...absent(), results: [{ ...absent().results[0], tracking_events: [] }] };
    const empty = payload(); empty.results[0].tracking_events = [];
    for (const value of [generic, incomplete, mixed, empty, { success: false, status_code: 2 },
      { success: true, status_code: 1, results: [] }]) {
      expect(() => parseNzPost(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
    }
    const wrong = absent(); wrong.results[0].tracking_reference = '00000000000000000002';
    expect(() => parseNzPost(wrong, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['2026-02-30T12:00:00Z', '2026-01-06T12:00:00+02:99', '2026-01-06T12:00:00+99:00', '12:00', '', null])(
    'keeps an unresolved newest clock %s from borrowing an older timestamp', (clock) => {
      const value = payload(); value.results[0].tracking_events.at(-1).date_time = clock;
      const result = parseNzPost(value, NUMBER);
      expect(result.status).toBe('delivered'); expect(result.last_update).toBeNull();
      expect(result.events?.[0].description).toBe('Delivered');
      expect(result.events?.[0]).not.toHaveProperty('time'); expect(result).not.toHaveProperty('delivered_at');
      if (clock) expect(result.events?.[0]).toMatchObject({ provider_time_text: clock });
    });

  it('preserves offsetless clocks, unknown latest status, stable ties and exact duplicate scans', () => {
    const local = payload(); local.results[0].tracking_events.at(-1).date_time = '2026-01-06T12:00:00';
    expect(parseNzPost(local, NUMBER)).toMatchObject({ last_update: null, last_update_local: '2026-01-06T12:00:00' });
    const unknown = payload(); Object.assign(unknown.results[0].tracking_events.at(-1), { status: 'Unmapped provider scan', edifact_code: '__proto__' });
    expect(parseNzPost(unknown, NUMBER)).toMatchObject({ status: 'unknown' });
    expect(parseNzPost(unknown, NUMBER)).not.toHaveProperty('current_stage');
    expect(parseNzPost(unknown, NUMBER).events?.[0]).not.toHaveProperty('stage');
    expect(classifyNzPostStatus('constructor')).toBeUndefined();
    const duplicate = payload(); duplicate.results[0].tracking_events.push({ ...duplicate.results[0].tracking_events.at(-1), seqref: 'another' });
    expect(parseNzPost(duplicate, NUMBER).events).toHaveLength(5);
    const tie = payload(); tie.results[0].tracking_events.at(-1).date_time = tie.results[0].tracking_events.at(-2).date_time;
    expect(parseNzPost(tie, NUMBER).events?.[0].description).toBe('Delivered');
  });

  it('distinguishes pre-advice, pickup availability, failed attempts and unknown codes', () => {
    for (const code of ['205', '206', '997']) expect(classifyNzPostStatus(code)).toMatchObject({ status: 'pending', stage: 'registered' });
    expect(classifyNzPostStatus('141')).toMatchObject({ status: 'in_transit', stage: 'ready_for_pickup' });
    expect(classifyNzPostStatus('42')).toMatchObject({ status: 'exception', stage: 'exception' });
    expect(classifyNzPostStatus('40')?.status).toBe('exception');
    expect(classifyNzPostStatus('new-code')).toBeUndefined();
  });

  it('bounds scans, validates required fields and keeps the newest retained events', () => {
    for (const scan of [null, {}, { status: 'Delivered', edifact_code: '22', date_time: 123 }]) {
      const value = payload(); value.results[0].tracking_events.push(scan);
      expect(() => parseNzPost(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const value = payload(); value.results[0].tracking_events = Array.from({ length: 101 }, (_, i) => ({
      status: `Synthetic scan ${i}`, edifact_code: '8', date_time: '',
    }));
    expect(parseNzPost(value, NUMBER).events).toHaveLength(100);
    expect(parseNzPost(value, NUMBER).events?.[0].description).toBe('Synthetic scan 100');
    value.results[0].tracking_events = Array(501).fill(value.results[0].tracking_events[0]);
    expect(() => parseNzPost(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
  });
});

describe('NZ Post bounded anonymous transport', () => {
  it('uses one no-store GET and recognizes only evidenced history or absence', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(payload())))
      .mockResolvedValueOnce(new Response(JSON.stringify(absent())));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    await expect(instance.recognize!('123')).resolves.toEqual({ known: false });
    await expect(instance.recognize!(NUMBER)).resolves.toEqual({ known: true, lastActivityAt: '2026-01-06T12:00:00.000Z' });
    await expect(instance.recognize!(NUMBER)).resolves.toEqual({ known: false });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`https://tools.nzpost.co.nz/tracking/api/parceltrack/parcels?tracking_reference=${NUMBER}`);
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.has('Authorization')).toBe(false); expect(headers.has('Cookie')).toBe(false);
    expect(normalizeNzPostNumber('rr 000000005 nz')).toBe('RR000000005NZ');
  });

  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited'], [503, 'maintenance']])(
    'does not turn HTTP %s into parcel absence', async (status, kind) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('unavailable', { status: Number(status) }));
      await expect(new NzPostTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
      expect(fetcher).toHaveBeenCalledOnce();
    });

  it('rejects invalid inputs before I/O and bounds response bytes and cancellation', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const number of ['123', 'RR000000006NZ', `${NUMBER}&private=value`]) {
      expect(() => new NzPostTracker({ fetcher }).fetch(number)).toThrow(TypeError);
    }
    await expect(new NzPostTracker({ fetcher }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new NzPostTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>Unavailable</html>'));
    await expect(new NzPostTracker({ fetcher: malformed }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
  });
});
