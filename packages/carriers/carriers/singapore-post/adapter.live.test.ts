import { describe, expect, it } from 'vitest';
import { SingaporePostTracker } from './adapter';

describe('Singapore Post live compatibility', () => {
  it.skipIf(!process.env.SINGAPORE_POST_TRACKING_NUMBER)('returns fresh parcel history', async () => {
    const result = await new SingaporePostTracker().fetch(process.env.SINGAPORE_POST_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => event.description && (event.time || event.local_time))).toBe(true);
  });

  it('recognizes the explicit synthetic missing-item result', async () => {
    await expect(new SingaporePostTracker().fetch('RR000000005SG')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
