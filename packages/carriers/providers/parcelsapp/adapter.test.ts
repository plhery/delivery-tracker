// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TrawlClient } from '../../core/transport';
import { carrierErrorKind } from '../../core/errors';
import type { LookupRecord, StepRecord, StepRecorder } from '../../core/telemetry';
import { ParcelsAppTracker, parseParcelsAppHtml, parseParcelsAppResponse } from './adapter';

const number = 'ZZ12345678900';
const API = 'https://parcelsapp.com/api/v2/parcels';
const announced = JSON.parse(readFileSync(new URL('./fixtures/announced.json', import.meta.url), 'utf8')) as { states: unknown[] };

/** The result table the page renders; the API reply itself carries no number. */
const identity = (value = number) => `<div class="tracking-info"><div class="parcel"><table class="parcel-attributes"><tr><td>Tracking number</td><td>${value}</td></tr></table></div></div>`;
const rendered = (rows: string) => identity().replace('</table>', `</table><ul class="events">${rows}</ul>`);
const row = (date: string, time: string, description: string) =>
  `<li class="event"><div class="event-time"><strong>${date}</strong><span>${time}</span></div><div class="event-content"><strong>${description}</strong></div></li>`;

const captured = (data: unknown, overrides: Record<string, unknown> = {}) => new Response(JSON.stringify({
  url: `https://parcelsapp.com/en/tracking/${number}`, html: identity(), statusCode: 200, tier: 3,
  capturedResponses: [{ url: API, body: JSON.stringify(data), status: 200, truncated: false, base64Encoded: false }],
  ...overrides,
}));

function tracker(fetcher: typeof fetch, trawlUrl = 'http://browser.test') {
  return new ParcelsAppTracker({ httpClient: null, trawl: new TrawlClient(trawlUrl, fetcher) });
}

