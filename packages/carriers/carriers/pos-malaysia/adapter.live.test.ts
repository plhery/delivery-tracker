import { describe, expect, it } from 'vitest';
import { PosMalaysiaTracker } from './adapter';

// Supply authorized parcel references through the environment, never fixtures.
describe('Pos Malaysia live anonymous tracking', () => {
  it('keeps an empty synthetic lookup inconclusive', async () => {
    await expect(new PosMalaysiaTracker({ timeoutMs: 15_000 }).fetch('MYPM00000000099'))
      .rejects.toMatchObject({
        name: 'IndeterminateError',
        kind: 'indeterminate',
      });
  });

  it.skipIf(!process.env.POS_MALAYSIA_DELIVERED_TRACKING_NUMBER)(
    'returns identity-bound history for a real delivered parcel',
    async () => {
      const trackingNumber = process.env.POS_MALAYSIA_DELIVERED_TRACKING_NUMBER!;
      const result = await new PosMalaysiaTracker({ timeoutMs: 15_000 }).fetch(trackingNumber);
      expect(result.status).toBe('delivered');
      expect(result.current_stage).toBe('delivered');
      expect(result.events?.length).toBeGreaterThan(0);
    },
  );

  it.skipIf(!process.env.POS_MALAYSIA_TRACKING_NUMBER)('returns identity-bound available history', async () => {
    const result = await new PosMalaysiaTracker({ timeoutMs: 15_000 }).fetch(process.env.POS_MALAYSIA_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some(event => event.description)).toBe(true);
    expect(result.events?.every(event => event.time || event.provider_time_text || event.summary_snapshot)).toBe(true);
    if (result.last_update === null) expect(result.events?.[0]?.time).toBeUndefined();
  });
});
