// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { TrawlClient, TrawlScrapeResponse } from '../../core/transport';
import { loadCapture, type CaptureSpec } from './capture';

const spec: CaptureSpec = {
  source: '17TRACK',
  url: 'https://t.17track.net/en#nums=ZZ12345678900',
  apiUrl: 'https://t.17track.net/track/restapi',
  budgetMs: 30_000,
};

const page = (overrides: Partial<TrawlScrapeResponse> = {}): TrawlScrapeResponse => ({
  url: spec.url,
  html: '<html></html>',
  cookies: [],
  userAgent: null,
  tier: 2,
  statusCode: 200,
  capturedResponses: [],
  raw: {},
  ...overrides,
});

const trawlReturning = (response: TrawlScrapeResponse) =>
  ({ scrape: vi.fn().mockResolvedValue(response) }) as unknown as TrawlClient;

describe('shared browser capture', () => {
  it('keeps a 304 page that still carries a fresh API capture', async () => {
    const trawl = trawlReturning(page({ statusCode: 304 }));
    await expect(loadCapture(trawl, spec)).resolves.toMatchObject({ statusCode: 304, url: spec.url });
    // The solved-page gate stays off for capture flows: validation happens
    // through the captured bodies, not the page status.
    expect(trawl.scrape).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ requireSolved: false }));
  });

  it('still rejects an unsolved tier or page status', async () => {
    for (const overrides of [{ tier: 1 }, { statusCode: 500 }, { tier: 1, statusCode: 304 }]) {
      await expect(loadCapture(trawlReturning(page(overrides)), spec)).rejects.toThrow('page unsolved');
    }
  });

  it('still rejects a page solved for another URL', async () => {
    const trawl = trawlReturning(page({ url: 'https://t.17track.net/en#nums=OTHER123' }));
    await expect(loadCapture(trawl, spec)).rejects.toThrow('incomplete page');
  });

  it('fails without a configured browser service', async () => {
    await expect(loadCapture(null, spec)).rejects.toThrow('tracking browser service');
  });
});
