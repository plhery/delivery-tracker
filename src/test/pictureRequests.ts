import { vi } from 'vitest';

/**
 * Refuses whatever a picture asks the web for, and returns the mock that saw
 * it. The image renderer fetches a font for any character its own lack, and a
 * drawing for any emoji. It unpacks its own WebAssembly from a `data:`
 * address, which leaves the machine no more than a file read does: that one
 * passes. `vi.unstubAllGlobals()` removes it.
 */
export function refuseTheWeb() {
  const fetched = globalThis.fetch;
  const asked = vi.fn(async (address: string | URL | Request) => { throw new Error(`the picture must not load ${String(address).slice(0, 60)}`); });
  vi.stubGlobal('fetch', (address: string | URL | Request, init?: RequestInit) => String(address).startsWith('data:') ? fetched(address, init) : asked(address));
  return asked;
}
