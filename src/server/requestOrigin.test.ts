import { afterEach, expect, it, vi } from 'vitest';
import { headers } from 'next/headers';
import { requestOrigin } from './requestOrigin';

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
