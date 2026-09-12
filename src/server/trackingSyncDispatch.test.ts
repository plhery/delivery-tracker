import { describe, expect, it, vi } from 'vitest';
import { DHLTracker } from './dhl';
import { DHLEcommerceTracker } from './dhlEcommerce';
import { CarrierTrackingAdapter } from './trackingSync';

/**
 * Host-side dispatch: the carrier ids the sync resolves through the generated
 * registry must reach the tracker their folder registers, with the tracking
 * number as its only argument. The adapters themselves are tested in
 * packages/carriers/carriers/<id>/adapter.test.ts, which cannot import host
 * modules across the package boundary.
 */
const DHL_NUMBER = 'LF123456785DE';
const ECOMMERCE_NUMBER = '33870000000000001';

describe('carrier tracking dispatch', () => {
  it('connects the DHL capability to the sync adapter', async () => {
    const fetcher = vi.spyOn(DHLTracker.prototype, 'fetch')
      .mockResolvedValue({ status: 'in_transit', current_stage: 'in_transit', events: [] });
    expect((await new CarrierTrackingAdapter().fetch('dhl', DHL_NUMBER, null)).current_stage).toBe('in_transit');
    expect(fetcher).toHaveBeenCalledWith(DHL_NUMBER);
    fetcher.mockRestore();
  });

  it('dispatches to the eCommerce adapter', async () => {
    const fetcher = vi.spyOn(DHLEcommerceTracker.prototype, 'fetch').mockResolvedValue({ status: 'in_transit' });
    expect(await new CarrierTrackingAdapter().fetch('dhl-ecommerce', ECOMMERCE_NUMBER, null)).toMatchObject({ status: 'in_transit' });
    expect(fetcher).toHaveBeenCalledWith(ECOMMERCE_NUMBER);
    fetcher.mockRestore();
  });
});
