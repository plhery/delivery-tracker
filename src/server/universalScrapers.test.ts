// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { chromium } from 'playwright-core';
import { PostalNinjaTracker, parsePostalNinjaResponse } from './postalNinja';
import { Ship24Tracker, parseShip24Response } from './ship24';

vi.mock('playwright-core', () => ({ chromium: { launch: vi.fn() } }));
const number = 'ZZ12345678900';
const ninja = (events: unknown[] = [
  { dt: '2026-08-17T07:22:00', dsc: 'Out for delivery' },
  { dt: '2026-08-17T11:17:00', dsc: 'Delivered by Mailbox, PIN: PRIVATE' },
]) => ({ status: 'FOUND', hid: 'sample', track: { hid: 'sample', tc: number, state: 'FINISHED', toAddress: 'PRIVATE', events } });
const ship = (events: unknown[] = [
  { datetime: '2026-08-17T11:17:00Z', timestamp: '2026-08-17T11:17:00+02:00', status: 'Delivered by Mailbox, PIN: PRIVATE' },
  { datetime: '2026-08-12T20:05:00Z', timestamp: '2026-08-12T20:05:00+02:00', status: 'Delivered to local carrier' },
]) => ({ data: { tracking_number: number, recipient: 'PRIVATE', events } });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('Postal Ninja and Ship24 result parsing', () => {
  it('extracts carrier discovery names without copying courier contact details or guessing a cross-border leg', () => {
    const payload = ship();
    const parsed = parseShip24Response({ data: { ...payload.data, couriers: [
      { translation: { name: 'UPS', phone: 'PRIVATE', website: 'https://private.example' } },
      { translation: { name: 'Swiss Post' } },
    ] } }, number);
    expect(parsed.reported_carriers).toEqual(['UPS', 'Swiss Post']);
    expect(parsed.discovered_carrier).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain('PRIVATE');
  });
  it('preserves Postal Ninja chronology without inventing time zones or exposing recipient details', () => {
    const parsed = parsePostalNinjaResponse(ninja(), number);
    expect(parsed).toMatchObject({ tracking_provider: 'Postal Ninja', current_stage: 'delivered', last_update: null });
    expect(parsed.events).toEqual([
      { local_time: '2026-08-17T11:17:00', description: 'Delivered', stage: 'delivered' },
      { local_time: '2026-08-17T07:22:00', description: 'Out for delivery', stage: 'out_for_delivery' },
    ]);
    expect(JSON.stringify(parsed)).not.toContain('PRIVATE');
  });

  it('uses explicit Postal Ninja offsets when available, without reordering undated newest scans', () => {
    const parsed = parsePostalNinjaResponse(ninja([
      { dt: '2026-08-16T12:00:00+08:00', dsc: 'In transit' },
      { dt: '2026-08-17T11:17:00', dsc: 'Delivered' },
    ]), number);
    expect(parsed.current_stage).toBe('delivered');
    expect(parsed.last_update).toBeNull();
    expect(parsed.events?.[1].time).toBe('2026-08-16T04:00:00.000Z');
  });

  it('rejects Postal Ninja challenges, private shipments, wrong identities, empty history and malformed dates', () => {
    for (const payload of [
      { ...ninja(), status: 'CHLNG_REQ' }, { ...ninja(), hid: 'different' },
      { ...ninja(), track: { ...ninja().track, tc: 'OTHER123' } },
      { ...ninja(), track: { ...ninja().track, state: 'PRIVATE' } },
      ninja([]), ninja([null]), ninja([{ dt: '2026-02-31T12:00:00', dsc: 'Delivered' }]),
      ninja([{ dt: 'tomorrow', dsc: 'Delivered' }]),
      ninja(Array(1001).fill({ dt: '2026-08-17T11:17:00', dsc: 'Delivered' })),
    ]) expect(() => parsePostalNinjaResponse(payload, number)).toThrow();
  });

  it('uses Ship24 timestamp offsets rather than the mislabeled datetime field', () => {
    const parsed = parseShip24Response(ship(), number);
    expect(parsed).toMatchObject({ tracking_provider: 'Ship24', current_stage: 'delivered', last_update: '2026-08-17T09:17:00.000Z' });
    expect(parsed.events?.[1]).toMatchObject({ time: '2026-08-12T18:05:00.000Z', stage: 'in_transit', description: 'Delivered to local carrier' });
    expect(JSON.stringify(parsed)).not.toContain('PRIVATE');
  });

  it('drops private delivery details even when an upstream carrier ignores the requested English language', () => {
    const raw = { timestamp: '2026-08-17T11:17:00+02:00', status: 'Consegnato da Cassetta postale, PIN: PRIVATE' };
    expect(JSON.stringify(parseShip24Response(ship([raw, ...ship().data.events]), number))).not.toContain('PRIVATE');
    expect(parseShip24Response(ship([{ ...raw, dispatch_code_id: 7 }]), number).events?.[0].description).toBe('Delivered');
  });

  it('rejects Ship24 mismatches, demos, errors, ambiguous timestamps and oversize histories', () => {
    for (const payload of [
      { data: { ...ship().data, tracking_number: 'OTHER123' } }, { data: { ...ship().data, error: true } }, ship([]), ship([null]),
      ship([{ datetime: '2026-08-17T11:17:00Z', status: 'Delivered' }]),
      ship([{ timestamp: '2026-08-17T11:17:00', status: 'Delivered' }]),
      ship([{ timestamp: '2026-02-31T11:17:00Z', status: 'Delivered' }]),
      ship(Array(1001).fill({ timestamp: '2026-08-17T11:17:00Z', status: 'Delivered' })),
    ]) expect(() => parseShip24Response(payload, number)).toThrow();
  });

  it('does not mark forecasts or carrier handoffs as final delivery', () => {
    for (const [description, stage] of [
      ['The package is being prepared by the sender and will be delivered to us soon', 'registered'],
      ['En route to DHL eCommerce distribution center or awaiting processing', 'registered'],
      ['En route', 'in_transit'], ['Delivered to local carrier', 'in_transit'],
    ]) expect(parsePostalNinjaResponse(ninja([{ dt: '2026-08-17T11:17:00', dsc: description }]), number).current_stage).toBe(stage);
  });
});

