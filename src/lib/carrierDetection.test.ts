import { afterEach, expect, it, vi } from 'vitest';
import { lookupCarrier } from './carrierDetection';

afterEach(() => vi.restoreAllMocks());
const auth = { userId: 'test-user', getAccessToken: async () => 'test-token' };

it('sends an authenticated, cancellable lookup and checks its shipment identity', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    trackingNumber: '123456789018', carrier: 'gls-de',
  })));
  const signal = new AbortController().signal;
  await expect(lookupCarrier('123456789018', auth, signal)).resolves.toMatchObject({ carrier: 'gls-de' });
  expect(fetcher).toHaveBeenCalledWith('/api/carriers/detect', expect.objectContaining({
    method: 'POST', signal: expect.any(AbortSignal), body: JSON.stringify({ trackingNumber: '123456789018' }), cache: 'no-store',
  }));
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer test-token');
});

it.each([
  { trackingNumber: '999999999999', carrier: 'gls-de' },
  { trackingNumber: '123456789018', carrier: 'invented' },
])('rejects a mismatched lookup response', async (payload) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload)));
  await expect(lookupCarrier('123456789018', auth)).rejects.toThrow('Invalid carrier lookup');
});

it('rejects upstream lookup failures', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502 }));
  await expect(lookupCarrier('123456789018', auth)).rejects.toThrow('unavailable');
});
