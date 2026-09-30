import { describe, expect, it } from 'vitest';
import { pickupPoint, pickupPointMapsUrl } from './pickupPoint';

describe('pickup point', () => {
  it('reads the first line as the name and the rest as the address', () => {
    expect(pickupPoint(' Corner shop \n12 Main Street\n\n1000 Town ')).toEqual({
      name: 'Corner shop', address: '12 Main Street, 1000 Town', query: 'Corner shop, 12 Main Street, 1000 Town',
    });
    expect(pickupPoint('Post office 42')).toEqual({ name: 'Post office 42', address: null, query: 'Post office 42' });
    for (const empty of [undefined, null, '', ' \n ']) expect(pickupPoint(empty)).toBeNull();
  });

  it('gives directions to an address and searches a name alone', () => {
    const shop = pickupPoint('Corner shop & café\n12 Main Street')!;
    expect(pickupPointMapsUrl(shop, true)).toBe('https://maps.apple.com/?daddr=Corner%20shop%20%26%20caf%C3%A9%2C%2012%20Main%20Street');
    expect(pickupPointMapsUrl(shop, false)).toBe('https://www.google.com/maps/dir/?api=1&destination=Corner%20shop%20%26%20caf%C3%A9%2C%2012%20Main%20Street');
    const office = pickupPoint('Post office 42')!;
    expect(pickupPointMapsUrl(office, true)).toBe('https://maps.apple.com/?q=Post%20office%2042');
    expect(pickupPointMapsUrl(office, false)).toBe('https://www.google.com/maps/search/?api=1&query=Post%20office%2042');
  });
});
