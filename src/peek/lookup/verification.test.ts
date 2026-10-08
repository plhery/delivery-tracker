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
  sessionStorage.clear();
});

const PROOF_KEY = 'sdt.lookup-proof.v1';
const saved = () => JSON.parse(sessionStorage.getItem(PROOF_KEY) ?? 'null') as unknown;
/** This module as a reloaded page has it: nothing in memory, the tab's session storage kept. */
async function reloaded() {
  vi.resetModules();
  return { ...await import('./verification'), ...await import('../links') };
}
const required = () => new Response(null, { status: 403, headers: { 'X-Lookup-Verification': 'required' } });

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

it('keeps the proof in the tab through a reload, until it expires', async () => {
  mounted.warm();
  await complete();
  await expect(getLookupProof()).resolves.toBe('verified-proof');
  expect(saved()).toEqual({ proof: 'verified-proof', expiresAt: expect.any(Number) });
  const page = await reloaded();
  expect(page.lookupProof()).toBe('verified-proof');
  // No verification is mounted on the reloaded page: the saved proof is used as it is.
  await expect(page.getLookupProof()).resolves.toBe('verified-proof');
  const request = vi.fn().mockResolvedValue(Response.json({ trackingNumber: 'TEST123456', carrier: 'unknown' }));
  await page.createApiLinks(request).detectCarrierPublic('TEST123456');
  expect(request.mock.calls[0]![1]).toMatchObject({ headers: { 'X-Lookup-Proof': 'verified-proof' } });
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 900_000);
  expect(page.lookupProof()).toBeNull();
  expect(saved()).toBeNull();
});

it('forgets a refused saved proof and saves the one that replaces it', async () => {
  sessionStorage.setItem(PROOF_KEY, JSON.stringify({ proof: 'refused-proof', expiresAt: Date.now() + 600_000 }));
  const page = await reloaded();
  const verifier = page.mountLookupVerification(document.createElement('div'), 'en');
  try {
    const request = vi.fn().mockResolvedValueOnce(required())
      .mockResolvedValueOnce(Response.json({ trackingNumber: 'TEST123456', carrier: 'unknown' }));
    const answer = page.createApiLinks(request).detectCarrierPublic('TEST123456');
    await complete();
    await expect(answer).resolves.toMatchObject({ carrier: 'unknown' });
    expect(request.mock.calls.map(([, init]) => (init as RequestInit & { headers: Record<string, string> }).headers['X-Lookup-Proof']))
      .toEqual(['refused-proof', 'verified-proof']);
    expect(saved()).toMatchObject({ proof: 'verified-proof' });
  } finally {
    verifier.dispose();
  }
});

it('drops a saved proof the server refuses again after verifying', async () => {
  const page = await reloaded();
  const verifier = page.mountLookupVerification(document.createElement('div'), 'en');
  try {
    const refused = vi.fn().mockImplementation(async () => required());
    const answer = page.createApiLinks(refused).detectCarrierPublic('TEST123456');
    const failure = expect(answer).rejects.toThrow('verification');
    await complete();
    await failure;
    expect(refused).toHaveBeenCalledTimes(2);
    expect(saved()).toBeNull();
    expect(page.lookupProof()).toBeNull();
  } finally {
    verifier.dispose();
  }
});

it('ignores an unreadable or expired saved proof', async () => {
  sessionStorage.setItem(PROOF_KEY, '{not json');
  expect((await reloaded()).lookupProof()).toBeNull();
  sessionStorage.setItem(PROOF_KEY, JSON.stringify({ proof: 42, expiresAt: Date.now() + 600_000 }));
  expect((await reloaded()).lookupProof()).toBeNull();
  sessionStorage.setItem(PROOF_KEY, JSON.stringify({ proof: 'old-proof', expiresAt: Date.now() - 1 }));
  expect((await reloaded()).lookupProof()).toBeNull();
  expect(saved()).toBeNull();
});

it('keeps the proof for the page when session storage is unavailable', async () => {
  const unavailable = () => { throw new DOMException('Storage is disabled', 'SecurityError'); };
  vi.stubGlobal('sessionStorage', { getItem: unavailable, setItem: unavailable, removeItem: unavailable });
  expect(() => sessionStorage.getItem(PROOF_KEY)).toThrow('disabled');
  const page = await reloaded();
  const verifier = page.mountLookupVerification(document.createElement('div'), 'en');
  try {
    const proof = page.getLookupProof();
    await complete();
    await expect(proof).resolves.toBe('verified-proof');
    expect(page.lookupProof()).toBe('verified-proof');
    page.forgetLookupProof('verified-proof');
    expect(page.lookupProof()).toBeNull();
  } finally {
    verifier.dispose();
  }
});