function browserFixture(payload: unknown, responseUrl: string) {
  let respond: ((response: unknown) => Promise<void>) | undefined;
  const locator = { locator: vi.fn(), fill: vi.fn(), count: vi.fn().mockResolvedValue(1), uncheck: vi.fn(), click: vi.fn() };
  locator.locator.mockReturnValue(locator);
  const emit = () => respond?.({ url: () => responseUrl, status: () => 201, headers: () => ({}), body: async () => Buffer.from(JSON.stringify(payload)) });
  const page = { setDefaultTimeout: vi.fn(), on: vi.fn((_: string, callback: typeof respond) => { respond = callback; }),
    goto: vi.fn(async () => { await emit(); return { headers: () => ({}), status: () => 200 as number }; }), locator: vi.fn().mockReturnValue(locator), frameLocator: vi.fn().mockReturnValue(locator) };
  const context = { route: vi.fn(), newPage: vi.fn().mockResolvedValue(page) };
  const browser = { version: () => '152.0.0.0', newContext: vi.fn().mockResolvedValue(context), close: vi.fn() };
  vi.mocked(chromium.launch).mockResolvedValue(browser as never);
  return { browser, context, page, locator, emit };
}

describe('bounded browser scraper lifecycle', () => {
  it('submits Postal Ninja form and captures matching history in a fresh isolated browser', async () => {
    const f = browserFixture(ninja(), 'https://postal.ninja/track/get');
    f.page.goto.mockResolvedValue({ headers: () => ({}), status: () => 200 });
    f.locator.click.mockImplementation(f.emit);
    const parsed = await new PostalNinjaTracker({ executablePath: '/test/chromium' }).fetch(number);
    expect(parsed.tracking_provider).toBe('Postal Ninja');
    expect(f.locator.fill).toHaveBeenCalledWith(number);
    expect(f.locator.uncheck).toHaveBeenCalledOnce();
    expect(f.browser.close).toHaveBeenCalledOnce();
    expect(f.browser.newContext).toHaveBeenCalledWith(expect.objectContaining({ acceptDownloads: false, serviceWorkers: 'block' }));
    expect(Object.keys(vi.mocked(chromium.launch).mock.calls.at(-1)![0]!.env!)).toEqual(['PATH', 'HOME', 'LANG']);
  });

  it('loads Ship24 by number and closes the browser after success', async () => {
    const f = browserFixture(ship(), `https://api.ship24.com/api/parcels/${number}?lang=en`);
    await expect(new Ship24Tracker({ executablePath: '/test/chromium' }).fetch(number)).resolves.toMatchObject({ tracking_provider: 'Ship24' });
    expect(f.page.goto).toHaveBeenCalledWith(`https://www.ship24.com/tracking?p=${number}`, expect.anything());
    expect(f.browser.close).toHaveBeenCalledOnce();
  });

  it('closes on page failure, rejects unrelated history on timeout and releases the concurrency slot', async () => {
    const f = browserFixture(ship(), 'https://untrusted.test/');
    f.page.goto.mockResolvedValueOnce({ headers: () => ({}), status: () => 403 });
    const tracker = new Ship24Tracker({ executablePath: '/test/chromium', timeoutMs: 30 });
    await expect(tracker.fetch(number)).rejects.toThrow('HTTP 403');
    await expect(tracker.fetch(number)).rejects.toThrow('timeout');
    expect(f.browser.close).toHaveBeenCalledTimes(2);
  });

  it('does not allow an outage to spawn browsers for a whole sync batch', async () => {
    const f = browserFixture(ship(), 'https://untrusted.test/');
    const tracker = new Ship24Tracker({ executablePath: '/test/chromium', timeoutMs: 30 });
    const first = tracker.fetch(number);
    await expect(tracker.fetch(number)).rejects.toThrow('busy');
    await expect(first).rejects.toThrow('timeout');
    expect(f.browser.close).toHaveBeenCalledOnce();
  });

  it('permits required challenge subdomains while blocking unrelated and private hosts', async () => {
    const f = browserFixture(ship(), `https://api.ship24.com/api/parcels/${number}?lang=en`);
    await new Ship24Tracker({ executablePath: '/test/chromium' }).fetch(number);
    const handler = f.context.route.mock.calls[0][1];
    for (const [url, allowed] of [
      ['https://api.ship24.com/api/parcels/test', true],
      ['https://brunhild.challenges.cloudflare.com/check', true],
      ['http://127.0.0.1/admin', false], ['https://ship24.com.evil.test/', false],
      ['https://advertising.test/', false],
    ] as const) {
      const route = { request: () => ({ url: () => url }), continue: vi.fn(), abort: vi.fn() };
      await handler(route);
      expect(route.continue).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(route.abort).toHaveBeenCalledTimes(allowed ? 0 : 1);
    }
  });

  it('closes the browser even when context creation stalls', async () => {
    const f = browserFixture(ship(), 'https://untrusted.test/');
    f.browser.newContext.mockImplementationOnce(() => new Promise(() => {}));
    await expect(new Ship24Tracker({ executablePath: '/test/chromium', timeoutMs: 30 }).fetch(number)).rejects.toThrow('timeout');
    expect(f.browser.close).toHaveBeenCalledOnce();
  });

  it('validates identifiers and configuration before launching a browser', async () => {
    vi.mocked(chromium.launch).mockClear();
    vi.stubEnv('TRACKING_CHROMIUM_PATH', '');
    await expect(new PostalNinjaTracker().fetch('https://localhost')).rejects.toThrow('Invalid tracking number');
    await expect(new Ship24Tracker().fetch(number)).rejects.toThrow('TRACKING_CHROMIUM_PATH');
    await expect(new Ship24Tracker({ executablePath: '/test/chromium', timeoutMs: Infinity }).fetch(number)).rejects.toThrow('timeout');
    expect(chromium.launch).not.toHaveBeenCalled();
  });
});
