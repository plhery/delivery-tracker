import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { OntracTracker } from './adapter';
import { normalizeOntracNumber, parseOntrac } from './parser';

const NUMBER = '1LS0000000000001';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8'));
const payload = () => structuredClone(fixture);

describe('OnTrac direct tracking', () => {
  it('preserves offset scans and maps each code independently', () => {
    const result = parseOntrac(payload(), NUMBER);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: '2026-01-03T14:00:00-08:00', expected_delivery: null });
    expect(result.events?.map(e => e.stage)).toEqual(['delivered', 'out_for_delivery', 'registered']);
    expect(result.weight_kg).toBeCloseTo(0.90718474);
    const declared = JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'));
    expect(declared.capabilities).toEqual(['history', 'estimated_delivery', 'weight']);
    const inTransit = payload(); inTransit.Packages[0].Events.shift();
    expect(parseOntrac(inTransit, NUMBER).expected_delivery).toBe('2026-01-03T20:00:00-08:00');
  });
  it('rejects missing, wrong and ambiguous identities and empty histories', () => {
    for (const value of [null, {}, { Packages: [] }, { Packages: [{ ...payload().Packages[0], Tracking: '1LS0000000000002' }] }, { Packages: [payload().Packages[0], payload().Packages[0]] }]) {
      expect(() => parseOntrac(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    const value = payload(); value.Packages[0].Events = [];
    expect(() => parseOntrac(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'indeterminate' }));
  });
  it('keeps new wording undated and unmapped rather than inventing a stage', () => {
    const value = payload(); value.Packages[0].Events = [{ EventCode: 'NEW', EventShortDescription: 'New event', ZonedEventDateTime: '2026-01-03T14:00:00' }];
    expect(parseOntrac(value, NUMBER)).toMatchObject({ status: 'unknown', last_update: null,
      last_update_local: '2026-01-03T14:00:00', events: [{ description: 'New event', local_time: '2026-01-03T14:00:00' }] });
    expect(parseOntrac(value, NUMBER).events?.[0]).not.toHaveProperty('time');
    expect(parseOntrac(value, NUMBER).events?.[0]).not.toHaveProperty('stage');
  });
  it('keeps the newest unresolved delivery ahead of older timestamped scans', () => {
    const value = payload();
    value.Packages[0].Events[0].ZonedEventDateTime = '2026-01-03T14:00:00';
    const result = parseOntrac(value, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', current_stage: 'delivered', last_update: null,
      last_update_local: '2026-01-03T14:00:00', expected_delivery: null });
    expect(result).not.toHaveProperty('delivered_at');
    expect(result.events?.map(e => e.stage)).toEqual(['delivered', 'out_for_delivery', 'registered']);
    expect(result.events?.[0]).not.toHaveProperty('time');
    expect(result.events?.[1]?.time).toBe('2026-01-03T08:00:00-08:00');
  });
  it('validates unresolved calendar digits and keeps distinct local scans', () => {
    const value = payload();
    const event = value.Packages[0].Events[0];
    value.Packages[0].Events = [
      { ...event, ZonedEventDateTime: '2026-01-03T14:00:00' },
      { ...event, ZonedEventDateTime: '2026-01-03T13:00:00' },
      { ...event, ZonedEventDateTime: '2026-01-03T14:00:00' },
    ];
    expect(parseOntrac(value, NUMBER).events?.map(e => e.local_time)).toEqual(['2026-01-03T14:00:00', '2026-01-03T13:00:00']);
    value.Packages[0].Events[0].ZonedEventDateTime = '2026-02-30T14:00:00';
    const result = parseOntrac(value, NUMBER);
    expect(result.last_update).toBeNull();
    expect(result.last_update_local).toBeNull();
    expect(result.events?.[0]).not.toHaveProperty('local_time');
    expect(result.events?.[0]).toHaveProperty('provider_time_text', '2026-02-30T14:00:00');
  });
  it('rejects malformed scans rather than presenting older delivery as current', () => {
    for (const scan of [null, { EventCode: 'NEW' }]) {
      const value = payload(); value.Packages[0].Events.unshift(scan);
      expect(() => parseOntrac(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
  });
  it.each([
    ['PU', 'The package was picked up', 'in_transit', 'accepted'],
    ['RL', 'Package received after cutoff', 'in_transit', 'accepted'],
    ['ALPK', 'Already picked up', 'in_transit', 'accepted'],
    ['RS', 'The package was returned to the sender', 'exception', 'returned'],
    ['UD', 'The contents of the package are damaged', 'exception', 'exception'],
    ['NFRP', 'Order has been transferred to another carrier', 'in_transit', 'in_transit'],
  ])('interprets %s from its actual milestone rather than the portal presentation type', (code, description, status, stage) => {
    const value = payload();
    Object.assign(value.Packages[0].Events[0], { EventCode: code, EventShortDescription: description });
    const result = parseOntrac(value, NUMBER);
    expect(result).toMatchObject({ status, current_stage: stage, last_status_text: description });
    expect(result.events?.[0]).toMatchObject({ stage });
    expect(result).not.toHaveProperty('delivered_at');
    expect(result.expected_delivery).toBe('2026-01-03T20:00:00-08:00');
  });
  it.each(['DSPD', 'RRDV', 'NDMI', 'CTRF', 'PUKT', 'PURU'])('leaves generic or requested milestone %s unmapped', (code) => {
    const value = payload();
    Object.assign(value.Packages[0].Events[0], { EventCode: code, EventShortDescription: 'Provider request wording' });
    const result = parseOntrac(value, NUMBER);
    expect(result.status).toBe('unknown');
    expect(result).not.toHaveProperty('current_stage');
    expect(result.events?.[0]).not.toHaveProperty('stage');
    expect(result.last_status_text).toBe('Provider request wording');
  });
  it('drops duplicate rows and never retains recipient or proof data', () => {
    const value = payload(); value.Packages[0].Events.push(value.Packages[0].Events[0]);
    const result = parseOntrac(value, NUMBER);
    expect(result.events).toHaveLength(3);
    expect(JSON.stringify(result)).not.toMatch(/Private Recipient|Example Address|Private signature|secret-image|reference-secret|PostalCode/);
  });
  it('bounds requests, forwards cancellation and keeps generic missing-resource replies inconclusive', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(payload())));
    const signal = new AbortController().signal;
    await new OntracTracker({ fetcher }).fetch(NUMBER, { signal, budgetMs: 1000 });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://webtrack.ontrac.com/PackageServices/tracking/${NUMBER}`);
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ Title: 'Not Found', Status: 404 }), { status: 404 }));
    await expect(new OntracTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'indeterminate' });
    fetcher.mockResolvedValue(new Response('{}', { status: 503 }));
    await expect(new OntracTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'maintenance' });
    expect(normalizeOntracNumber('1ls 0000000000001')).toBe(NUMBER);
    expect(() => normalizeOntracNumber('123')).toThrow(TypeError);
  });
  it('preserves the upstream throttle window and rejection diagnostics', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Too many requests', {
      status: 429, headers: { 'Retry-After': '7200', 'Content-Type': 'text/plain' },
    }));
    await expect(new OntracTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({
      kind: 'rate_limited', retryAfterMs: 7_200_000,
      diagnostics: { body_signals: ['rate_limit_message'] },
      request: { method: 'GET', url: `https://webtrack.ontrac.com/PackageServices/tracking/${NUMBER}` },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
