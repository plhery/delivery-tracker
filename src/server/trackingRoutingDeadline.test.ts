// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { UpstreamHttpError } from './boundedFetch';
import { TrackingRouter } from './trackingRouting';
import { UniversalTracker } from './universalTracking';
import * as monitoring from './observability';

const number = 'TEST1234';
const stamp = '2026-01-05T12:00:00Z';
const browserReply = (source: string) => Response.json({
  url: source === 'ParcelsApp' ? `https://parcelsapp.com/en/tracking/${number}` : `https://t.17track.net/en#nums=${number}`,
  statusCode: 200, tier: 3,
  html: `<div class="tracking-info"><div class="parcel"><table class="parcel-attributes"><tr><td>Tracking number</td><td>${number}</td></tr></table></div></div>`,
  capturedResponses: [{ status: 200,
    url: source === 'ParcelsApp' ? 'https://parcelsapp.com/api/v2/parcels' : 'https://t.17track.net/track/restapi',
    body: JSON.stringify(source === 'ParcelsApp' ? { states: [{ date: stamp, status: 'In transit' }] }
      : { meta: { code: 200 }, shipments: [{ number, code: 200, shipment: {
        tracking: { providers: [{ events: [{ time_utc: stamp, description: 'In transit', stage: 'InTransit' }] }] },
      } }] }),
  }],
});

afterEach(() => vi.restoreAllMocks());

it.each(['direct', 'universal'])('reaches a real fallback after a slow %s failure leaves fractional milliseconds', async (slow) => {
  // Real Node AbortSignal.timeout rejects fractional milliseconds; jsdom's
  // implementation and a mocked universal adapter can both hide this bug.
  let elapsed = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  vi.spyOn(monitoring, 'reportRoutingEvent').mockImplementation(() => undefined);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
    if (slow === 'universal' && fetcher.mock.calls.length === 1) {
      elapsed += 35_000.5;
      return new Response('', { status: 503 });
    }
    return browserReply(slow === 'direct' ? 'ParcelsApp' : '17TRACK');
  });
  const tracker = new UniversalTracker({ trawlUrl: 'http://browser.test', fetcher,
    browserLookup: async () => { elapsed += 35_000.25; throw new Error('Ship24 timeout'); },
  });
  const router = new TrackingRouter({
    direct: async () => { elapsed = 46_366.731; throw new UpstreamHttpError('DHL eCommerce', 428); },
    universal: (source, trackingNumber, timeoutMs) => tracker.fetchSource(source, trackingNumber, timeoutMs),
    health: {
      acquireTrackingProvider: async () => ({ token: 'test-lease', retry_at: stamp }),
      finishTrackingProvider: async () => {},
    },
  });
  const result = await router.fetch({ carrier: slow === 'direct' ? 'dhl-ecommerce' : 'unknown', tracking_number: number,
    ...(slow === 'universal' ? { carrier_data: { routing: { version: 1, configured_carrier: 'unknown', preferred_provider: 'Ship24' } } } : {}),
  }, false);
  expect(result.result.tracking_provider).toBe(slow === 'direct' ? 'ParcelsApp' : '17TRACK');
  expect(fetcher).toHaveBeenCalledTimes(slow === 'direct' ? 1 : 2);
  const sent = JSON.parse(String(fetcher.mock.calls.at(-1)![1]?.body));
  expect(Number.isInteger(sent.maxTimeout)).toBe(true);
  expect(sent.maxTimeout).toBeLessThanOrEqual(slow === 'direct' ? 30_000 : 29_999.25);
});
