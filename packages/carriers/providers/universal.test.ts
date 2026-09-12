// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { LookupRecord, StepRecord, StepRecorder } from '../core/telemetry';
import { TrawlClient } from '../core/transport';
import { UniversalTracker, UniversalTrackingError, universalSources, UNIVERSAL_SOURCES } from './universal';

const number = 'ZZ12345678900';
const identity = (value = number) => `<div class="tracking-info"><div class="parcel"><table class="parcel-attributes"><tr><td>Tracking number</td><td>${value}</td></tr></table></div></div>`;
const track17 = {
  meta: { code: 200 }, shipments: [{ number, code: 200, shipment: {
    tracking: { providers: [{ events: [{ time_utc: '2026-08-31T18:50:50Z', description: 'Delivered', stage: 'Delivered' }] }] },
  } }],
};
const parcels = { states: [{ date: '2026-08-18T03:04:00Z', status: 'Electronic information submitted by shipper' }] };
const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 201 });
const browserResponse = (source: '17TRACK' | 'ParcelsApp', data: unknown, overrides = {}) => new Response(JSON.stringify({
  url: source === '17TRACK' ? `https://t.17track.net/en#nums=${number}` : `https://parcelsapp.com/en/tracking/${number}`,
  html: identity(), statusCode: 200, tier: 3,
  capturedResponses: [{ url: source === '17TRACK' ? 'https://t.17track.net/track/restapi' : 'https://parcelsapp.com/api/v2/parcels',
    body: JSON.stringify(data), status: 200, truncated: false, base64Encoded: false }],
  ...overrides,
}));

describe('universal discovery chain', () => {
  it('keeps the persisted provider names and the opt-in position of Postal Ninja', () => {
    expect(UNIVERSAL_SOURCES).toEqual(['Ship24', 'ParcelsApp', '17TRACK']);
    expect(universalSources()).toEqual(['Ship24', 'ParcelsApp', '17TRACK']);
    expect(universalSources(true)).toEqual(['Ship24', 'ParcelsApp', 'Postal Ninja', '17TRACK']);
  });

  it('uses ParcelsApp after Ship24 fails and stops after success', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(parcels));
    const result = await new UniversalTracker({ trawlUrl: 'http://browser.test/v1', fetcher, browserLookup: vi.fn().mockRejectedValue(new Error('Unavailable')) }).fetch(number);
    expect(result.current_stage).toBe('registered');
    expect(result.tracking_provider).toBe('ParcelsApp');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://parcelsapp.com/api/v2/parcels');
    expect(new URLSearchParams(String(options!.body)).get('carrier')).toBe('Auto-Detect');
  });

  it('falls through an unrelated ParcelsApp result to 17TRACK', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ error: 'RELOAD' }))
      .mockResolvedValueOnce(browserResponse('ParcelsApp', parcels, { html: identity('OTHER123') }))
      .mockResolvedValueOnce(browserResponse('17TRACK', track17));
    const result = await new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher, browserLookup: vi.fn().mockRejectedValue(new Error('Unavailable')) }).fetch(number);
    expect(result.tracking_provider).toBe('17TRACK');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('retains provider failures for Sentry while keeping the lookup summary readable', async () => {
    const originalError = new Error('SECRET upstream cookie');
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(originalError);
    const error = await new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher, browserLookup: vi.fn().mockRejectedValue(new Error('Unavailable')) }).fetch(number).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'UniversalTrackingError' });
    expect(String(error)).not.toContain('SECRET');
    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toBeInstanceOf(UniversalTrackingError);
    expect((error as AggregateError).errors).toHaveLength(3);
    for (const providerError of (error as AggregateError).errors.slice(1)) {
      expect(providerError.cause).toBe(originalError);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('tries Postal Ninja before 17TRACK when Ship24 and ParcelsApp fail', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('Unavailable'));
    const browserLookup = vi.fn().mockRejectedValueOnce(new Error('Challenge'))
      .mockResolvedValueOnce({ status: 'delivered', current_stage: 'delivered', tracking_provider: 'Postal Ninja' });
    const result = await new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher, browserLookup, enablePostalNinja: true }).fetch(number);
    expect(result.tracking_provider).toBe('Postal Ninja');
    expect(browserLookup.mock.calls).toEqual([['Ship24', number], ['Postal Ninja', number]]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('can use the form scrapers without TRAWL and stops on Ship24 success', async () => {
    const browserLookup = vi.fn().mockResolvedValue({ tracking_provider: 'Ship24', current_stage: 'in_transit' });
    await expect(new UniversalTracker({ trawlUrl: '', browserLookup }).fetch(number)).resolves.toMatchObject({ tracking_provider: 'Ship24' });
    expect(browserLookup).toHaveBeenCalledOnce();
  });

  it('does not request arbitrary user URLs and validates identifiers before network access', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher }).fetch('http://localhost')).rejects.toThrow('Invalid tracking number');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('takes the browser service and the telemetry sink from the adapter environment', async () => {
    const steps: StepRecord[] = [];
    const lookups: LookupRecord[] = [];
    const recorder: StepRecorder = { step: (record) => { steps.push(record); }, lookup: (record) => { lookups.push(record); } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(browserResponse('17TRACK', track17));
    const tracker = new UniversalTracker({ environment: { trawl: new TrawlClient('http://browser.test', fetcher), recorder } });
    await expect(tracker.fetchSource('17TRACK', number, 20_000)).resolves.toMatchObject({ tracking_provider: '17TRACK' });
    expect(steps).toMatchObject([{ carrier: '17TRACK', step: 'trawl', attempt: 1, outcome: 'ok', fallbackFrom: null }]);
    expect(lookups).toMatchObject([{ carrier: '17TRACK', finalStep: 'trawl', outcome: 'ok', attempts: 1 }]);
    // The browser service is given whole milliseconds of the remaining budget.
    const { maxTimeout } = JSON.parse(String(fetcher.mock.calls[0][1]!.body)) as { maxTimeout: number };
    expect(Number.isInteger(maxTimeout)).toBe(true);
    expect(maxTimeout).toBeGreaterThan(19_000);
    expect(maxTimeout).toBeLessThanOrEqual(20_000);
  });

  it('submits a stored postcode to ParcelsApp without a browser service', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(parcels));
    const tracker = new UniversalTracker({ trawlUrl: '', fetcher,
      browserLookup: vi.fn().mockRejectedValue(new Error('Ship24 unavailable')) });
    await expect(tracker.fetchSource('ParcelsApp', number, 20_000, '01234')).resolves.toMatchObject({ tracking_provider: 'ParcelsApp' });
    await expect(tracker.fetch(number, '01234')).resolves.toMatchObject({ tracking_provider: 'ParcelsApp' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(new URLSearchParams(String(init!.body)).get('extra[zipcode]')).toBe('01234');
    }
  });

  it('forwards a stored delivery postcode into the provider track input', async () => {
    const ship24History = { data: { tracking_number: number,
      events: [{ timestamp: '2026-09-10T10:00:00+02:00', status: 'Delivered', dispatch_code_id: 7 }] } };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(ship24History));
    const tracker = new UniversalTracker({ fetcher });
    await expect(tracker.fetchSource('Ship24', number, 20_000, '8004')).resolves.toMatchObject({
      current_stage: 'delivered', tracking_provider: 'Ship24',
    });
    await expect(tracker.fetch(number, '8004')).resolves.toMatchObject({
      current_stage: 'delivered', tracking_provider: 'Ship24',
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
