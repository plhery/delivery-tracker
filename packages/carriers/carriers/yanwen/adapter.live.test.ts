import { describe, expect, it } from 'vitest';
import { YanwenTracker } from './adapter';

describe('Yanwen live compatibility', () => {
  it.skipIf(!process.env.YANWEN_TRACKING_NUMBER)('returns fresh anonymous parcel history', async () => {
    const result = await new YanwenTracker().fetch(process.env.YANWEN_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => event.description && event.time)).toBe(true);
  });

  it('recognizes an identity-bound missing-item result', async () => {
    await expect(new YanwenTracker().fetch('UK000000005YP')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
