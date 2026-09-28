import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, parse, SingaporePostTracker } from './adapter';

const NUMBER = 'RR000000005SG';
const fixture = (name = 'in-transit') => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

describe('Singapore Post result projection', () => {
  it('keeps explicit scan offsets, maps each event and drops unrelated personal fields', () => {
    const result = normalizeCarrierResult(parse(fixture(), NUMBER));
    expect(result).toMatchObject({ status: 'in_transit', current_stage: 'customs', last_update: '2026-03-12T14:30:03+08:00', destination_country: 'CN' });
    expect(result.events).toHaveLength(9);
    expect(result.events?.at(-1)?.stage).toBe('accepted');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(result.delivery_tracking_number).toBeUndefined();
  });

  it('preserves unresolved Speedpost wall times without assigning Singapore time abroad', () => {
    const result = normalizeCarrierResult(parse(fixture('speedpost'), 'CZ000000005SG'));
    expect(result).toMatchObject({ status: 'in_transit', current_stage: 'customs', last_update: null });
    expect(result.events?.[0]).toMatchObject({ local_time: '2026-03-12T14:30:03', provider_code: 'HC', stage: 'customs' });
    expect(result.events?.every((event) => event.time === undefined)).toBe(true);
    expect(result.events?.at(-1)?.stage).toBe('registered');
    expect(result.timezone).toBeUndefined();
  });

  it('rejects wrong and duplicate identities even when the outer request is echoed', () => {
    const payload = fixture();
    payload.items[0].trackingNumber = 'RR000000014SG';
    expect(() => parse(payload, NUMBER)).toThrow('different or ambiguous');
    payload.items[0].trackingNumber = NUMBER;
    payload.items.push(payload.items[0]);
    expect(() => parse(payload, NUMBER)).toThrow('different or ambiguous');
  });

  it('requires an explicit missing-item marker and rejects incomplete responses', () => {
    expect(() => parse(fixture('not-found'), NUMBER)).toThrow(expect.objectContaining({ kind: 'not_found' }));
    const payload = fixture();
    payload.items[0].events = [];
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'indeterminate' }));
    payload.items[0].trackingNumberFound = false;
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    expect(() => parse({ ok: true, events: [] }, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
    const contradictory = fixture('not-found');
    contradictory.items[0].events = fixture().items[0].events;
    expect(() => parse(contradictory, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it.each(['date', 'description', 'record'])('rejects an invalid latest %s instead of promoting an older scan', (mode) => {
    const payload = fixture();
    if (mode === 'date') payload.items[0].events[0].date = '2026-02-30T14:30:00+08:00';
    if (mode === 'description') payload.items[0].events[0].statusDescription = '-';
    if (mode === 'record') payload.items[0].events[0] = null;
    expect(() => parse(payload, NUMBER)).toThrow(expect.objectContaining({ kind: 'schema' }));
  });

  it('deduplicates scans and preserves unmapped status codes', () => {
    const payload = fixture();
    payload.items[0].events[0].eventDescription = 'NEW';
    payload.items[0].events.push(payload.items[0].events[0]);
    const result = parse(payload, NUMBER);
    expect(result.status).toBe('unknown');
    expect(result.events?.[0].stage).toBeUndefined();
    expect(result.events).toHaveLength(9);
  });

  it('proves the declared capabilities with synthetic fixtures', () => {
    const result = parse(fixture(), NUMBER);
    const checks: Record<string, boolean> = { history: Boolean(result.events?.length), location: Boolean(result.events?.some((event) => event.location)) };
    const metadata = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    for (const capability of metadata.capabilities) expect(checks[capability], capability).toBe(true);
  });
});

describe('Singapore Post retrieval', () => {
  it('uses one fresh anonymous request with the official event request body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(fixture())));
    const instance = adapter({ fetcher, trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
    await expect(instance.track({ number: 'rr 000.000-005 sg' })).resolves.toMatchObject({ current_stage: 'customs' });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://www.singpost.com/api/services/track-events');
    expect(JSON.parse(String(init?.body))).toEqual({ trackingNumber: NUMBER });
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
    expect(new Headers(init?.headers).has('Cookie')).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([[404, 'transport'], [410, 'transport'], [403, 'challenge'], [429, 'rate_limited']])('does not interpret HTTP %s as shipment absence', async (status, kind) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('failure', { status: Number(status) }));
    await expect(new SingaporePostTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('propagates cancellation, validates inputs before I/O and caps the response', async () => {
    const unused = vi.fn<typeof fetch>();
    await expect(new SingaporePostTracker({ fetcher: unused }).fetch(NUMBER, { signal: AbortSignal.abort() })).rejects.toThrow();
    await expect(new SingaporePostTracker({ fetcher: unused }).fetch('tracking&number')).rejects.toThrow(TypeError);
    expect(unused).not.toHaveBeenCalled();
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_000_001)));
    await expect(new SingaporePostTracker({ fetcher: huge }).fetch(NUMBER)).rejects.toThrow('unexpectedly large');
  });
});
