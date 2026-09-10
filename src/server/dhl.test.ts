import { afterEach, describe, expect, it, vi } from 'vitest';
import { DHLSessionError, DHLTracker, dhlTrackingUrl, normalizeDHLTrackingNumber, parseDHLTrackingResponse } from './dhl';
import { CarrierTrackingAdapter } from './trackingSync';

const NUMBER = 'LF123456785DE';
const CONFIG = 'https://www.dhl.de/int-verfolgen/data/config?domain=de&language=en';
const SEARCH = `https://www.dhl.de/int-verfolgen/data/search?piececode=${NUMBER}&noRedirect=true&language=en`;

function shipment(overrides: Record<string, unknown> = {}) {
  return {
    sendungen: [{
      id: NUMBER, hasCompleteDetails: true,
      sendungsinfo: { gesuchteSendungsnummer: NUMBER, empfaenger: 'Private recipient' },
      sendungsdetails: {
        sendungsnummern: { sendungsnummer: NUMBER },
        sendungsverlauf: {
          status: 'Sortierung im Briefzentrum', datumAktuellerStatus: '2026-08-10T18:30:00+02:00',
          fortschritt: 3, maximalFortschritt: 5,
          events: [
            { datum: '2026-08-09T20:00:00+02:00', status: 'The instruction data for this shipment have been provided by the sender to DHL electronically' },
            { datum: '2026-08-10T18:30:00+02:00', ort: 'Germany', status: 'Die Sendung wurde im Briefzentrum bearbeitet.', secret: 'Private event detail' },
          ],
        },
        istZugestellt: false,
        zustellung: { empfaenger: 'Private recipient', unterschrift: 'Private signature', zustellzeitfensterVon: '2026-08-12T09:00:00+02:00' },
        services: { address: 'Private street address' },
        ...overrides,
      },
    }], rateLimited: false,
  };
}

function config(token = 'test-csrf') {
  const response = Response.json({ verfolgenCsrfToken: token, initialWG: 0 }, {
    headers: { 'Set-Cookie': `verfolgenCsrfToken=${token}; Path=/; Secure` },
  });
  Object.defineProperty(response, 'url', { value: CONFIG });
  return response;
}

afterEach(() => vi.restoreAllMocks());

