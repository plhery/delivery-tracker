import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../core/errors';
import { PacketaTracker } from './adapter';

// Live compatibility checks for the keyless consumer endpoint. The wrong-number
// case runs in the opt-in live suite; the real-parcel case additionally needs a
// parcel the operator is authorized to query (never commit its number).
describe('Packeta live anonymous tracking', () => {
  it('maps a validly shaped wrong number to a clean 404', async () => {
    await expect(new PacketaTracker({ timeoutMs: 15_000 }).fetch('Z0000000000'))
      .rejects.toMatchObject({
        name: 'NotFoundError',
        status: 404,
        message: 'Packeta could not locate the shipment',
      });
  });

  it.skipIf(!process.env.PACKETA_DELIVERED_TRACKING_NUMBER)(
    'returns identity-bound history for a real delivered parcel',
    async () => {
      const trackingNumber = process.env.PACKETA_DELIVERED_TRACKING_NUMBER!;
      const result = await new PacketaTracker({ timeoutMs: 15_000 }).fetch(trackingNumber);
      expect(result.status).toBe('delivered');
      expect(result.current_stage).toBe('delivered');
      expect(result.timezone).toBe('Europe/Prague');
      expect(result.events?.length).toBeGreaterThan(0);
    },
  );

  it('pins the not-found error contract used by routing cooldowns', () => {
    expect(new NotFoundError('Packeta').status).toBe(404);
  });
});
