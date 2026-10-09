import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSharedParcelInput, readSharedParcel, shareTargetAddress } from './shareTarget';

beforeEach(() => window.history.replaceState({}, '', '/'));
afterEach(() => vi.unstubAllGlobals());

describe('PWA share target', () => {
  it('reads a one-time service-worker draft without putting private content in the URL', async () => {
    window.history.replaceState({}, '', shareTargetAddress());
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      label: 'New shoes',
      trackingInput: 'https://service.post.ch/track\nTracking 993412345612345678',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);

    await expect(readSharedParcel()).resolves.toEqual({ input: {
      label: 'New shoes',
      trackingInput: 'https://service.post.ch/track\nTracking 993412345612345678',
    } });
    expect(fetch).toHaveBeenCalledWith('/share-target/draft', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(window.location.href).not.toContain('993412345612345678');
  });

  it('ignores ordinary query strings and removes only the share marker', async () => {
    window.history.replaceState({}, '', '/?parcel=parcel-1&share-target=1');
    clearSharedParcelInput();
    expect(window.location.search).toBe('?parcel=parcel-1');

    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(readSharedParcel()).resolves.toBeNull();
    // A marker the worker never writes is not a share.
    window.history.replaceState({}, '', '/?share-target=yes');
    await expect(readSharedParcel()).resolves.toBeNull();
    clearSharedParcelInput();
    expect(window.location.search).toBe('?share-target=yes');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tells the app why a share did not come through, whatever the worker could not keep', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    // The worker named the reason: no draft to ask for.
    for (const failure of ['too-large', 'failed'] as const) {
      window.history.replaceState({}, '', `${shareTargetAddress(failure)}&parcel=parcel-1`);
      await expect(readSharedParcel()).resolves.toEqual({ failure });
      clearSharedParcelInput();
      expect(window.location.search).toBe('?parcel=parcel-1');
    }
    expect(fetch).not.toHaveBeenCalled();

    // A draft that is gone, expired or empty is a share that failed too.
    window.history.replaceState({}, '', shareTargetAddress());
    await expect(readSharedParcel()).resolves.toEqual({ failure: 'failed' });
    fetch.mockResolvedValueOnce(Response.json({ label: 'Order', trackingInput: '   ' }));
    await expect(readSharedParcel()).resolves.toEqual({ failure: 'failed' });
    fetch.mockRejectedValueOnce(new TypeError('offline'));
    await expect(readSharedParcel()).resolves.toEqual({ failure: 'failed' });
  });
});
