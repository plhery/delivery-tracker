import { describe, expect, it, vi } from 'vitest';
import { isUnannouncedTrackingError, CarrierTrackingAdapter } from './trackingSync';
import { parse17TrackResponse, parseParcelsAppHtml, parseParcelsAppResponse, UniversalTracker } from './universalTracking';

const number = 'ZZ12345678900';
const identity = (value = number) => `<div class="tracking-info"><div class="parcel"><table class="parcel-attributes"><tr><td>Tracking number</td><td>${value}</td></tr></table></div></div>`;
const track17 = (value = number) => ({
  meta: { code: 200 }, shipments: [{ number: value, code: 200, shipment: {
    shipping_info: { recipient_address: { street: 'PRIVATE' } },
    tracking: { providers: [{ events: [
      { time_utc: '2026-08-31T18:50:50Z', description: 'Delivered', stage: 'Delivered', address: 'PRIVATE' },
      { time_iso: '2026-08-31T11:12:44-06:00', description: 'Item out for delivery', stage: 'OutForDelivery' },
    ] }] },
  } }],
});
const parcels = { status: 'transit', sender: 'PRIVATE', states: [
  { date: '2026-08-18T06:49:00Z', status: 'Delivery preference - Front door' },
  { date: '2026-08-18T03:04:00Z', status: 'Electronic information submitted by shipper' },
] };
const browserResponse = (source: '17TRACK' | 'ParcelsApp', data: unknown, overrides = {}) => new Response(JSON.stringify({
  url: source === '17TRACK' ? `https://t.17track.net/en#nums=${number}` : `https://parcelsapp.com/en/tracking/${number}`,
  html: identity(), statusCode: 200, tier: 3,
  capturedResponses: [{ url: source === '17TRACK' ? 'https://t.17track.net/track/restapi' : 'https://parcelsapp.com/api/v2/parcels',
    body: JSON.stringify(data), status: 200, truncated: false, base64Encoded: false }],
  ...overrides,
}));

