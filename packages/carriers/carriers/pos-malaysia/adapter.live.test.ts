import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../core/errors';
import { PosMalaysiaTracker } from './adapter';

// Live compatibility checks for the ttu-svc track-and-trace endpoint. Unknown
// codes answer 200 with null tracking_data, which the adapter maps to a clean
// 404. The real-parcel case additionally needs a parcel the operator is
// authorized to query (never commit its number).
describe('Pos Malaysia live anonymous tracking', () => {
  it('maps a validly shaped wrong number to a clean 404', async () => {
    await expect(new PosMalaysiaTracker({ timeoutMs: 15_000 }).fetch('MYPM00000000099'))
      .rejects.toMatchObject({
        name: 'NotFoundError',
        status: 404,
        message: 'Pos Malaysia could not locate the shipment',
      });
  });

  it.skipIf(!process.env.POS_MALAYSIA_DELIVERED_TRACKING_NUMBER)(
    'returns identity-bound history for a real delivered parcel',
    async () => {
      const trackingNumber = process.env.POS_MALAYSIA_DELIVERED_TRACKING_NUMBER!;
      const result = await new PosMalaysiaTracker({ timeoutMs: 15_000 }).fetch(trackingNumber);
      expect(result.status).toBe('delivered');
      expect(result.current_stage).toBe('delivered');
      expect(result.timezone).toBe('Asia/Kuala_Lumpur');
      expect(result.events?.length).toBeGreaterThan(0);
    },
  );

  it('pins the not-found error contract used by routing cooldowns', () => {
    expect(new NotFoundError('Pos Malaysia').status).toBe(404);
  });
});
