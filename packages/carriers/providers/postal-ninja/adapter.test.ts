// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrapeUniversalPage } from '../../core/transport/browser';
import { TrawlClient } from '../../core/transport';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, parsePostalNinjaResponse, PostalNinjaTracker } from './adapter';

vi.mock('../../core/transport/browser', () => ({ scrapeUniversalPage: vi.fn() }));

const number = 'ZZ12345678900';
interface Found { status: string; hid: string; track: { hid: string; tc: string; state: string; events: unknown[] } }
const found = JSON.parse(readFileSync(new URL('./fixtures/found.json', import.meta.url), 'utf8')) as Found;
const withEvents = (events: unknown[]): Found => ({ ...found, track: { ...found.track, events } });

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('Postal Ninja result parsing', () => {
  it('preserves chronology without inventing time zones or exposing recipient details', () => {
    const parsed = parsePostalNinjaResponse(found, number);
    expect(parsed).toMatchObject({ status: 'delivered', current_stage: 'delivered', tracking_provider: 'Postal Ninja' });
    // Wall-clock scans never fabricate a UTC instant, so the summary has no last_update.
    expect(parsed.last_update).toBeNull();
    expect(parsed.events?.[0]).toEqual({ local_time: '2026-08-17T11:17:00', description: 'Delivered', stage: 'delivered' });
    expect(parsed.events?.[1]).toEqual({ local_time: '2026-08-17T07:22:00', description: 'Out for delivery', stage: 'out_for_delivery' });
    // An explicit offset can be persisted as a real instant.
    expect(parsed.events?.[2]).toMatchObject({ time: '2026-08-16T04:00:00.000Z', stage: 'in_transit' });
    expect(JSON.stringify(parsed)).not.toContain('PRIVATE');
  });

  it('accepts the widget compact response without inventing missing history', () => {
    const track = { ...found.track, events: undefined };
    const parsed = parsePostalNinjaResponse({ ...found, track: {
      ...track,
      firstEv: { dt: '2026-08-01T10:00:00', dsc: 'Shipment information received' },
      lastEv: { dt: '2026-08-17T11:17:00', dsc: 'Delivered by Mailbox, PIN: PRIVATE' },
      toAddress: 'PRIVATE RECIPIENT',
    } }, number);
    expect(parsed).toMatchObject({ current_stage: 'delivered', last_update: null });
    expect(parsed.events).toEqual([
      { local_time: '2026-08-17T11:17:00', description: 'Delivered', stage: 'delivered' },
      { local_time: '2026-08-01T10:00:00', description: 'Shipment information received', stage: 'registered' },
    ]);
    expect(JSON.stringify(parsed)).not.toContain('PRIVATE');
  });

  it('deduplicates a compact single scan and rejects malformed compact data', () => {
    const track = { ...found.track, events: undefined };
    const scan = { dt: '2026-08-17T11:17:00', dsc: 'In transit' };
    expect(parsePostalNinjaResponse({ ...found, track: { ...track, firstEv: scan, lastEv: scan } }, number).events).toHaveLength(1);
    for (const fields of [
      {}, { lastEv: 'invalid' }, { firstEv: scan, lastEv: { dt: 'invalid', dsc: 'Delivered' } },
      { events: null, firstEv: scan }, { events: [], lastEv: scan },
    ]) expect(() => parsePostalNinjaResponse({ ...found, track: { ...track, ...fields } }, number)).toThrow();
  });

  it('rejects challenges, wrong identities, empty history and malformed dates', () => {
    for (const payload of [
      { ...found, status: 'CHLNG_REQ' }, { ...found, hid: 'different' },
      { ...found, track: { ...found.track, tc: 'OTHER123' } },
      { ...found, track: { ...found.track, state: 'PRIVATE' } },
      withEvents([]), withEvents([null]),
      withEvents([{ dt: '2026-02-31T12:00:00', dsc: 'Delivered' }]),
      withEvents([{ dt: 'tomorrow', dsc: 'Delivered' }]),
      withEvents(Array(1001).fill({ dt: '2026-08-17T11:17:00', dsc: 'Delivered' })),
    ]) expect(() => parsePostalNinjaResponse(payload, number)).toThrow();
  });

  it('does not mark forecasts or carrier handoffs as final delivery', () => {
    for (const [description, stage] of [
      ['The package is being prepared by the sender and will be delivered to us soon', 'registered'],
      ['En route to DHL eCommerce distribution center or awaiting processing', 'registered'],
      ['En route', 'in_transit'], ['Delivered to local carrier', 'in_transit'],
    ]) expect(parsePostalNinjaResponse(withEvents([{ dt: '2026-08-17T11:17:00', dsc: description }]), number).current_stage).toBe(stage);
  });
});

