import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { carrierRequirements } from './carriers';
import {
  forgetPostcode,
  MAX_POSTCODES,
  POSTCODES_STORAGE_KEY,
  rememberedPostcode,
  rememberPostcode,
  usePostcodeMemory,
} from './postcodeMemory';
import { forgetAllRecents, forgetRecent, rememberParcel } from '../peek/recents';
import { LINK_ID, OWNER_KEY, testView } from '../test/parcelLinks';

// Every postcode here is a city centre's, not anyone's address.
const dpd = carrierRequirements('dpd', '06080000000002')[0]!;
const glsSwitzerland = carrierRequirements('gls-ch', '12345678')[0]!;

describe('remembered postcodes', () => {
  it("takes the same carrier's newest postcode first", () => {
    expect(rememberedPostcode('gls-ch', glsSwitzerland, [
      { carrier: 'dpd', postcode: '8004' },
      { carrier: 'gls-ch', postcode: '1200' },
      { carrier: 'gls-ch', postcode: '3011' },
    ])).toBe('1200');
  });

  it("falls back to another carrier's, when this field takes it", () => {
    expect(rememberedPostcode('gls-ch', glsSwitzerland, [{ carrier: 'dpd', postcode: '8004' }])).toBe('8004');
    expect(rememberedPostcode('gls-ch', glsSwitzerland, [
      { carrier: 'dpd', postcode: '75001' },
      { carrier: 'dpd', postcode: '1012 AB' },
      { carrier: 'swiss-post', postcode: '3011' },
    ])).toBe('3011');
    expect(rememberedPostcode('gls-ch', glsSwitzerland, [{ carrier: 'dpd', postcode: '75001' }])).toBeUndefined();
  });

  it('gives a postcode as carriers print it, and skips empty ones', () => {
    expect(rememberedPostcode('dpd', dpd, [
      { carrier: 'dpd', postcode: null },
      { carrier: 'dpd', postcode: '  ' },
      { carrier: 'gls-de', postcode: ' sw1a  1aa ' },
    ])).toBe('SW1A 1AA');
    expect(rememberedPostcode('dpd', dpd, [])).toBeUndefined();
  });
});

describe('the postcodes this device gave', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const { postcode } of renderHook(() => usePostcodeMemory()).result.current) forgetPostcode(postcode!);
    localStorage.removeItem(POSTCODES_STORAGE_KEY);
  });
  const kept = () => JSON.parse(localStorage.getItem(POSTCODES_STORAGE_KEY) ?? '[]') as unknown;

  it('keeps the newest first, once per carrier, and only a few', () => {
    const { result } = renderHook(() => usePostcodeMemory());
    act(() => {
      rememberPostcode('dpd', ' sw1a  1aa ');
      rememberPostcode('gls-ch', '8004');
      rememberPostcode('dpd', 'SW1A 1AA');
    });
    expect(result.current).toEqual([{ carrier: 'dpd', postcode: 'SW1A 1AA' }, { carrier: 'gls-ch', postcode: '8004' }]);
    act(() => { for (const postcode of ['1200', '3011', '6900', '7000', '9000']) rememberPostcode('swiss-post', postcode); });
    expect(result.current).toHaveLength(MAX_POSTCODES);
    expect(result.current[0]).toEqual({ carrier: 'swiss-post', postcode: '9000' });
    expect(result.current).not.toContainEqual({ carrier: 'gls-ch', postcode: '8004' });
  });

  it('keeps nothing that is not a postcode', () => {
    rememberPostcode('dpd', '');
    rememberPostcode('dpd', 'https://example.test/?postcode=8004');
    expect(kept()).toEqual([]);
    localStorage.setItem(POSTCODES_STORAGE_KEY, JSON.stringify([{ carrier: 'nobody', postcode: '8004' }, { carrier: 'dpd', postcode: '<b>' }, { carrier: 'dpd', postcode: '8004' }]));
    expect(renderHook(() => usePostcodeMemory()).result.current).toEqual([{ carrier: 'dpd', postcode: '8004' }]);
    localStorage.setItem(POSTCODES_STORAGE_KEY, '{damaged');
    expect(renderHook(() => usePostcodeMemory()).result.current).toEqual([]);
  });

  it('forgets a postcode for every carrier it was given to', () => {
    rememberPostcode('dpd', '8004');
    rememberPostcode('gls-ch', '8004');
    rememberPostcode('dpd', '1200');
    forgetPostcode(' 8004 ');
    expect(kept()).toEqual([{ carrier: 'dpd', postcode: '1200' }]);
    forgetPostcode('1200');
    expect(localStorage.getItem(POSTCODES_STORAGE_KEY)).toBeNull();
  });

  it('outlives the parcels it was given for', () => {
    rememberParcel({ id: LINK_ID, key: OWNER_KEY, view: testView({ parcel: { carrier: 'gls-ch' } }) });
    rememberPostcode('gls-ch', '8004');
    forgetRecent(LINK_ID);
    forgetAllRecents();
    expect(kept()).toEqual([{ carrier: 'gls-ch', postcode: '8004' }]);
  });

  it('works for the life of the page when storage refuses it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const { result } = renderHook(() => usePostcodeMemory());
    act(() => rememberPostcode('dpd', '8004'));
    expect(result.current).toEqual([{ carrier: 'dpd', postcode: '8004' }]);
  });
});
