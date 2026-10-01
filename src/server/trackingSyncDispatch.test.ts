import { describe, expect, it, vi } from 'vitest';
import { CarrierTrackingAdapter } from './trackingSync';
describe('carrier tracking dispatch', () => {
  it.each([['dhl', 'LF123456785DE'], ['dhl-ecommerce', '33870000000000001']])('passes %s credentials to the public adapter', async (carrier, number) => {
    const adapter = new CarrierTrackingAdapter();
    const track = vi.spyOn(adapter.registry.for(carrier)!, 'track').mockResolvedValue({ status: 'in_transit' });
    expect(await adapter.fetch(carrier, number, null)).toMatchObject({ status: 'in_transit' });
    expect(track.mock.calls[0][0]).toEqual({ number, trackingUrl: null, postcode: null });
    track.mockRestore();
  });
});
