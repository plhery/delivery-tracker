import { describe, expect, it } from 'vitest';
import { KoreaPostTracker } from './adapter';

describe('Korea Post live compatibility', () => {
  it.skipIf(!process.env.KOREA_POST_TRACKING_NUMBER)('returns fresh international parcel history', async () => {
    const result = await new KoreaPostTracker().fetch(process.env.KOREA_POST_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => event.description && event.local_time)).toBe(true);
    expect(result.last_update).toBeNull();
  });

  it('recognizes the identity-bound missing-item table', async () => {
    await expect(new KoreaPostTracker().fetch('EE999999995KR')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
