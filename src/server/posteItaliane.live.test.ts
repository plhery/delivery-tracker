import { describe, expect, it } from 'vitest';
import { PosteItalianeTracker, PosteItalianeTrackingError } from './posteItaliane';

// Live compatibility checks for the keyless DoveQuando endpoint. Unknown codes
// answer esitoRicerca "1"; old expired parcels omit esitoRicerca with empty
// movements. Both map to a clean 404. The real-parcel case additionally needs
// a parcel the operator is authorized to query (never commit its number).
describe('Poste Italiane live anonymous tracking', () => {
  it('maps a validly shaped wrong number to a clean 404', async () => {
    await expect(new PosteItalianeTracker({ timeoutMs: 15_000 }).fetch('RA00000000000'))
      .rejects.toMatchObject({
        name: 'PosteItalianeTrackingError',
        status: 404,
        message: 'Poste Italiane could not locate the shipment',
      });
  });

  it.skipIf(!process.env.POSTE_ITALIANE_DELIVERED_TRACKING_NUMBER)(
    'returns identity-bound history for a real delivered parcel',
    async () => {
      const trackingNumber = process.env.POSTE_ITALIANE_DELIVERED_TRACKING_NUMBER!;
      const result = await new PosteItalianeTracker({ timeoutMs: 15_000 }).fetch(trackingNumber);
      expect(result.status).toBe('delivered');
      expect(result.current_stage).toBe('delivered');
      expect(result.events?.length).toBeGreaterThan(0);
    },
  );

  it('pins the not-found error contract used by routing cooldowns', () => {
    expect(new PosteItalianeTrackingError().status).toBe(404);
  });
});
