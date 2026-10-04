import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApiLinks } from '../links';
import { forgetLookupProof, getLookupProof, lookupProof, mountLookupVerification } from './verification';

let options: Record<string, unknown>;
let mounted: ReturnType<typeof mountLookupVerification>;
beforeEach(() => {
  forgetLookupProof(lookupProof());
  window.turnstile = {
    render: vi.fn((_element, config) => { options = config; return 'widget'; }), remove: vi.fn(),
  };
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ siteKey: 'public-key' })));
  mounted = mountLookupVerification(document.createElement('div'), 'en');
});
afterEach(() => {
  mounted.dispose();
  forgetLookupProof(lookupProof());
  delete window.turnstile;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function complete() {
  await vi.waitFor(() => expect(window.turnstile?.render).toHaveBeenCalled());
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ proof: 'verified-proof', expiresAt: Date.now() + 900_000 }));
  (options.callback as (token: string) => void)('single-use-token');
}

it('warms once, shares verification between requests, and reuses the resulting proof', async () => {
  mounted.warm();
  const a = getLookupProof();
  const b = getLookupProof();
  await complete();
  await expect(a).resolves.toBe('verified-proof');
  await expect(b).resolves.toBe('verified-proof');
  await expect(getLookupProof()).resolves.toBe('verified-proof');
  expect(window.turnstile?.render).toHaveBeenCalledTimes(1);
  expect(options).toMatchObject({ appearance: 'interaction-only', action: 'parcel_lookup', 'response-field': false });
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string)).toEqual({ token: 'single-use-token' });
});

it('lets detection cancel without cancelling verification needed by the lookup', async () => {
  const stop = new AbortController();
  const a = getLookupProof(stop.signal);
  const b = getLookupProof();
  const assertion = expect(a).rejects.toMatchObject({ name: 'AbortError' });
  stop.abort();
  await assertion;
  await complete();
  await expect(b).resolves.toBe('verified-proof');
});

it('recovers after verification fails without retaining a bad token', async () => {
  const first = getLookupProof();
  const failure = expect(first).rejects.toThrow('verification');
  await vi.waitFor(() => expect(window.turnstile?.render).toHaveBeenCalled());
  (options['error-callback'] as () => void)();
  await failure;
  expect(lookupProof()).toBeNull();
  const second = getLookupProof();
  await vi.waitFor(() => expect(window.turnstile?.render).toHaveBeenCalledTimes(2));
  await complete();
  await expect(second).resolves.toBe('verified-proof');
});

it('retries only an explicit verification refusal, preserving the request and signal', async () => {
  const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403, headers: { 'X-Lookup-Verification': 'required' } }))
    .mockResolvedValueOnce(Response.json({ trackingNumber: 'TEST123456', carrier: 'unknown' }));
  const answer = createApiLinks(request).detectCarrierPublic('TEST123456');
  await complete();
  await expect(answer).resolves.toMatchObject({ carrier: 'unknown' });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]![1]).toMatchObject({ credentials: 'omit', headers: { 'X-Lookup-Proof': 'verified-proof' }, body: JSON.stringify({ trackingNumber: 'TEST123456' }) });
});

it('does not loop or resend writes for ordinary forbidden responses', async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 }));
  await expect(createApiLinks(request).detectCarrierPublic('TEST123456')).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

it('fails closed on an unavailable configuration and can retry', async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(getLookupProof()).rejects.toThrow('verification');
  const retry = getLookupProof();
  await complete();
  await expect(retry).resolves.toBe('verified-proof');
});

it('handles a blocked script without hanging, and retries with a fresh script', async () => {
  delete window.turnstile;
  const first = getLookupProof();
  const rejected = expect(first).rejects.toThrow('verification');
  await vi.waitFor(() => expect(document.querySelector('script[src*="turnstile"]')).not.toBeNull());
  document.querySelector('script[src*="turnstile"]')!.dispatchEvent(new Event('error'));
  await rejected;
  expect(document.querySelector('script[src*="turnstile"]')).toBeNull();
  const second = getLookupProof();
  await vi.waitFor(() => expect(document.querySelector('script[src*="turnstile"]')).not.toBeNull());
  window.turnstile = { render: vi.fn((_element, config) => { options = config; return 'recovered'; }), remove: vi.fn() };
  document.querySelector('script[src*="turnstile"]')!.dispatchEvent(new Event('load'));
  await complete();
  await expect(second).resolves.toBe('verified-proof');
  document.querySelector('script[src*="turnstile"]')!.remove();
});
