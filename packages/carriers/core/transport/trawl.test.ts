import { describe, expect, it, vi } from 'vitest';
import { UpstreamHttpError } from '../errors';
import { TrawlClient, TrawlError, trawlBody, trawlEndpoint } from './trawl';

function jsonFetcher(payload: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
}

describe('trawlEndpoint', () => {
  it('normalizes configured URLs to the service root', () => {
    expect(trawlEndpoint('http://trawl:8191/v1').toString()).toBe('http://trawl:8191/');
    expect(trawlEndpoint('http://trawl:8191/scrape/').toString()).toBe('http://trawl:8191/');
    expect(trawlEndpoint('https://trawl.internal/base/?x=1#y').toString()).toBe('https://trawl.internal/base');
    expect(() => trawlEndpoint('ftp://trawl')).toThrow('FLARESOLVERR_URL must be an HTTP(S) URL');
    expect(() => trawlEndpoint('not a url')).toThrow('FLARESOLVERR_URL must be an HTTP(S) URL');
  });

  it('builds the client from the environment only when configured', () => {
    expect(TrawlClient.fromEnvironment({})).toBeNull();
    expect(TrawlClient.fromEnvironment({ FLARESOLVERR_URL: ' http://trawl:8191 ' })?.scrapeUrl().toString()).toBe('http://trawl:8191/scrape');
    expect(new TrawlClient('http://trawl:8191/v1').commandUrl().toString()).toBe('http://trawl:8191/v1');
  });
});

describe('TrawlClient.scrape', () => {
  const options = { provider: 'TRAWL while fetching UPS', timeoutMs: 1_000 };

  it('returns the solved page with cookies and captured responses', async () => {
    const fetcher = jsonFetcher({
      url: 'https://example.test/track', html: '<html/>', tier: 3, statusCode: 200, userAgent: 'UA',
      cookies: [{ name: 'a', value: 'b' }, 'junk'],
      capturedResponses: [{ url: 'https://example.test/api', status: 200, body: '{"ok":true}', headers: { 'content-type': 'application/json' } }],
    });
    const client = new TrawlClient('http://trawl:8191', fetcher);
    const result = await client.scrape({ url: 'https://example.test/track', skipHttp: true, maxTier: 3, maxTimeout: 1_000 }, options);
    expect(result).toMatchObject({ url: 'https://example.test/track', html: '<html/>', tier: 3, statusCode: 200, userAgent: 'UA', cookies: [{ name: 'a', value: 'b' }] });
    expect(result.capturedResponses).toEqual([expect.objectContaining({ url: 'https://example.test/api', status: 200, body: '{"ok":true}', truncated: false })]);
    const [url, init] = (fetcher as unknown as { mock: { calls: [URL, RequestInit][] } }).mock.calls[0]!;
    expect(url.toString()).toBe('http://trawl:8191/scrape');
    expect(JSON.parse(String(init.body))).toMatchObject({ url: 'https://example.test/track', skipHttp: true, maxTier: 3 });
  });

  it('turns service errors and unsolved tiers into transport errors, and page statuses into HTTP errors', async () => {
    const client = (payload: unknown) => new TrawlClient('http://trawl:8191', jsonFetcher(payload));
    await expect(client({ error: 'browser crashed' }).scrape({ url: 'https://e.test' }, options)).rejects.toMatchObject({ name: 'TrawlError', kind: 'transport', message: 'browser crashed' });
    await expect(client({ html: '<html/>', tier: 1, statusCode: 200 }).scrape({ url: 'https://e.test' }, options)).rejects.toBeInstanceOf(TrawlError);
    await expect(client({ html: '<html/>', tier: 3, statusCode: 429 }).scrape({ url: 'https://e.test' }, options)).rejects.toMatchObject({ kind: 'rate_limited' });
    await expect(client({ html: '<html/>', tier: 3, statusCode: 404 }).scrape({ url: 'https://e.test' }, options)).rejects.toBeInstanceOf(UpstreamHttpError);
    await expect(client({ html: '<html/>', tier: 1, statusCode: 200 }).scrape({ url: 'https://e.test' }, { ...options, requireSolved: false })).resolves.toMatchObject({ tier: 1 });
  });

  it('solves through the legacy command API', async () => {
    const fetcher = jsonFetcher({ status: 'ok', solution: { status: 200, response: '<html>solved</html>' } });
    const client = new TrawlClient('http://trawl:8191', fetcher);
    await expect(client.solve('https://e.test/page', options)).resolves.toBe('<html>solved</html>');
    const [url, init] = (fetcher as unknown as { mock: { calls: [URL, RequestInit][] } }).mock.calls[0]!;
    expect(url.toString()).toBe('http://trawl:8191/v1');
    expect(JSON.parse(String(init.body))).toEqual({ cmd: 'request.get', url: 'https://e.test/page', maxTimeout: 1_000 });
    await expect(new TrawlClient('http://trawl:8191', jsonFetcher({ status: 'error' })).solve('https://e.test', options)).rejects.toBeInstanceOf(TrawlError);
  });
});

describe('trawlBody', () => {
  it('decodes the body representations used by different service releases', () => {
    expect(trawlBody({ body: 'plain' })).toBe('plain');
    expect(trawlBody({ body: [104, 105] })).toBe('hi');
    expect(trawlBody({ body: { type: 'Buffer', data: [104, 105] } })).toBe('hi');
    expect(trawlBody({ body: { '0': 104, '1': 105 } })).toBe('hi');
    expect(trawlBody({ body: { '1': 104 } })).toBe('');
    expect(trawlBody({ body: [300] })).toBe('');
    expect(trawlBody({})).toBe('');
  });
});

describe('dead browser recovery', () => {
  const closed = () => Response.json({ error: 'Max tier reached without success', timings: [
    { reason: 'newPage: Target page, context or browser has been closed' },
  ] }, { status: 500 });
  const options = { provider: 'TRAWL', timeoutMs: 30_000 };
  it('retries once only after readiness confirms spare live browser capacity', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(closed())
      .mockResolvedValueOnce(Response.json({ status: 'ok', pool: { live: 1, available: 1 } }))
      .mockResolvedValueOnce(Response.json({ tier: 3, statusCode: 200, html: '<html/>', cookies: [] }));
    await expect(new TrawlClient('http://trawl:8191', fetcher).scrape({ url: 'https://example.test' }, options))
      .resolves.toMatchObject({ statusCode: 200 });
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'http://trawl:8191/scrape', 'http://trawl:8191/health', 'http://trawl:8191/scrape',
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[2]![1]!.body)).maxTimeout).toBeLessThan(30_000);
  });
  it('does not retry a saturated or still-restarting pool', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(closed())
      .mockResolvedValueOnce(Response.json({ status: 'ok', pool: { live: 1, available: 0 } }));
    await expect(new TrawlClient('http://trawl:8191', fetcher).scrape({ url: 'https://example.test' }, options)).rejects.toMatchObject({ status: 500 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not loop when the replacement browser also fails', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(closed())
      .mockResolvedValueOnce(Response.json({ status: 'ok', pool: { live: 1, available: 1 } }))
      .mockResolvedValueOnce(closed());
    await expect(new TrawlClient('http://trawl:8191', fetcher).scrape({ url: 'https://example.test' }, options)).rejects.toMatchObject({ status: 500 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
