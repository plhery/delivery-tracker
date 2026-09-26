import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/delivered.json';
import { adapter, SfExpressTracker, sfExpressApiUrl, sfExpressTrackingUrl } from './adapter';
import { TrawlClient } from '../../core/transport';
import type { AdapterEnvironment } from '../../core/adapter';
import { parseTrackingInput } from '../../core/detection/parse';

const NUMBER = 'SF0000000000001';
const api = sfExpressApiUrl(NUMBER);
const capture = (overrides: Record<string, unknown> = {}) => ({ url: `${api}?lang=en&region=tw&translate=&app=bill`, status: 200,
  headers: {}, body: JSON.stringify(fixture), ...overrides });
const response = (captures = [capture()], overrides: Record<string, unknown> = {}) => ({ tier: 2, statusCode: 200,
  capturedResponses: captures, ...overrides });
const mock = (value = response()) => {
  const scrape = vi.fn().mockResolvedValue(value);
  return { scrape, tracker: new SfExpressTracker({ trawl: { scrape } as unknown as TrawlClient }) };
};

describe('SF Express browser adapter', () => {
  it('requests only the exact public page and matching routes within the caller budget', async () => {
    const { scrape, tracker } = mock();
    expect((await tracker.fetch(NUMBER, { budgetMs: 40_000 })).events).toHaveLength(6);
    expect(scrape).toHaveBeenCalledOnce();
    const [request, options] = scrape.mock.calls[0];
    expect(request).toMatchObject({ url: sfExpressTrackingUrl(NUMBER), skipHttp: true, maxTier: 3, captureResponses: [api] });
    expect(request.maxTimeout).toBeGreaterThan(24_000);
    expect(request.maxTimeout).toBeLessThanOrEqual(25_000);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.timeoutMs).toBe(request.maxTimeout);
  });

  it('rejects unrelated identities, endpoints, parameters and incomplete captures', async () => {
    for (const changed of [
      { url: api.replace(NUMBER, 'SF0000000000002') }, { url: api.replace('htm.sf-express.com', 'example.invalid') },
      { url: `${api}?app=bill&app=other` }, { url: `${api}?region=cn` }, { url: `${api}?token=unrelated` },
      { body: null }, { error: 'read failed' }, { truncated: true }, { base64Encoded: true },
    ]) {
      await expect(mock(response([capture(changed)])).tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'transport' });
    }
    await expect(mock(response([], { statusCode: 403 })).tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'transport' });
    await expect(mock(response([capture()], { tier: 1 })).tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'transport' });
  });

  it('keeps upstream failures separate from not-found', async () => {
    for (const [status, kind] of [[403, 'challenge'], [429, 'rate_limited'], [404, 'transport'], [410, 'transport'], [500, 'indeterminate']] as const) {
      await expect(mock(response([capture({ status, headers: { 'retry-after': '2' } })])).tracker.fetch(NUMBER)).rejects.toMatchObject({ kind });
    }
    for (const body of ['{', 'x'.repeat(1_000_001)]) {
      await expect(mock(response([capture({ body })])).tracker.fetch(NUMBER)).rejects.toMatchObject({ kind: 'schema' });
    }
  });

  it('does not dispatch without a service, valid input, usable budget or active signal', async () => {
    await expect(new SfExpressTracker({ trawl: null }).fetch(NUMBER)).rejects.toMatchObject({ kind: 'challenge' });
    const { tracker, scrape } = mock();
    await expect(tracker.fetch('invalid')).rejects.toMatchObject({ kind: 'input_required' });
    await expect(tracker.fetch(NUMBER, { budgetMs: 15_000 })).rejects.toMatchObject({ kind: 'budget' });
    await expect(tracker.fetch(NUMBER, { budgetMs: Infinity })).rejects.toBeInstanceOf(TypeError);
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await expect(tracker.fetch(NUMBER, { signal: controller.signal })).rejects.toThrow('cancelled');
    expect(scrape).not.toHaveBeenCalled();
  });

  it('cancels in-flight browser work through the client transport and preserves request serialization', async () => {
    const controller = new AbortController();
    let sent: Record<string, unknown> | undefined;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      sent = JSON.parse(String(init?.body));
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        controller.abort(new Error('caller cancelled'));
      });
    });
    const tracker = new SfExpressTracker({ trawl: new TrawlClient('http://browser.invalid', fetcher) });
    await expect(tracker.fetch(NUMBER, { signal: controller.signal })).rejects.toThrow('caller cancelled');
    expect(sent).toMatchObject({ captureResponses: [api], url: sfExpressTrackingUrl(NUMBER) });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('registers the direct step through the normal adapter contract', async () => {
    const { scrape } = mock();
    const instance = adapter({ trawl: { scrape }, recorder: undefined } as unknown as AdapterEnvironment);
    expect(instance.id).toBe('sf-express'); expect(instance.steps).toEqual(['trawl']);
    expect((await instance.track({ number: NUMBER })).status).toBe('delivered');
    expect(parseTrackingInput(sfExpressTrackingUrl(NUMBER))).toMatchObject({ carrier: 'sf-express', trackingNumber: NUMBER, source: 'link', confidence: 'high' });
  });
});
