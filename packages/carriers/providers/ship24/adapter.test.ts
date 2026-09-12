// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpstreamHttpError } from '../../core/errors';
import type { LookupRecord, StepRecord, StepRecorder } from '../../core/telemetry';
import { scrapeUniversalPage } from '../../core/transport/browser';
import { parseShip24Response, Ship24Tracker } from './adapter';
import { ship24Checksum, Ship24HttpClient } from './http';

vi.mock('../../core/transport/browser', () => ({ scrapeUniversalPage: vi.fn() }));

const number = 'ZZ12345678900';
const delivered = JSON.parse(readFileSync(new URL('./fixtures/delivered.json', import.meta.url), 'utf8')) as unknown;
const history = { data: { tracking_number: number,
  events: [{ timestamp: '2026-09-10T10:00:00+02:00', status: 'Delivered', dispatch_code_id: 7 }] } };
const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 201 });

function fixture() {
  const steps: StepRecord[] = [];
  const lookups: LookupRecord[] = [];
  const recorder: StepRecorder = { step: (record) => { steps.push(record); }, lookup: (record) => { lookups.push(record); } };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => reply(history));
  const client = new Ship24HttpClient(fetcher);
  return { client, fetcher, steps, lookups, tracker: new Ship24Tracker({ httpClient: client, recorder }) };
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('Ship24 result parsing', () => {
  it('retains the aggregated history and courier names without recipient or courier contact details', () => {
    const parsed = parseShip24Response(delivered, number);
    expect(parsed).toMatchObject({ status: 'delivered', current_stage: 'delivered', tracking_provider: 'Ship24' });
    expect(parsed.events?.length).toBeGreaterThan(0);
    expect(parsed.events?.[0]).toMatchObject({ stage: 'delivered', description: 'Delivered' });
    expect(parsed.reported_carriers).toEqual(['Swiss Post', 'UPS']);
    // A single unambiguous name may be adopted; several names stay hints only.
    expect(parsed.discovered_carrier).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toMatch(/PRIVATE|PIN:|signed by/i);
  });

  it('rejects history that belongs to another shipment', () => {
    expect(() => parseShip24Response({ data: { tracking_number: 'OTHER123', events: [] } }, number))
      .toThrow('no matching shipment history');
  });
});

describe('Ship24 anonymous HTTP tracking', () => {
  it('makes one signed JSON POST per lookup with no browser, bootstrap, cookie or login', async () => {
    const { tracker, fetcher, steps, lookups } = fixture();
    for (let index = 0; index < 2; index++) {
      await expect(tracker.fetch(number)).resolves.toMatchObject({ current_stage: 'delivered', tracking_source: 'structured-web-response' });
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(scrapeUniversalPage).not.toHaveBeenCalled();
    expect(steps.map(({ step, outcome }) => [step, outcome])).toEqual([['direct', 'ok'], ['direct', 'ok']]);
    expect(lookups.map(({ carrier, finalStep, outcome }) => [carrier, finalStep, outcome]))
      .toEqual([['Ship24', 'direct', 'ok'], ['Ship24', 'direct', 'ok']]);
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

  it('records the rejected HTTP path before browser recovery starts', async () => {
    const { tracker, fetcher, steps } = fixture();
    fetcher.mockResolvedValueOnce(new Response('rejected', { status: 403 }));
    vi.mocked(scrapeUniversalPage).mockImplementationOnce(async () => {
      expect(steps).toMatchObject([{ carrier: 'Ship24', step: 'direct', outcome: 'challenge', errorType: 'UpstreamHttpError' }]);
      return { events: [], status: 'delivered' };
    });
    await expect(tracker.fetch(number)).resolves.toMatchObject({ tracking_source: 'browser-session-response' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(steps[1]).toMatchObject({ step: 'browser', outcome: 'ok', fallbackFrom: 'direct', fallbackReason: 'challenge' });
  });

  it.each([429, 503])('preserves HTTP %i and Retry-After without browser amplification', async (status) => {
    const { tracker, fetcher } = fixture();
    fetcher.mockResolvedValueOnce(new Response('', { status, headers: { 'Retry-After': '120' } }));
    await expect(tracker.fetch(number)).rejects.toMatchObject({ status, retryAfterMs: 120_000 });
    expect(scrapeUniversalPage).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects unrelated history before falling back and does not leak it into the result', async () => {
    const { tracker, fetcher, steps } = fixture();
    fetcher.mockResolvedValueOnce(reply({ data: { ...history.data, tracking_number: 'OTHER123' } }));
    vi.mocked(scrapeUniversalPage).mockRejectedValueOnce(new UpstreamHttpError('Ship24', 403));
    await expect(tracker.fetch(number)).rejects.toMatchObject({ status: 403 });
    expect(steps[1]).toMatchObject({ step: 'browser', fallbackFrom: 'direct', fallbackErrorType: 'SchemaError' });
  });

  it('validates inputs before network access', async () => {
    const { client, fetcher } = fixture();
    await expect(client.fetch('https://private.test', 1000)).rejects.toThrow('tracking number');
    await expect(client.fetch(number, Infinity)).rejects.toThrow('timeout');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('subtracts direct time from the browser budget', async () => {
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const { client, tracker } = fixture();
    vi.spyOn(client, 'fetch').mockImplementationOnce(async () => { clock += 7500; throw new Error('timeout'); });
    vi.mocked(scrapeUniversalPage).mockResolvedValueOnce({ events: [] });
    await tracker.fetch(number);
    expect(scrapeUniversalPage).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 37_500 }), expect.anything(), expect.anything());
  });

  it('runs the browser alone when no signed HTTP client is configured', async () => {
    vi.mocked(scrapeUniversalPage).mockResolvedValueOnce({ events: [], status: 'delivered' });
    await expect(new Ship24Tracker({ executablePath: '/test/chromium' }).fetch(number))
      .resolves.toMatchObject({ tracking_source: 'browser-session-response' });
    await expect(new Ship24Tracker({ executablePath: '/test/chromium', timeoutMs: Infinity }).fetch(number)).rejects.toThrow('timeout');
  });
});
