import { describe, expect, it } from 'vitest';
import { InpostTracker, InpostTrackingError } from './inpost';

// Live compatibility checks for the keyless inposteasy.com hub. The wrong-number
// case runs in the opt-in live suite; the real-parcel case additionally needs a
// parcel the operator is authorized to query (never commit its number).
describe('InPost live anonymous tracking', () => {
  it('maps a validly shaped wrong number to a clean 404', async () => {
    await expect(new InpostTracker({ timeoutMs: 15_000 }).fetch('000000000000000000000000'))
      .rejects.toMatchObject({
        name: 'InpostTrackingError',
        status: 404,
        message: 'InPost could not locate the shipment',
      });
  });

  it.skipIf(!process.env.INPOST_DELIVERED_TRACKING_NUMBER)(
    'returns identity-bound history for a real delivered parcel',
    async () => {
      const trackingNumber = process.env.INPOST_DELIVERED_TRACKING_NUMBER!;
      const result = await new InpostTracker({ timeoutMs: 15_000 }).fetch(trackingNumber);
      expect(result.status).toBe('delivered');
      expect(result.current_stage).toBe('delivered');
      expect(result.events?.length).toBeGreaterThan(0);
    },
  );

  it('pins the not-found error contract used by routing cooldowns', () => {
    expect(new InpostTrackingError().status).toBe(404);
  });
});