describe('ParcelsApp result parsing', () => {
  it('does not treat postal-code prompts or delivery preferences as movement', () => {
    const result = parseParcelsAppResponse(announced, number, identity());
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
    const parsed = transport === 'json' ? parseParcelsAppResponse({ states }, number, identity())
      : parseParcelsAppHtml(rendered(row('05 Jan 2026', '08:30', states[0].status) + row('04 Jan 2026', '09:15', states[1].status)), number);
    expect(parsed).toMatchObject({ status: 'in_transit', current_stage: 'accepted',
      last_update: '2026-01-05T08:30:00.000Z', tracking_provider: 'ParcelsApp' });
    expect(parsed.events?.map(({ stage }) => stage)).toEqual(['accepted', 'registered']);
    const preparationOnly = parseParcelsAppResponse({ states: [states[1]] }, number, identity());
    expect(preparationOnly).toMatchObject({ status: 'pending', current_stage: 'registered' });
  });

  it('binds a numberless response to its rendered result', () => {
    for (const html of [identity('OTHER123'), `<input value="${number}">`, identity() + identity()]) {
      expect(() => parseParcelsAppResponse(announced, number, html)).toThrow('identity missing');
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

  it('parses rendered history without parsing the surrounding marketing copy', () => {
    const html = rendered(row('18 Aug 2026', '03:04', 'Electronic information submitted by shipper'));
    expect(parseParcelsAppHtml(html + '<p>Delivered 2026-09-01</p>', number))
      .toMatchObject({ current_stage: 'registered', last_update: '2026-08-18T03:04:00.000Z' });
  });

  it('skips notice rows that render a date without a time', () => {
    // Observed live on 2026-09-11 for a not-yet-scanned Colissimo label.
    const notice = row('11 Sep 2026', '', "No information about your package. We've checked all relevant couriers for «Suisse». If the country is not correct, please select the destination country below.");
    const scan = row('10 Sep 2026', '08:30', 'Electronic information submitted by shipper');
    expect(parseParcelsAppHtml(rendered(notice + scan), number)).toMatchObject({ current_stage: 'registered', last_update: '2026-09-10T08:30:00.000Z' });
    expect(() => parseParcelsAppHtml(rendered(notice), number)).toThrow('No usable tracking events');
    expect(() => parseParcelsAppHtml(rendered(row('today', '08:30', 'Electronic information submitted by shipper')), number)).toThrow('invalid event date');
  });
});

describe('ParcelsApp browser capture', () => {
  it('asks the browser service for the page and reads its captured API response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(captured(announced));
    await expect(tracker(fetcher, 'http://browser.test/v1').fetch(number)).resolves.toMatchObject({ tracking_provider: 'ParcelsApp', current_stage: 'registered' });
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('http://browser.test/scrape');
    expect(JSON.parse(String(options!.body))).toMatchObject({
      url: `https://parcelsapp.com/en/tracking/${number}`, skipHttp: true, maxTier: 3,
      captureResponses: [API], settleTimeout: 15_000,
    });
  });

  it('falls back to the rendered history when no API body was captured', async () => {
    const html = rendered(row('18 Aug 2026', '03:04', 'Electronic information submitted by shipper'));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(captured(null, { html, capturedResponses: [] }));
    await expect(tracker(fetcher).fetch(number)).resolves.toMatchObject({ current_stage: 'registered', last_update: '2026-08-18T03:04:00.000Z' });
  });

  it('rejects a page rendered for another shipment instead of reporting its history', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(captured(announced, { html: identity('OTHER123') }));
    await expect(tracker(fetcher).fetch(number)).rejects.toThrow('identity missing');
  });

  it('needs the browser service and never requests an arbitrary user URL', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(new ParcelsAppTracker({ httpClient: null }).fetch(number)).rejects.toThrow('tracking browser service');
    await expect(tracker(fetcher).fetch('http://localhost')).rejects.toThrow('Invalid tracking number');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('ParcelsApp direct lookup', () => {
  const reply = (data: unknown) => new Response(JSON.stringify(data));
  const prompt = { states: [{ date: '2026-01-01T00:00:00', status: 'Enter recipient details',
    require_fields: [{ name: 'zipcode', type: 'text' }] }] };

  it('retrieves history without a browser and sends the stored postcode only in the form body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(announced));
    const result = await new ParcelsAppTracker({ fetcher }).fetch(number, 10_000, ' 01234 ');
    expect(result).toMatchObject({ current_stage: 'registered', tracking_source: 'structured-web-response' });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(API);
    expect(new URLSearchParams(String(init!.body)).get('extra[zipcode]')).toBe('01234');
    expect(JSON.stringify(result)).not.toContain('01234');
  });

  it('keeps interleaved numberless responses bound to their own requests', async () => {
    let finishFirst!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(reply({ states: [{ date: '2026-01-02T12:00:00Z', status: 'Delivered' }] }));
    const tracker = new ParcelsAppTracker({ fetcher });
    const first = tracker.fetch(number);
    const second = await tracker.fetch('ZZ98765432100');
    finishFirst(reply(announced));
    expect(second.current_stage).toBe('delivered');
    expect((await first).current_stage).toBe('registered');
    expect(String(fetcher.mock.calls[0][1]!.body)).not.toBe(String(fetcher.mock.calls[1][1]!.body));
  });

  it('reports a postcode gate without treating it as a scan or retrying in a browser', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(prompt));
    const tracker = new ParcelsAppTracker({ fetcher, trawl: new TrawlClient('http://browser.test', fetcher) });
    for (const postcode of [undefined, '99999']) {
      const error = await tracker.fetch(number, 10_000, postcode).catch((error: unknown) => error);
      expect(error).toMatchObject({ kind: 'input_required', field: 'postcode' });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('retains actual scans alongside a postcode gate', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ states: [...prompt.states, ...announced.states] }));
    const result = await new ParcelsAppTracker({ fetcher }).fetch(number);
    expect(result.events).toHaveLength(1);
    expect(result.current_stage).toBe('registered');
  });

  it('records challenge recovery and retains the browser identity check', async () => {
    const steps: StepRecord[] = [];
    const lookups: LookupRecord[] = [];
    const recorder: StepRecorder = { step: (record) => { steps.push(record); }, lookup: (record) => { lookups.push(record); } };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ error: 'RELOAD' })).mockResolvedValueOnce(captured(announced));
    const result = await new ParcelsAppTracker({ fetcher, recorder, trawl: new TrawlClient('http://browser.test', fetcher) }).fetch(number);
    expect(result.current_stage).toBe('registered');
    expect(steps).toMatchObject([{ step: 'direct', outcome: 'challenge' }, { step: 'trawl', outcome: 'ok', fallbackFrom: 'direct' }]);
    expect(lookups).toMatchObject([{ finalStep: 'trawl', attempts: 2, outcome: 'ok' }]);

    fetcher.mockResolvedValueOnce(reply({ error: 'RELOAD' })).mockResolvedValueOnce(captured(announced, { html: identity('OTHER123') }));
    await expect(new ParcelsAppTracker({ fetcher, trawl: new TrawlClient('http://browser.test', fetcher) }).fetch(number)).rejects.toThrow('identity missing');
  });

  it.each([429, 500, 503])('does not amplify HTTP %i with a browser retry', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status, headers: { 'Retry-After': '120' } }));
    await expect(new ParcelsAppTracker({ fetcher, trawl: new TrawlClient('http://browser.test', fetcher) }).fetch(number))
      .rejects.toMatchObject({ status, retryAfterMs: 120_000 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([{ error: 'NO_DATA' }, { error: 'NO_TRACKER' }, { states: [] }])('leaves no-history replies inconclusive without browser retries: %j', async (payload) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(payload));
    const error = await new ParcelsAppTracker({ fetcher, trawl: new TrawlClient('http://browser.test', fetcher) }).fetch(number).catch((error: unknown) => error);
    expect(carrierErrorKind(error)).toBe('indeterminate');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([{ correctId: 'OTHER123', ...announced }, { states: [{}] }, { states: [null] }, { states: Array(1001).fill({}) }, { uuid: 'unfinished' }])('rejects aliases, malformed and intermediate replies', async (payload) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(payload));
    await expect(new ParcelsAppTracker({ fetcher }).fetch(number)).rejects.toThrow();
  });
});
