import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonObject } from '../../core/types';
import { GLSGermanyTracker } from './adapter';

const NUMBER = '12345678901';

const capabilities = (JSON.parse(
  readFileSync(new URL('./carrier.json', import.meta.url), 'utf8'),
) as { capabilities: string[] }).capabilities;

function parcel(tuNo = NUMBER): JsonObject {
  const base = JSON.parse(
    readFileSync(new URL('./fixtures/parcel-delivered.json', import.meta.url), 'utf8'),
  ) as JsonObject;
  return { ...base, tuNo };
}

afterEach(() => vi.restoreAllMocks());

describe('GLS Germany', () => {
  it('resolves the Track ID then uses the five-digit postcode and verifies the detail identity', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel()] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(parcel())));
    const result = await new GLSGermanyTracker().fetch('AB12CD34', '01067');
    expect(result).toMatchObject({ status: 'delivered', timezone: 'Europe/Berlin', expected_delivery: null, canonical_tracking_number: NUMBER });
    expect(result.events?.map((event) => event.stage)).toEqual(['delivered', 'in_transit']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    const detail = new URL(String(fetcher.mock.calls[1][0]));
    expect(detail.pathname).toContain(`/rstt028/${NUMBER}`);
    expect(detail.searchParams.get('postalCode')).toBe('01067');
    expect(detail.searchParams.get('tuOwnerCode')).toBe('DE01');
  });

  it('covers every capability declared in carrier.json', async () => {
    expect(capabilities).toEqual([
      'history', 'location', 'eta', 'pickup_point', 'weight', 'delivered_at', 'provider_code',
    ]);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel()] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(parcel())));
    const result = await new GLSGermanyTracker().fetch(NUMBER, '10115');
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some((event) => event.location)).toBe(true);
    expect(result.delivered_at).toBe('2026-09-08T09:00:00+02:00');
    // The remaining declared capabilities (eta, pickup_point, weight,
    // provider_code) come from the shared parser and are covered by the
    // fixture-driven capability test in ../gls-ch/adapter.test.ts.
  });

  it('retains the Swiss delivery owner from the overview when detail omits it', async () => {
    const overview = parcel();
    (overview.owners as JsonObject[]).push({ type: 'DELIVERY', code: 'CH01' });
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [overview] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(parcel())));
    await expect(new GLSGermanyTracker().fetch(NUMBER, '8004')).resolves.toMatchObject({
      delivery_carrier: 'swiss-post', delivery_tracking_number: NUMBER,
    });
  });

  it('rejects a different detail shipment', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel()] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(parcel('99999999999'))));
    await expect(new GLSGermanyTracker().fetch(NUMBER, '10115')).rejects.toThrow('different shipment');
  });

  it('rejects a different overview before sending the postcode', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel('99999999999')] })));
    await expect(new GLSGermanyTracker().fetch(NUMBER, '10115')).rejects.toThrow('different shipment');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['', '800', '123456', 'ABCDE'])('rejects invalid postcode %s before the network request', async (postcode) => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(new GLSGermanyTracker().fetch(NUMBER, postcode)).rejects.toThrow('4- or 5-digit recipient postcode');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('resolves a printed 12-digit number to its matching 11-digit parcel and preserves the Swiss postcode', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel('99999999999'), parcel()] })))
      .mockResolvedValueOnce(new Response(JSON.stringify(parcel())));
    const result = await new GLSGermanyTracker().fetch(`${NUMBER}8`, ' 8004 ');
    expect(result.events).toHaveLength(2);
    const detail = new URL(String(fetcher.mock.calls[1][0]));
    expect(detail.pathname).toContain(`/rstt028/${NUMBER}`);
    expect(detail.searchParams.get('postalCode')).toBe('8004');
  });

  it('does not accept a different 11-digit parcel for a printed number', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel('99999999999')] })));
    await expect(new GLSGermanyTracker().fetch(`${NUMBER}8`, '8004')).rejects.toThrow('different shipment');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('verifies numeric GLS recognition against the official overview', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel()] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel('99999999999')] })));
    const tracker = new GLSGermanyTracker();
    await expect(tracker.recognizes(`${NUMBER}8`)).resolves.toBe(true);
    expect(String(fetcher.mock.calls[0][0])).toContain('/DE/en/rstt029');
    await expect(tracker.recognizes(NUMBER)).resolves.toBe(false);
    await expect(tracker.recognizes(NUMBER)).rejects.toThrow('different shipment');
  });

  it('keeps the positional timeout the carrier-detection route passes', async () => {
    const tracker = new GLSGermanyTracker(5_000);
    expect(tracker.timeoutMs).toBe(5_000);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ tuStatus: [parcel()] })));
    await expect(tracker.recognizes(NUMBER)).resolves.toBe(true);
  });

  it('recognizes the official expired-number response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ lastError: 'E000' }), { status: 404 }));
    await expect(new GLSGermanyTracker().fetch(NUMBER, '10115')).rejects.toMatchObject({ name: 'GLSGermanyTrackingError', status: 404 });
  });

  it.each([403, 429, 503])('keeps HTTP %i visible as an upstream error', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));
    await expect(new GLSGermanyTracker().fetch(NUMBER, '10115')).rejects.toMatchObject({ name: 'UpstreamHttpError', status });
  });
});
