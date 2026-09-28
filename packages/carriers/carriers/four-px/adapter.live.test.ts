import { describe, expect, it } from 'vitest';
import { FourPxTracker } from './adapter';

describe('4PX live compatibility', () => {
  it.skipIf(!process.env.FOUR_PX_TRACKING_NUMBER)('returns fresh parcel history', async () => {
    const result = await new FourPxTracker().fetch(process.env.FOUR_PX_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => event.description && (event.time || event.local_time))).toBe(true);
  });

  it('recognizes the explicit synthetic missing-item result', async () => {
    await expect(new FourPxTracker().fetch('4PX0000000000000CN')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
