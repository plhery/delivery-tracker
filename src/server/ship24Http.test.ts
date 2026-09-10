// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ship24HttpClient, ship24Checksum } from './ship24Http';
import { Ship24Tracker } from './ship24';
import { scrapeUniversalPage } from './universalBrowser';
import { reportRoutingEvent } from './observability';
import { UpstreamHttpError } from './boundedFetch';

vi.mock('./universalBrowser', () => ({ scrapeUniversalPage: vi.fn() }));
vi.mock('./observability', async importOriginal => ({ ...await importOriginal<typeof import('./observability')>(), reportRoutingEvent: vi.fn() }));
const number = 'ZZ12345678900';
const history = { data: { tracking_number: number,
  events: [{ timestamp: '2026-09-10T10:00:00+02:00', status: 'Delivered', dispatch_code_id: 7 }] } };
const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 201 });
function fixture() {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(history));
  const client = new Ship24HttpClient(fetcher);
  return { client, fetcher, tracker: new Ship24Tracker({ httpClient: client }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('Ship24 anonymous HTTP tracking', () => {
  it('makes one signed JSON POST per lookup with no browser, bootstrap, cookie or login', async () => {
    const { tracker, fetcher } = fixture();
    for (let index = 0; index < 2; index++) {
      await expect(tracker.fetch(number)).resolves.toMatchObject({ current_stage: 'delivered', tracking_source: 'structured-web-response' });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(scrapeUniversalPage).not.toHaveBeenCalled();
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`https://api.ship24.com/api/parcels/${number}?lang=en`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
    const headers = init!.headers as Record<string, string>;
    const [encoded, signature] = headers['x-ship24-token'].split('.');
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(Buffer.from(encoded, 'base64').toString())).toMatchObject({ a: expect.any(Number), b: expect.any(Number), c: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(headers).not.toHaveProperty('Cookie');
    expect(headers).not.toHaveProperty('Authorization');
  });
  it('uses standard unsigned MurmurHash3 checksums and binds tokens to the requested number', async () => {
    expect(ship24Checksum('')).toBe(0);
    expect(ship24Checksum('hello')).toBe(613153351);
    expect(ship24Checksum('foo')).toBe(4138058784);
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { client, fetcher } = fixture();
    await client.fetch(number, 1000);
    await client.fetch('ZZ12345678901', 1000);
    const tokens = fetcher.mock.calls.map(([, init]) => (init!.headers as Record<string, string>)['x-ship24-token']);
    expect(tokens[0]).not.toBe(tokens[1]);
  });
  it('reports a rejected HTTP path before browser recovery', async () => {
    const { tracker, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(new Response('rejected', { status: 403 }));
    vi.mocked(scrapeUniversalPage).mockImplementationOnce(async () => {
      expect(reportRoutingEvent).toHaveBeenCalledWith('transport_fallback', expect.objectContaining({ provider: 'Ship24', category: 'browser', error: expect.objectContaining({ status: 403 }) }));
      return { events: [], status: 'delivered' };
    });
    await expect(tracker.fetch(number)).resolves.toMatchObject({ tracking_source: 'browser-session-response' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([429, 503])('preserves HTTP %i and Retry-After without browser amplification', async status => {
    const { tracker, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(new Response('', { status, headers: { 'Retry-After': '120' } }));
    await expect(tracker.fetch(number)).rejects.toMatchObject({ status, retryAfterMs: 120_000 });
    expect(scrapeUniversalPage).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('rejects unrelated history before falling back and does not leak it into the result', async () => {
    const { tracker, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(reply({ data: { ...history.data, tracking_number: 'OTHER123' } }));
    vi.mocked(scrapeUniversalPage).mockRejectedValueOnce(new UpstreamHttpError('Ship24', 403));
    await expect(tracker.fetch(number)).rejects.toMatchObject({ status: 403 });
    expect(reportRoutingEvent).toHaveBeenCalledWith('transport_fallback', expect.objectContaining({ category: 'browser', errorClass: 'TypeError' }));
  });
  it('validates inputs before network access', async () => {
    const { client, fetcher } = fixture();
    await expect(client.fetch('https://private.test', 1000)).rejects.toThrow('tracking number');
    await expect(client.fetch(number, Infinity)).rejects.toThrow('timeout');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('subtracts direct time from the browser budget', async () => {
    let clock = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const { client, tracker } = fixture();
    vi.spyOn(client, 'fetch').mockImplementationOnce(async () => { clock += 7500; throw new Error('timeout'); });
    vi.mocked(scrapeUniversalPage).mockResolvedValueOnce({ events: [] });
    await tracker.fetch(number);
    expect(scrapeUniversalPage).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 37_500 }), expect.anything(), expect.anything());
  });
});
