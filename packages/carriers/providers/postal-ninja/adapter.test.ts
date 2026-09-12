// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrapeUniversalPage } from '../../core/transport/browser';
import { parsePostalNinjaResponse, PostalNinjaTracker } from './adapter';

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
