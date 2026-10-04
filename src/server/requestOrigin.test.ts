import { afterEach, expect, it, vi } from 'vitest';
import { headers } from 'next/headers';
import { requestOrigin, siteOrigin } from './requestOrigin';

vi.mock('next/headers', () => ({ headers: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it('keeps HTTPS social metadata behind Cloudflare and an HTTP internal proxy', async () => {
  vi.mocked(headers).mockResolvedValue(new Headers({
    host: 'delivery.example.test', 'x-forwarded-proto': 'http', 'cf-visitor': '{"scheme":"https"}',
  }));
  expect((await requestOrigin()).href).toBe('https://delivery.example.test/');
});

it('uses the standard proxy scheme when the Cloudflare header is absent', async () => {
  vi.mocked(headers).mockResolvedValue(new Headers({
    host: 'delivery.example.test', 'x-forwarded-proto': 'https',
  }));
  expect((await requestOrigin()).href).toBe('https://delivery.example.test/');
});

it.each(['broken', 'null', '{"scheme":"javascript"}'])('ignores a malformed edge scheme: %s', async (visitor) => {
  vi.mocked(headers).mockResolvedValue(new Headers({
    host: 'delivery.example.test', 'x-forwarded-proto': 'https', 'cf-visitor': visitor,
  }));
  expect((await requestOrigin()).href).toBe('https://delivery.example.test/');
});

it('keeps local development URLs on HTTP', async () => {
  vi.mocked(headers).mockResolvedValue(new Headers({ host: '127.0.0.1:4173' }));
  expect((await requestOrigin()).href).toBe('http://127.0.0.1:4173/');
});

it('writes the site’s addresses on the canonical origin when one is configured, else on the request’s', async () => {
  vi.mocked(headers).mockResolvedValue(new Headers({ host: 'internal.example.test', 'x-forwarded-proto': 'https' }));
  expect((await siteOrigin()).href).toBe('https://internal.example.test/');
  vi.stubEnv('CANONICAL_ORIGIN', 'https://peek.example.test');
  expect((await siteOrigin()).href).toBe('https://peek.example.test/');
  // A setting the startup check refuses names nothing.
  vi.stubEnv('CANONICAL_ORIGIN', 'peek.example.test/app');
  expect((await siteOrigin()).href).toBe('https://internal.example.test/');
});
