import { describe, expect, it, vi } from 'vitest';
import { carrierLookupKey, SharedLookups } from './sharedLookups';
import type { JsonObject } from './types';

const routing = (extra: JsonObject = {}) => ({ version: 1, configured_carrier: 'unknown', failures: {}, probe_cursor: 0, discovery_cursor: 0, ...extra });
const copy = (id: string, extra: JsonObject = {}, data: JsonObject = {}): JsonObject => ({
  id, carrier: 'unknown', tracking_number: 'TEST1234', tracking_url: null, dpd_postcode: null, ...extra,
  carrier_data: { routing: routing(), ...data },
});

describe('SharedLookups', () => {
  it('lets every copy of a number follow the routing of the copy checked last', () => {
    const older = copy('older', { label: 'Shoes', last_synced_at: '2026-09-10T11:00:00Z' }, {
      routing: routing({ preferred_provider: '17TRACK', failures: { Ship24: { count: 1, kind: 'transport', retry_at: '2026-09-10T13:00:00Z' } },
        last_event_at: '2026-09-09T10:00:00Z', last_success_at: '2026-09-10T11:00:00Z', consecutive_failures: 2, next_check_at: '2026-09-10T11:15:00Z' }),
      delivery_probe: { at: '2026-09-10T10:00:00Z', origin_update: null }, sender_name: 'Shop',
      earlier_checked_at: '2026-09-10T10:00:00Z',
    });
    const newer = copy('newer', { label: 'Gift', last_synced_at: '2026-09-10T11:05:00Z' }, {
      routing: routing({ preferred_provider: 'Ship24', confirmed_carrier: 'ups', confirmed_number: 'TEST1234', last_event_at: '2026-09-10T09:00:00Z' }),
      earlier_checked_at: '2026-09-10T11:05:00Z',
    });
    const lookups = new SharedLookups([older, newer]);
    const seen = lookups.for(older).parcel;
    expect(seen).toMatchObject({ id: 'older', label: 'Shoes', carrier_data: { sender_name: 'Shop', earlier_checked_at: '2026-09-10T11:05:00Z', routing: {
      preferred_provider: 'Ship24', confirmed_carrier: 'ups', confirmed_number: 'TEST1234', failures: {},
      // The parcel's own streak, watermark and schedule stay its own.
      last_event_at: '2026-09-09T10:00:00Z', last_success_at: '2026-09-10T11:00:00Z', consecutive_failures: 2, next_check_at: '2026-09-10T11:15:00Z',
    } } });
    expect((seen.carrier_data as JsonObject).delivery_probe).toBeUndefined();
    expect(lookups.for(newer).parcel).toEqual(newer);
    // The parcel itself is left as it was loaded.
    expect(older).toMatchObject({ carrier_data: { routing: { preferred_provider: '17TRACK' } } });
  });

  it('keeps lookups that send different inputs apart', () => {
    const base = copy('base', { last_synced_at: '2026-09-10T11:05:00Z' }, { routing: routing({ preferred_provider: 'Ship24' }) });
    const own = (parcel: JsonObject) => new SharedLookups([parcel, base]).for(parcel).parcel;
    for (const other of [
      copy('postcode', { dpd_postcode: '0000' }),
      copy('link', { tracking_url: 'https://carrier.invalid/t' }),
      copy('carrier', { carrier: 'ups' }),
      copy('country', {}, { lookup_country_hint: 'CH' }),
      copy('answer', {}, { universal_input: { number: 'TEST1234', postcode: '0000' } }),
      copy('leg', {}, { original_carrier: 'ups', active_tracking_carrier: 'swiss-post', active_tracking_number: 'TEST5678' }),
    ]) expect(own(other), String(other.id)).toEqual(other);
  });

  it('never hands one copy the inputs another kept from an earlier configuration', () => {
    // This copy's confirmed route used a postcode it no longer has: neither copy follows the other.
    const earlier = copy('earlier', { last_synced_at: '2026-09-10T11:05:00Z' }, {
      routing: routing({ confirmed_carrier: 'dpd', confirmed_number: 'TEST1234', confirmed_postcode: '0000' }) });
    const other = copy('other', { last_synced_at: '2026-09-10T11:00:00Z' });
    const lookups = new SharedLookups([earlier, other]);
    expect(lookups.for(other).parcel).toEqual(other);
    expect(lookups.for(earlier).parcel).toEqual(earlier);
    // Inputs the copies share are no secret between them.
    const same = copy('same', { dpd_postcode: '0000', last_synced_at: '2026-09-10T11:05:00Z' }, {
      routing: routing({ confirmed_carrier: 'dpd', confirmed_number: 'TEST1234', confirmed_postcode: '0000' }) });
    const follower = copy('follower', { dpd_postcode: '0000', last_synced_at: '2026-09-10T11:00:00Z' });
    expect(new SharedLookups([same, follower]).for(follower).parcel)
      .toMatchObject({ carrier_data: { routing: { confirmed_carrier: 'dpd', confirmed_postcode: '0000' } } });
  });

  it('asks once per key and gives every check its own copy of the answer or the same failure', async () => {
    const lookups = new SharedLookups();
    const first = lookups.for(copy('first'));
    const second = lookups.for(copy('second'));
    const fetch = vi.fn().mockResolvedValue({ status: 'in_transit', events: [] });
    const answer = await first.once(carrierLookupKey('ups', 'TEST1234', null, null), fetch);
    const again = await second.once(carrierLookupKey('ups', 'test-1234', null, null), fetch);
    expect(fetch).toHaveBeenCalledOnce();
    expect(again).toEqual(answer);
    expect(again).not.toBe(answer);
    expect([first.shared, second.shared]).toEqual([0, 1]);
    await first.once(carrierLookupKey('ups', 'TEST1234', null, '0000'), fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    const failure = new Error('down');
    const failing = vi.fn().mockRejectedValue(failure);
    await expect(first.once(['universal', 'Ship24'], failing)).rejects.toBe(failure);
    await expect(second.reuse(['universal', 'Ship24'])).rejects.toBe(failure);
    expect(second.reuse(['universal', '17TRACK'])).toBeUndefined();
    expect(failing).toHaveBeenCalledOnce();
  });
});
