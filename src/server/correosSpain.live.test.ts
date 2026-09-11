import { describe, expect, it } from 'vitest';
import { CorreosSpainTracker, CorreosSpainTrackingError } from './correosSpain';

// Live compatibility checks for the keyless localizador endpoint. Unknown codes
// answer 200 with a non-zero codError, which the adapter maps to a clean 404.
// The real-parcel case additionally needs a parcel the operator is authorized
// to query (never commit its number).
describe('Correos Spain live anonymous tracking', () => {
  it('maps a validly shaped wrong number to a clean 404', async () => {
    await expect(new CorreosSpainTracker({ timeoutMs: 15_000 }).fetch('PR000000000000000C'))
      .rejects.toMatchObject({
        name: 'CorreosSpainTrackingError',
        status: 404,
        message: 'Correos could not locate the shipment',
      });
  });

  it.skipIf(!process.env.CORREOS_SPAIN_DELIVERED_TRACKING_NUMBER)(
    'returns identity-bound history for a real delivered parcel',
    async () => {
      const trackingNumber = process.env.CORREOS_SPAIN_DELIVERED_TRACKING_NUMBER!;
      const result = await new CorreosSpainTracker({ timeoutMs: 15_000 }).fetch(trackingNumber);
      expect(result.status).toBe('delivered');
      expect(result.current_stage).toBe('delivered');
      expect(result.events?.length).toBeGreaterThan(0);
    },
  );

  it('pins the not-found error contract used by routing cooldowns', () => {
    expect(new CorreosSpainTrackingError().status).toBe(404);
  });
});
