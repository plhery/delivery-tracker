import { describe, expect, it } from 'vitest';
import { TntFranceTracker } from './adapter';

describe('TNT France anonymous live tracking', () => {
  it.skipIf(!process.env.TNT_FRANCE_TRACKING_NUMBER)('returns matching shipment history', async () => {
    const result = await new TntFranceTracker().fetch(process.env.TNT_FRANCE_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_update).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