describe('DHL public tracking normalization', () => {
  it('keeps the correct event order, stages and dates without private recipient data', () => {
    const result = parseDHLTrackingResponse(shipment(), NUMBER);
    expect(result).toMatchObject({
      status: 'in_transit', current_stage: 'in_transit', timezone: 'Europe/Berlin',
      last_update: '2026-08-10T18:30:00+02:00', expected_delivery: '2026-08-12',
      events: [
        { stage: 'in_transit', location: 'Germany', time: '2026-08-10T18:30:00+02:00' },
        { stage: 'registered', time: '2026-08-09T20:00:00+02:00' },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('Private');
    expect(JSON.stringify(result)).not.toContain(NUMBER);
  });

  it.each([
    ['The shipment has been loaded into the delivery vehicle', 'out_for_delivery', 'out_for_delivery'],
    ['Die Sendung wurde in das Zustellfahrzeug geladen.', 'out_for_delivery', 'out_for_delivery'],
    ['The shipment could not be delivered', 'failed_attempt', 'exception'],
    ['Die Sendung konnte nicht zugestellt werden.', 'failed_attempt', 'exception'],
    ['Die Sendung wurde nicht erfolgreich zugestellt.', 'failed_attempt', 'exception'],
    ['The shipment is ready for collection', 'ready_for_pickup', 'out_for_delivery'],
    ['Die Sendung liegt zur Abholung bereit.', 'ready_for_pickup', 'out_for_delivery'],
    ['The shipment is being processed by customs', 'customs', 'in_transit'],
    ['The customs clearance process for import into the destination country/region has been completed. Please find more information here.', 'in_transit', 'in_transit'],
    ['The customs clearance process for import into the destination country/region has started. Please find more information here.', 'customs', 'in_transit'],
    ['The shipment will be transported to the destination country/destination area and, from there, handed over to the delivery organization.', 'in_transit', 'in_transit'],
    ['The shipment was handed over to DHL.', 'accepted', 'in_transit'],
    ['The shipment is being prepared for delivery in the delivery depot', 'in_transit', 'in_transit'],
    ['The shipment is returning to sender', 'returned', 'exception'],
    ['The shipment has been delivered', 'delivered', 'delivered'],
    ['Die Sendung wurde erfolgreich zugestellt.', 'delivered', 'delivered'],
  ])('maps %s without confusing future or failed delivery with delivery', (text, stage, status) => {
    const result = parseDHLTrackingResponse(shipment({
      sendungsverlauf: { status: text, fortschritt: 4, events: [{ status: text, datum: '2026-08-10T10:00:00Z' }] },
    }), NUMBER);
    expect(result.current_stage).toBe(stage);
    expect(result.status).toBe(status);
    expect(result.events?.[0]?.stage).toBe(stage);
  });

  it('uses the explicit delivered flag and removes stale estimates', () => {
    expect(parseDHLTrackingResponse(shipment({ istZugestellt: true }), NUMBER)).toMatchObject({
      status: 'delivered', current_stage: 'delivered', expected_delivery: null,
    });
    expect(parseDHLTrackingResponse(shipment({ istZugestellt: true, ruecksendung: true }), NUMBER))
      .toMatchObject({ status: 'exception', current_stage: 'returned', expected_delivery: null });
    expect(parseDHLTrackingResponse(shipment({ zustellung: { zustellzeitfensterVon: '2026-02-30' } }), NUMBER).expected_delivery).toBeNull();
  });

  it('does not treat a planned delivery as completed', () => {
    const result = parseDHLTrackingResponse(shipment({
      sendungsverlauf: { status: 'The shipment will be delivered tomorrow', fortschritt: 3, events: [] },
    }), NUMBER);
    expect(result.current_stage).toBe('in_transit');
  });

  it('accepts only an explicit no-data result for the requested number', () => {
    const payload = { sendungen: [{ id: NUMBER, sendungNichtGefunden: { keineDatenVerfuegbar: true } }] };
    expect(parseDHLTrackingResponse(payload, NUMBER)).toMatchObject({ status: 'unknown', events: [] });
    expect(() => parseDHLTrackingResponse(payload, 'LF000000005DE')).toThrow('matching shipment');
    expect(() => parseDHLTrackingResponse({ sendungen: [] }, NUMBER)).toThrow('empty tracking response');
    expect(() => parseDHLTrackingResponse({ sendungen: [{ id: NUMBER }] }, NUMBER)).toThrow('no usable tracking status');
    expect(() => parseDHLTrackingResponse({ sendungen: [...payload.sendungen, ...payload.sendungen] }, NUMBER)).toThrow('one matching shipment');
    expect(() => parseDHLTrackingResponse({ rateLimited: true }, NUMBER)).toThrow('HTTP 429');
  });

  it('does not silently treat other DHL services or required verification as unannounced', () => {
    expect(() => parseDHLTrackingResponse({ sendungen: [{ id: NUMBER, plzBenoetigt: true }] }, NUMBER)).toThrow('verification');
    expect(() => parseDHLTrackingResponse({ sendungen: [{ id: NUMBER, sendungNichtGefunden: { keineDhlPaketSendung: true } }] }, NUMBER)).toThrow('own tracking website');
  });

  it('normalizes safe identifiers and builds an official tracking link', () => {
    expect(normalizeDHLTrackingNumber('lf 123.456-785 de')).toBe(NUMBER);
    expect(dhlTrackingUrl(NUMBER)).toBe(`https://www.dhl.de/en/privatkunden/dhl-sendungsverfolgung.html?piececode=${NUMBER}`);
    expect(() => normalizeDHLTrackingNumber('https://evil.example')).toThrow('invalid');
  });
});

describe('DHL sessions and browser fallback', () => {
  it('uses the public config, CSRF cookie and WG header, then reuses the session', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(config())
      .mockResolvedValueOnce(Response.json(shipment(), { headers: { 'verfolgen-CSRF-token': 'rotated-csrf' } }))
      .mockResolvedValueOnce(Response.json(shipment()));
    const tracker = new DHLTracker({ trawlUrl: '' });
    expect((await tracker.fetch(NUMBER)).events).toHaveLength(2);
    await tracker.fetch(NUMBER);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[0][0])).toBe(CONFIG);
    expect(String(fetcher.mock.calls[1][0])).toBe(SEARCH);
    const first = new Headers(fetcher.mock.calls[1][1]?.headers);
    expect(first.get('verfolgen-CSRF-token')).toBe('test-csrf');
    expect(first.get('verfolgen-wg')).toBe('0');
    expect(first.get('cookie')).toContain('verfolgenCsrfToken=test-csrf');
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('verfolgen-CSRF-token')).toBe('rotated-csrf');
  });

  it('uses the configured private browser for a rejected session', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('<html>Challenge</html>', { headers: { 'Content-Type': 'text/html' } }))
      .mockResolvedValueOnce(Response.json({ tier: 3, statusCode: 200, userAgent: 'Browser UA', cookies: [
        { name: 'ak_bmsc', value: 'browser-proof', domain: '.dhl.de', path: '/', secure: true },
        { name: 'unrelated', value: 'private-other-site', domain: 'evil-dhl.de', path: '/' },
      ] }))
      .mockResolvedValueOnce(config())
      .mockResolvedValueOnce(Response.json(shipment()));
    const result = await new DHLTracker({ trawlUrl: 'http://trawl:8191/v1' }).fetch(NUMBER);
    expect(result.current_stage).toBe('in_transit');
    expect(String(fetcher.mock.calls[1][0])).toBe('http://trawl:8191/scrape');
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ skipHttp: true, maxTier: 3, url: dhlTrackingUrl(NUMBER) });
    const headers = new Headers(fetcher.mock.calls[2][1]?.headers);
    expect(headers.get('user-agent')).toBe('Browser UA');
    expect(headers.get('cookie')).toContain('browser-proof');
    expect(headers.get('cookie')).not.toContain('private-other-site');
  });

  it('renews an expired session with HTTP before attempting a browser', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(config()).mockResolvedValueOnce(Response.json(shipment()))
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(config('renewed')).mockResolvedValueOnce(Response.json(shipment()));
    const tracker = new DHLTracker({ trawlUrl: 'http://trawl:8191' });
    await tracker.fetch(NUMBER);
    await tracker.fetch(NUMBER);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(String(fetcher.mock.calls[3][0])).toBe(CONFIG);
  });

  it.each(['config', 'search', 'body', 'cached'])('recovers from an interrupted %s request with one fresh session', async (phase) => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const tracker = new DHLTracker({ trawlUrl: 'http://trawl:8191' });
    if (phase === 'cached') {
      fetcher.mockResolvedValueOnce(config()).mockResolvedValueOnce(Response.json(shipment()));
      await tracker.fetch(NUMBER);
      fetcher.mockClear();
    } else if (phase !== 'config') {
      fetcher.mockResolvedValueOnce(config());
    }
    const timeout = new DOMException('Timed out', 'TimeoutError');
    if (phase === 'body') {
      fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) { controller.error(timeout); } }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    } else {
      fetcher.mockRejectedValueOnce(timeout);
    }
    fetcher.mockResolvedValueOnce(config('renewed')).mockResolvedValueOnce(Response.json(shipment()));
    expect((await tracker.fetch(NUMBER)).current_stage).toBe('in_transit');
    expect(fetcher).toHaveBeenCalledTimes(['search', 'body'].includes(phase) ? 4 : 3);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('trawl'))).toBe(false);
  });

  it('uses the browser when fresh direct sessions also time out', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json({ tier: 3, statusCode: 200, cookies: [] }))
      .mockResolvedValueOnce(config()).mockResolvedValueOnce(Response.json(shipment()));
    const tracker = new DHLTracker({ trawlUrl: 'http://trawl:8191' });
    expect((await tracker.fetch(NUMBER)).events).toHaveLength(2);
    expect(String(fetcher.mock.calls[2][0])).toBe('http://trawl:8191/scrape');
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('bounds repeated network failures and allows the next sync to recover', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
    const tracker = new DHLTracker({ trawlUrl: '' });
    await expect(tracker.fetch(NUMBER)).rejects.toMatchObject({ name: 'UpstreamNetworkError' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockReset().mockResolvedValueOnce(config()).mockResolvedValueOnce(Response.json(shipment()));
    expect((await tracker.fetch(NUMBER)).current_stage).toBe('in_transit');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([429, 500, 503])('does not bypass HTTP %s using the browser', async (status) => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status }));
    await expect(new DHLTracker({ trawlUrl: 'http://trawl:8191' }).fetch(NUMBER)).rejects.toMatchObject({ status });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not downgrade malformed data, rejected challenges or missing results to a waiting parcel', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Challenge', { status: 403 }));
    await expect(new DHLTracker({ trawlUrl: '' }).fetch(NUMBER)).rejects.toBeInstanceOf(DHLSessionError);
    fetcher.mockReset().mockResolvedValueOnce(config()).mockResolvedValueOnce(Response.json({ error: 'Private upstream details' }));
    await expect(new DHLTracker({ trawlUrl: 'http://trawl:8191' }).fetch(NUMBER)).rejects.toThrow('invalid tracking response');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('connects the DHL capability to the sync adapter', async () => {
    const adapter = new CarrierTrackingAdapter();
    const fetcher = vi.spyOn(adapter.dhl, 'fetch').mockResolvedValue(parseDHLTrackingResponse(shipment(), NUMBER));
    expect((await adapter.fetch('dhl', NUMBER, null)).current_stage).toBe('in_transit');
    expect(fetcher).toHaveBeenCalledWith(NUMBER);
  });
});
