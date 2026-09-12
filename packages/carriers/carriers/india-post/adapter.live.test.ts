import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../core/errors';
import { IndiaPostTracker } from './adapter';

// Live compatibility checks for the MySpeedPost Livewire flow. The wrong-number
// case runs in the opt-in live suite; the real-parcel case additionally needs a
// parcel the operator is authorized to query (never commit its number).
const WRONG_VALID_NUMBER = 'RR000000005IN';

describe('India Post live tracking', () => {
  it.skipIf(!process.env.INDIA_POST_TRACKING_NUMBER)(
    'returns usable tracking history for a real consignment',
    async () => {
      const trackingNumber = process.env.INDIA_POST_TRACKING_NUMBER!;
      const result = await new IndiaPostTracker().fetch(trackingNumber);

      expect([
        'pending',
        'in_transit',
        'out_for_delivery',
        'delivered',
        'exception',
      ]).toContain(result.status);
      expect(result.last_status_text).toEqual(expect.any(String));
      expect(result.last_update).toEqual(expect.any(String));
      expect(result.events?.length).toBeGreaterThan(0);
    },
  );

  it('maps a valid-shaped synthetic number to a clean 404', async () => {
    await expect(new IndiaPostTracker().fetch(WRONG_VALID_NUMBER)).rejects.toMatchObject({
      name: 'NotFoundError',
      status: 404,
      message: 'India Post could not locate the shipment',
    });
  });

  it('pins the not-found error contract used by routing cooldowns', () => {
    expect(new NotFoundError('India Post').status).toBe(404);
  });
});
