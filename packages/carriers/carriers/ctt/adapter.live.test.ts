import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../core/errors';
import { CttTracker } from './adapter';

// Live compatibility checks for the OutSystems session flow. Unknown codes
// answer Found:false with a clear backend; the maintenance sibling tells an
// outage apart. The real-parcel case additionally needs a parcel the operator
// is authorized to query (never commit its number).
describe('CTT live anonymous tracking', () => {
  it('maps a validly shaped wrong number to a clean 404', async () => {
    await expect(new CttTracker({ timeoutMs: 20_000 }).fetch('RL000000005PT'))
      .rejects.toMatchObject({
        name: 'NotFoundError',
        status: 404,
        message: 'CTT could not locate the shipment',
      });
  });

  it.skipIf(!process.env.CTT_DELIVERED_TRACKING_NUMBER)(
    'returns identity-bound history for a real delivered parcel',
    async () => {
      const trackingNumber = process.env.CTT_DELIVERED_TRACKING_NUMBER!;
      const result = await new CttTracker({ timeoutMs: 20_000 }).fetch(trackingNumber);
      expect(result.status).toBe('delivered');
      expect(result.current_stage).toBe('delivered');
      expect(result.events?.length).toBeGreaterThan(0);
    },
  );

  it('pins the not-found error contract used by routing cooldowns', () => {
    expect(new NotFoundError('CTT').status).toBe(404);
  });
});