describe('Postal Ninja TRAWL capture', () => {
  const get = 'https://postal.ninja/track/get';
  const check = 'https://postal.ninja/track/check';
  const url = `https://postal.ninja/en/tools#trawl-number=${number}`;
  const entry = (payload: unknown, endpoint = get, status = 200) => ({
    url: endpoint, status, body: JSON.stringify(payload), headers: { 'retry-after': '60' },
  });
  const captured = (entries: unknown[], overrides = {}) => new Response(JSON.stringify({
    url, html: '<html></html>', statusCode: 200, tier: 3, capturedResponses: entries, ...overrides,
  }));
  const setup = (response: Response) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const trawl = new TrawlClient('http://browser.test', fetcher);
    return {fetcher, trawl, tracker: new PostalNinjaTracker({trawl})};
  };

  it('wires the shared browser service through the factory and requests both protocol endpoints', async () => {
    const {fetcher, trawl} = setup(captured([entry({status: 'PROCESSING', tc: number, hid: found.hid}, check), entry(found)]));
    const provider = adapter({trawl, recorder: NOOP_RECORDER, env: {}, browserExecutablePath: null});
    expect(provider.steps).toEqual(['trawl']);
    await expect(provider.track({number, postcode: null}, {budgetMs: 30_000})).resolves.toMatchObject({tracking_provider: 'Postal Ninja', current_stage: 'delivered'});
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({url, skipHttp: true, maxTier: 3, captureResponses: [get, check]});
    expect(scrapeUniversalPage).not.toHaveBeenCalled();
  });

  it('skips unrelated and intermediate captures but preserves a matching challenge or no-info outcome', async () => {
    const noInfo = { ...found, track: { ...found.track, state: 'NO_INFO', events: [] } };
    for (const [entries, expected] of [
      [[entry({status: 'CHLNG_REQ', tc: number}, check)], {kind: 'challenge'}],
      [[entry({status: 'UNTRACEABLE', tc: number}, check)], {kind: 'indeterminate'}],
      [[entry({status: 'PROCESSING', tc: number, hid: found.hid}, check), entry({status: 'CHLNG_REQ', hid: found.hid})], {kind: 'challenge'}],
      [[entry({...noInfo, inProgress: true}), entry(noInfo)], {kind: 'indeterminate'}],
      [[entry(null, check, 429)], {status: 429, retryAfterMs: 60_000}],
    ] as const) {
      await expect(setup(captured([...entries])).tracker.fetch(number)).rejects.toMatchObject(expected);
    }
    const {tracker} = setup(captured([entry({status: 'CHLNG_REQ', tc: 'OTHER123'}, check), entry({...noInfo, inProgress: true}), entry(found)]));
    await expect(tracker.fetch(number)).resolves.toMatchObject({current_stage: 'delivered'});
    expect(scrapeUniversalPage).not.toHaveBeenCalled();
  });

  it('rejects wrong identities, redirected pages and missing or unreadable captures', async () => {
    for (const response of [
      captured([entry({...found, track: {...found.track, tc: 'OTHER123'}})]),
      captured([entry(found)], {url: 'https://postal.ninja/en'}),
      captured([entry(found)], {url: 'https://postal.ninja/en/track#/another-handle'}),
      captured([entry(found)], {url: `https://other.test/en/track#/${found.hid}`}),
      captured([entry(found)], {tier: 1}),
      captured([], {capturedResponses: undefined}),
      captured([{...entry(found), body: null, error: 'unreadable'}]),
      captured([{...entry(found), truncated: true}]),
    ]) await expect(setup(response).tracker.fetch(number)).rejects.toThrow();
    expect(scrapeUniversalPage).not.toHaveBeenCalled();
  });

  it('accepts the bound normal results page and selects full history over the widget summary', async () => {
    const compact = {...found, track: {...found.track, events: undefined, firstEv: found.track.events[0], lastEv: found.track.events.at(-1)}};
    const {tracker} = setup(captured([entry(compact), entry(found)], {url: `https://postal.ninja/en/track#/${found.hid}`}));
    const result = await tracker.fetch(number);
    expect(result.events).toEqual(parsePostalNinjaResponse(found, number).events);
    await expect(setup(captured([entry(compact)])).tracker.fetch(number)).rejects.toMatchObject({kind: 'indeterminate'});
  });
});

describe('Postal Ninja widget lookup', () => {
  it('submits the official embedded widget and reads its own tracking response', async () => {
    vi.mocked(scrapeUniversalPage).mockResolvedValueOnce({ events: [], status: 'delivered' });
    await expect(new PostalNinjaTracker({ executablePath: '/test/chromium' }).fetch(number)).resolves.toMatchObject({ status: 'delivered' });
    expect(scrapeUniversalPage).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: '/test/chromium', timeoutMs: expect.any(Number) }),
      expect.objectContaining({ name: 'Postal Ninja', url: 'https://postal.ninja/en/tools', responseUrl: 'https://postal.ninja/track/get' }),
      expect.any(Function),
    );
  });

  it('validates the number and the budget before starting a browser', async () => {
    await expect(new PostalNinjaTracker().fetch('https://localhost')).rejects.toThrow('Invalid tracking number');
    await expect(new PostalNinjaTracker({ timeoutMs: Infinity }).fetch(number)).rejects.toThrow('timeout');
    expect(scrapeUniversalPage).not.toHaveBeenCalled();
  });
});
