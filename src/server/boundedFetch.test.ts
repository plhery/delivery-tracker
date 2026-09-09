import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeText, fetchBounded, parseJsonBytes, UpstreamNetworkError } from './boundedFetch';

const URL = 'https://carrier.example/tracking';
const OPTIONS = { provider: 'Carrier tracking', retryTransient: true };

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('bounded carrier request retries', () => {
  it.each(['headers', 'body'])('distinguishes interrupted %s from invalid carrier data', async (phase) => {
    const cause = new DOMException('Timed out', 'TimeoutError');
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (phase === 'headers') throw cause;
      return new Response(new ReadableStream({ start(controller) { controller.error(cause); } }));
    });
    await expect(fetchBounded(URL, {}, { provider: 'Carrier tracking', fetcher }))
      .rejects.toMatchObject({ name: 'UpstreamNetworkError', provider: 'Carrier tracking', cause });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([6, 60])('waits %s seconds for Retry-After and releases the rate-limited response before retrying', async (seconds) => {
    const limited = new Response('Too many requests', {
      status: 429, headers: { 'Retry-After': String(seconds) },
    });
    const cancel = vi.spyOn(limited.body!, 'cancel');
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(new Response('tracking data'));
    const result = fetchBounded(URL, { method: 'POST', body: '{}' }, { ...OPTIONS, fetcher });

    await vi.advanceTimersByTimeAsync(seconds * 1_000 - 1);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(decodeText((await result).bytes)).toBe('tracking data');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: '{}' });
    expect(fetcher.mock.calls[1]?.[1]?.signal).not.toBe(fetcher.mock.calls[0]?.[1]?.signal);
  });

  it('accepts an HTTP-date Retry-After without retrying early', async () => {
    vi.setSystemTime(new Date('2026-09-07T14:00:00Z'));
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', {
        status: 503, headers: { 'Retry-After': 'Mon, 07 Sep 2026 14:00:04 GMT' },
      }))
      .mockResolvedValueOnce(new Response('ok'));
    const result = fetchBounded(URL, {}, { ...OPTIONS, fetcher });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ response: { status: 200 } });
  });

  it.each([502, 503, 504])('retries HTTP %s once after a short delay when no header is supplied', async (status) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status }))
      .mockResolvedValueOnce(new Response('ok'));
    const result = fetchBounded(URL, {}, { ...OPTIONS, fetcher });
    await vi.advanceTimersByTimeAsync(999);
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({ response: { status: 200 } });
  });

  it('does not immediately retry a rate limit without Retry-After', async () => {
    const limited = new Response('Too many requests', { status: 429 });
    const cancel = vi.spyOn(limited.body!, 'cancel');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(limited);
    await expect(fetchBounded(URL, {}, { ...OPTIONS, fetcher })).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['61', '-1', 'invalid'])('leaves a long or malformed Retry-After (%s) as a real error', async (retryAfter) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', {
      status: 429, headers: { 'Retry-After': retryAfter },
    }));
    await expect(fetchBounded(URL, {}, { ...OPTIONS, fetcher })).rejects.toMatchObject({
      name: 'UpstreamHttpError', status: 429,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('recovers from a transport timeout with one fresh request', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException('Timed out', 'TimeoutError'))
      .mockResolvedValueOnce(new Response('ok'));
    const result = fetchBounded(URL, {}, { ...OPTIONS, fetcher });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toMatchObject({ response: { status: 200 } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(['http', 'network'])('surfaces persistent %s failures after the single retry', async (kind) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (kind === 'network') throw new TypeError('fetch failed');
      return new Response('', { status: 503 });
    });
    const failure = expect(fetchBounded(URL, {}, { ...OPTIONS, fetcher })).rejects.toThrow(
      kind === 'network' ? 'is unreachable' : 'HTTP 503',
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await failure;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404])('does not retry HTTP %s', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
    await expect(fetchBounded(URL, {}, { ...OPTIONS, fetcher })).rejects.toMatchObject({ status });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('requires opt-in and preserves callers that handle HTTP errors themselves', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('', { status: 429 }));
    await expect(fetchBounded(URL, {}, { provider: 'Tracking', fetcher })).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(fetchBounded(URL, {}, { ...OPTIONS, fetcher, allowHttpError: true }))
      .resolves.toMatchObject({ response: { status: 429 } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry oversized or malformed successful responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('invalid json'));
    await expect(fetchBounded(URL, {}, { ...OPTIONS, fetcher, maxBytes: 5 }))
      .rejects.toThrow('unexpectedly large response');
    expect(fetcher).toHaveBeenCalledOnce();
    const result = await fetchBounded(URL, {}, { ...OPTIONS, fetcher });
    expect(() => parseJsonBytes(result.bytes, 'Tracking')).toThrow('invalid tracking response');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not classify response-size limits as recoverable network failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('oversized'));
    await expect(fetchBounded(URL, {}, { provider: 'Tracking', fetcher, maxBytes: 2 }))
      .rejects.not.toBeInstanceOf(UpstreamNetworkError);
  });
});
