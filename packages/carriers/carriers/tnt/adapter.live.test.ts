import { describe, expect, it } from 'vitest';
import { TntExpressTracker, TntFranceTracker } from './adapter';

describe('TNT France anonymous live tracking', () => {
  it.skipIf(!process.env.TNT_FRANCE_TRACKING_NUMBER)('returns matching shipment history', async () => {
    const result = await new TntFranceTracker().fetch(process.env.TNT_FRANCE_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_update).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('TNT international anonymous live tracking', () => {
  it.skipIf(!process.env.TNT_TRACKING_NUMBER)('returns matching shipment history', async () => {
    const result = await new TntExpressTracker().fetch(process.env.TNT_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => /[+-]\d{2}:\d{2}$|Z$/.test(event.time ?? ''))).toBe(true);
  });

  it('recognizes the explicit synthetic missing-consignment result', async () => {
    await expect(new TntExpressTracker().fetch('123456784')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