describe('universal public tracking', () => {
  it('uses matching 17TRACK history and strips recipient data', () => {
    const result = parse17TrackResponse(track17(), number);
    expect(result).toMatchObject({ current_stage: 'delivered', tracking_provider: '17TRACK', last_update: '2026-08-31T18:50:50.000Z' });
    expect(result.events?.[1]).toMatchObject({ stage: 'out_for_delivery', time: '2026-08-31T17:12:44.000Z' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('rejects demos, ambiguity, unfinished polling and verification errors', () => {
    for (const payload of [track17('TestNumber00017'), { ...track17(), shipments: [track17().shipments[0], track17().shipments[0]] },
      { meta: { code: -14 }, shipments: [] }, { meta: { code: 200 }, shipments: [{ number, code: 100 }] }]) {
      expect(() => parse17TrackResponse(payload, number)).toThrow();
    }
  });

  it('does not treat postal-code prompts or delivery preferences as movement', () => {
    const result = parseParcelsAppResponse(parcels, number, identity());
    expect(result).toMatchObject({ status: 'pending', current_stage: 'registered', tracking_provider: 'ParcelsApp' });
    expect(result.events).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(() => parseParcelsAppResponse({ states: [{ date: '2026-08-18T00:00:00Z', status: 'Enter the recipient postal code', require_fields: [{}] }] }, number, identity())).toThrow();
  });

  it('binds a numberless ParcelsApp response to its rendered result', () => {
    for (const html of [identity('OTHER123'), `<input value="${number}">`, identity() + identity()]) {
      expect(() => parseParcelsAppResponse(parcels, number, html)).toThrow();
    }
  });

  it('rejects malformed timestamps and error-only responses', () => {
    for (const date of ['today', '2026-08-18T03:04:00', '2026-02-31T03:04:00Z']) {
      expect(() => parseParcelsAppResponse({ states: [{ date, status: 'Delivered' }] }, number, identity())).toThrow();
    }
    expect(() => parseParcelsAppResponse({ error: 'NO_TRACKER', states: [] }, number, identity())).toThrow();
  });

  it('keeps unknown historical wording pending rather than inheriting delivered', () => {
    const result = parseParcelsAppResponse({ states: [
      { date: '2026-08-18T03:04:00Z', status: 'Delivered by mailbox, PIN: PRIVATE' },
      { date: '2026-08-17T03:04:00Z', status: 'Additional information provided' },
    ] }, number, identity());
    expect(result.current_stage).toBe('delivered');
    expect(result.events?.[1].stage).toBe('pending');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('parses legacy rendered ParcelsApp history without parsing the surrounding marketing copy', () => {
    const html = identity().replace('</table>', `</table><ul class="events"><li class="event"><div class="event-time"><strong>18 Aug 2026</strong><span>03:04</span></div><div class="event-content"><strong>Electronic information submitted by shipper</strong></div></li></ul>`);
    expect(parseParcelsAppHtml(html + '<p>Delivered 2026-09-01</p>', number)).toMatchObject({ current_stage: 'registered', last_update: '2026-08-18T03:04:00.000Z' });
  });

  it('uses 17TRACK first and stops after success', async () => {
    const fetcher = vi.fn().mockResolvedValue(browserResponse('17TRACK', track17()));
    const result = await new UniversalTracker({ trawlUrl: 'http://browser.test/v1', fetcher }).fetch(number);
    expect(result.current_stage).toBe('delivered');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://browser.test/scrape');
    expect(JSON.parse(options.body)).toMatchObject({ skipHttp: true, captureResponses: ['https://t.17track.net/track/restapi'] });
  });

  it('falls through challenges and unrelated responses to ParcelsApp', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(browserResponse('17TRACK', track17('OTHER123')))
      .mockResolvedValueOnce(browserResponse('ParcelsApp', parcels));
    const result = await new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher }).fetch(number);
    expect(result.tracking_provider).toBe('ParcelsApp');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('surfaces failed lookups without inventing not-found, timestamps or leaking responses', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('SECRET upstream cookie'));
    const error = await new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher }).fetch(number).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'UniversalTrackingError' });
    expect(String(error)).not.toContain('SECRET');
    expect(isUnannouncedTrackingError(error)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects redirected, truncated, binary and error pages', async () => {
    for (const overrides of [{ url: 'https://evil.test/' }, { statusCode: 403 }, { tier: 1 },
      { capturedResponses: [{ url: 'https://t.17track.net/track/restapi', body: JSON.stringify(track17()), status: 200, truncated: true }] },
      { capturedResponses: [{ url: 'https://t.17track.net/track/restapi', body: JSON.stringify(track17()), status: 200, base64Encoded: true }] }]) {
      const fetcher = vi.fn().mockResolvedValueOnce(browserResponse('17TRACK', track17(), overrides)).mockRejectedValueOnce(new Error());
      await expect(new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher }).fetch(number)).rejects.toThrow('Automatic carrier lookup');
    }
  });

  it('does not request arbitrary user URLs and validates identifiers before network access', async () => {
    const fetcher = vi.fn();
    await expect(new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher }).fetch('http://localhost')).rejects.toThrow('Invalid tracking number');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('dispatches unknown and international postal carriers to automatic lookup', async () => {
    const adapter = new CarrierTrackingAdapter();
    const spy = vi.spyOn(adapter.universal, 'fetch').mockResolvedValue({ status: 'delivered', current_stage: 'delivered' });
    for (const carrier of ['unknown', 'intl-post']) {
      expect(await adapter.fetch(carrier, number, 'https://untrusted.test')).toMatchObject({ current_stage: 'delivered' });
    }
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(number);
  });

  it('dispatches the added regional carriers without falling back to a generic adapter', async () => {
    const adapter = new CarrierTrackingAdapter();
    const expected = { status: 'delivered' as const, current_stage: 'delivered' };
    const hermes = vi.spyOn(adapter.hermesGermany, 'fetch').mockResolvedValue(expected);
    const gls = vi.spyOn(adapter.glsGermany, 'fetch').mockResolvedValue(expected);
    const laPoste = vi.spyOn(adapter.laPoste, 'fetch').mockResolvedValue(expected);
    await adapter.fetch('hermes-de', 'H1234567890123456789', null);
    await adapter.fetch('gls-de', '12345678901', null, '01067');
    await adapter.fetch('delivengo', 'LD123456785FR', null);
    expect(hermes).toHaveBeenCalledWith('H1234567890123456789');
    expect(gls).toHaveBeenCalledWith('12345678901', '01067');
    expect(laPoste).toHaveBeenCalledWith('LD123456785FR');
  });
});
