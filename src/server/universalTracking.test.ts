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

  it.each(['json', 'html'])('classifies French preparation and carrier acceptance separately (%s)', (transport) => {
    // Synthetic identifier, dates and depot; preserve only the wording that caused the bug.
    const states = [
      { date: '2026-01-05T08:30:00Z', status: 'Prise en charge de votre colis sur notre site logistique de VILLE-EXEMPLE.' },
      { date: '2026-01-04T09:15:00Z', status: "Colis en préparation chez l'expéditeur" },
    ];
    const html = identity().replace('</table>', `</table><ul class="events">
      <li class="event"><div class="event-time"><strong>05 Jan 2026</strong><span>08:30</span></div>
        <div class="event-content"><strong>${states[0].status}</strong></div></li>
      <li class="event"><div class="event-time"><strong>04 Jan 2026</strong><span>09:15</span></div>
        <div class="event-content"><strong>${states[1].status}</strong></div></li></ul>`);
    const parsed = transport === 'json' ? parseParcelsAppResponse({ states }, number, identity())
      : parseParcelsAppHtml(html, number);
    expect(parsed).toMatchObject({ status: 'in_transit', current_stage: 'accepted',
      last_update: '2026-01-05T08:30:00.000Z', tracking_provider: 'ParcelsApp' });
    expect(parsed.events?.map(({ stage }) => stage)).toEqual(['accepted', 'registered']);
    const preparationOnly = parseParcelsAppResponse({ states: [states[1]] }, number, identity());
    expect(preparationOnly).toMatchObject({ status: 'pending', current_stage: 'registered' });
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

  it('uses ParcelsApp first and stops after success', async () => {
    const fetcher = vi.fn().mockResolvedValue(browserResponse('ParcelsApp', parcels));
    const result = await new UniversalTracker({ trawlUrl: 'http://browser.test/v1', fetcher }).fetch(number);
    expect(result.current_stage).toBe('registered');
    expect(result.tracking_provider).toBe('ParcelsApp');
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://browser.test/scrape');
    expect(JSON.parse(options.body)).toMatchObject({ skipHttp: true, captureResponses: ['https://parcelsapp.com/api/v2/parcels'] });
  });

  it('falls through an unrelated ParcelsApp result to 17TRACK', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(browserResponse('ParcelsApp', parcels, { html: identity('OTHER123') }))
      .mockResolvedValueOnce(browserResponse('17TRACK', track17()));
    const result = await new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher }).fetch(number);
    expect(result.tracking_provider).toBe('17TRACK');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('exposes a provider 429 to the routing cooldown instead of masking it as invalid HTML', async () => {
    const fetcher = vi.fn().mockResolvedValue(browserResponse('17TRACK', null, { statusCode: 429 }));
    await expect(new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher }).fetchSource('17TRACK', number))
      .rejects.toMatchObject({ name: 'UpstreamHttpError', status: 429 });
  });

  it('retains provider failures for Sentry while keeping the lookup summary readable', async () => {
    const originalError = new Error('SECRET upstream cookie');
    const fetcher = vi.fn().mockRejectedValue(originalError);
    const error = await new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher }).fetch(number).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'UniversalTrackingError' });
    expect(String(error)).not.toContain('SECRET');
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(3);
    for (const providerError of (error as AggregateError).errors.slice(0, 2)) {
      expect(providerError.cause).toBe(originalError);
    }
    expect(isUnannouncedTrackingError(error)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('tries Ship24 then Postal Ninja after the earlier providers fail', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Unavailable'));
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

  it('rejects redirected, truncated, binary and error pages', async () => {
    for (const overrides of [{ url: 'https://evil.test/' }, { statusCode: 403 }, { tier: 1 },
      { capturedResponses: [{ url: 'https://t.17track.net/track/restapi', body: JSON.stringify(track17()), status: 200, truncated: true }] },
      { capturedResponses: [{ url: 'https://t.17track.net/track/restapi', body: JSON.stringify(track17()), status: 200, base64Encoded: true }] }]) {
      const fetcher = vi.fn().mockResolvedValueOnce(browserResponse('17TRACK', track17(), overrides)).mockRejectedValueOnce(new Error());
      await expect(new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher }).fetchSource('17TRACK', number)).rejects.toThrow();
    }
  });

  it('distinguishes missing solver capability, unreadable bodies and provider lookup failures', async () => {
    for (const [data, overrides, expected] of [
      [null, { capturedResponses: undefined }, { name: 'TrackingCaptureError', reason: 'capture_missing' }],
      [null, { capturedResponses: [{ url: 'https://t.17track.net/track/restapi', status: 200,
        body: null, error: 'compressed gzip body was not read safely' }] }, { reason: 'capture_unreadable' }],
      [{ meta: { code: 200 }, shipments: [{ number, code: 400, shipment: null }] }, {},
        { name: 'SeventeenTrackLookupError', reason: 'lookup_unavailable', providerCode: 400 }],
      [{ meta: { code: -14 }, shipments: [] }, {}, { name: 'SeventeenTrackVerificationError', providerCode: -14 }],
    ] as const) {
      const fetcher = vi.fn().mockResolvedValue(browserResponse('17TRACK', data, overrides));
      await expect(new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher }).fetchSource('17TRACK', number))
        .rejects.toMatchObject(expected);
    }
  });

  it('accepts completed matching history after intermediate polling and keeps API Retry-After', async () => {
    const url = 'https://t.17track.net/track/restapi';
    const fetcher = vi.fn().mockResolvedValue(browserResponse('17TRACK', null, { capturedResponses: [
      { url, status: 200, body: JSON.stringify({ meta: { code: 200 }, shipments: [{ number, code: 100 }] }) },
      { url, status: 200, body: JSON.stringify(track17()) },
    ] }));
    const tracker = new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher });
    await expect(tracker.fetchSource('17TRACK', number)).resolves.toMatchObject({ tracking_provider: '17TRACK' });
    fetcher.mockResolvedValue(browserResponse('17TRACK', null, { capturedResponses: [
      { url, status: 429, body: null, headers: { 'retry-after': '300' } },
    ] }));
    await expect(tracker.fetchSource('17TRACK', number)).rejects.toMatchObject({ status: 429, retryAfterMs: 300_000 });
    fetcher.mockResolvedValue(browserResponse('17TRACK', null, { capturedResponses: [{ url, status: 503, body: null }] }));
    await expect(tracker.fetchSource('17TRACK', number)).rejects.toMatchObject({ name: 'UpstreamHttpError', status: 503 });
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
