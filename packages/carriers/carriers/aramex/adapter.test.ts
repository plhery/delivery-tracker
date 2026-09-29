import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AramexTracker } from './adapter';
import { aramexDetailUrl, parseAramex } from './parser';

const NUMBER = '00000000001';
const html = readFileSync(new URL('./fixtures/delivered.html', import.meta.url), 'utf8');
const overview = (href = '/track/details?q=synthetic') => `<a class="shipment-card" href="${href}"><div class="shipment-num"><h5>${NUMBER}</h5></div></a>`;
describe('Aramex direct tracking', () => {
  it('preserves local clocks without fabricating instants or using the progress rail', () => {
    const result = parseAramex(html, NUMBER);
    expect(result).toMatchObject({ status: 'delivered', last_update: null, last_update_local: '2026-01-03T14:00:00' });
    expect(result.events?.map(e => e.stage)).toEqual(['delivered', 'out_for_delivery']);
    expect(result.events?.[0]).not.toHaveProperty('time');
    expect(JSON.stringify(result)).not.toMatch(/Private Recipient|Example Address|progress-rail/);
    expect(JSON.parse(readFileSync(new URL('./carrier.json', import.meta.url), 'utf8')).capabilities).toEqual(['history']);
  });
  it('requires the requested identity in overview and detail and restricts the detail destination', () => {
    expect(aramexDetailUrl(overview(), NUMBER)).toBe('https://www.aramex.com/track/details?q=synthetic');
    for (const value of [overview('https://example.invalid/track/details?q=synthetic'), overview('/other?q=synthetic'), overview() + overview(), overview().replace(NUMBER, '00000000002')]) {
      expect(() => aramexDetailUrl(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
    expect(() => parseAramex(html.replace(NUMBER, '00000000002'), NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
  });
  it('distinguishes explicit negatives and malformed responses', () => {
    expect(() => aramexDetailUrl('<div class="track-shipment-list"><h5>No results found with current selection, please enter a different tracking number.</h5></div>', NUMBER))
      .toThrowError(expect.objectContaining({ kind: 'not_found' }));
    expect(() => aramexDetailUrl('<html></html>', NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    const value = html.replace('The shipment has been delivered', 'New wording');
    expect(parseAramex(value, NUMBER).events?.[0]).not.toHaveProperty('stage');
    expect(parseAramex(value, NUMBER).status).toBe('unknown');
  });
  it('preserves distinct invalid clock labels without inventing scan instants', () => {
    const value = html.replaceAll('03 Jan 26', '31 Feb 26')
      .replace("An Aramex Delivery Champion has the shipment and is expected to reach the customer's doorstep shortly", 'The shipment has been delivered');
    const result = parseAramex(value, NUMBER);
    expect(result.events?.map(event => event.provider_time_text)).toEqual(['31 Feb 26 14:00', '31 Feb 26 08:00']);
    expect(result.events?.every(event => !event.time && !event.local_time)).toBe(true);
    expect(result.last_update).toBeNull();
    expect(result.last_update_local).toBeNull();
  });
  it('rejects incomplete or blank scans rather than presenting an older row as current', () => {
    for (const replacement of ['', '<td>Unknown structure</td>']) {
      const value = replacement ? html.replace('<td class="activity">The shipment has been delivered</td>', replacement)
        : html.replace('The shipment has been delivered', '');
      expect(() => parseAramex(value, NUMBER)).toThrowError(expect.objectContaining({ kind: 'schema' }));
    }
  });
  it('fetches exactly the bound detail with one cancellation budget', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(overview())).mockResolvedValueOnce(new Response(html));
    await new AramexTracker({ fetcher }).fetch(NUMBER, { budgetMs: 1000 });
    expect(fetcher.mock.calls.map(c => c[0])).toEqual([`https://www.aramex.com/us/en/track/shipments?ShipmentNumber=${NUMBER}`, 'https://www.aramex.com/track/details?q=synthetic']);
    expect(fetcher.mock.calls.every(c => c[1]?.signal instanceof AbortSignal)).toBe(true);
    expect(fetcher.mock.calls.map(c => new Headers(c[1]?.headers).get('user-agent')))
      .toEqual(['SwissDeliveryTracker/1.0', 'SwissDeliveryTracker/1.0']);
  });
  it('does not start a detail request after cancellation during the overview', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort(); return new Response(overview());
    });
    await expect(new AramexTracker({ fetcher }).fetch(NUMBER, { signal: controller.signal })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('follows one same-host regional redirect with the exact bound query', async () => {
    const regional = 'https://www.aramex.com/ae/en/track/details?q=synthetic';
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(overview()))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: regional } }))
      .mockResolvedValueOnce(new Response(html));
    expect((await new AramexTracker({ fetcher }).fetch(NUMBER)).status).toBe('delivered');
    expect(fetcher.mock.calls[2]?.[0]).toBe(regional);
    expect(fetcher.mock.calls[2]?.[1]?.redirect).toBe('error');
    expect(fetcher.mock.calls.map(c => new Headers(c[1]?.headers).get('user-agent')))
      .toEqual(['SwissDeliveryTracker/1.0', 'SwissDeliveryTracker/1.0', 'SwissDeliveryTracker/1.0']);
  });
  it.each(['https://example.invalid/ae/en/track/details?q=synthetic', '/ae/en/track/details?q=other', '/ae/en/login?q=synthetic'])
    ('rejects an unbound detail redirect: %s', async location => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(overview()))
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: location } }));
      await expect(new AramexTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  it('preserves throttle and challenge evidence while inspecting detail redirects', async () => {
    for (const status of [429, 403]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(overview()))
        .mockResolvedValueOnce(new Response('Access denied', {
          status, headers: { 'Retry-After': '7200', 'Content-Type': 'text/plain' },
        }));
      await expect(new AramexTracker({ fetcher }).fetch(NUMBER)).rejects.toMatchObject({
        kind: status === 429 ? 'rate_limited' : 'challenge', retryAfterMs: 7_200_000,
        diagnostics: { body_signals: ['access_denied'] },
        request: { url: 'https://www.aramex.com/track/details?q=synthetic' },
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
});
