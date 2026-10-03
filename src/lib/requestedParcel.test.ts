import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberRequestedParcel, REQUESTED_PARCEL_STORAGE_KEY as KEY, restoreRequestedParcel } from './requestedParcel';

const PARCEL = '40000000-0000-0000-0000-000000000004';
const OTHER = '50000000-0000-0000-0000-000000000005';
const at = (address: string) => window.history.replaceState(null, '', address);
const address = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

afterEach(() => {
  sessionStorage.clear();
  at('/');
  vi.restoreAllMocks();
});

describe('the parcel a link asked for, across a sign-in that returns to `/`', () => {
  it('is put back in the address once, and the deliveries are told', () => {
    const told = vi.fn();
    window.addEventListener('popstate', told);
    at(`/?parcel=${PARCEL}`);
    rememberRequestedParcel();
    // The provider returns to the origin alone.
    at('/');
    restoreRequestedParcel();
    expect(address()).toBe(`/?parcel=${PARCEL}`);
    expect(told).toHaveBeenCalledTimes(1);
    // The note is used once: closing the parcel does not bring it back.
    at('/');
    restoreRequestedParcel();
    expect(address()).toBe('/');
    expect(told).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(KEY)).toBeNull();
    window.removeEventListener('popstate', told);
  });

  it('keeps what else the address says, and leaves a parcel it already names', () => {
    at(`/?parcel=${PARCEL}`);
    rememberRequestedParcel();
    at('/?view=passport#top');
    restoreRequestedParcel();
    expect(address()).toBe(`/?view=passport&parcel=${PARCEL}#top`);

    at(`/?parcel=${PARCEL}`);
    rememberRequestedParcel();
    at(`/?parcel=${OTHER}`);
    restoreRequestedParcel();
    expect(address()).toBe(`/?parcel=${OTHER}`);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('notes nothing for an address that asks for no parcel, and drops what an earlier one asked for', () => {
    at(`/?parcel=${PARCEL}`);
    rememberRequestedParcel();
    at('/');
    rememberRequestedParcel();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    restoreRequestedParcel();
    expect(address()).toBe('/');
  });

  it.each([
    ['is not a parcel id', '/?parcel=%3Cscript%3E'],
    ['belongs to another page', `/p/k7Qm2xHd9RtW?parcel=${PARCEL}`],
  ])('notes nothing when what the address names %s', (_why, where) => {
    at(where);
    rememberRequestedParcel();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is not put back anywhere but in the deliveries’ own address', () => {
    at(`/?parcel=${PARCEL}`);
    rememberRequestedParcel();
    at('/demo');
    restoreRequestedParcel();
    expect(address()).toBe('/demo');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('is forgotten after an hour, and a note that is not one is ignored', () => {
    at(`/?parcel=${PARCEL}`);
    rememberRequestedParcel(Date.now() - 61 * 60_000);
    at('/');
    restoreRequestedParcel();
    expect(address()).toBe('/');

    for (const note of ['{', '"text"', JSON.stringify({ id: 'not-an-id', at: Date.now() }), JSON.stringify({ id: PARCEL })]) {
      sessionStorage.setItem(KEY, note);
      restoreRequestedParcel();
      expect(address()).toBe('/');
      expect(sessionStorage.getItem(KEY)).toBeNull();
    }
  });

  it('does nothing, quietly, where the tab keeps no notes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    at(`/?parcel=${PARCEL}`);
    expect(() => rememberRequestedParcel()).not.toThrow();
    at('/');
    expect(() => restoreRequestedParcel()).not.toThrow();
    expect(address()).toBe('/');
  });
});
