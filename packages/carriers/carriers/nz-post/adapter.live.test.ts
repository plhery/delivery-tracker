import { describe, expect, it } from 'vitest';
import { NzPostTracker } from './adapter';

describe('NZ Post anonymous tracking live', () => {
  it.skipIf(!process.env.NZ_POST_TRACKING_NUMBER)('returns exact-reference history', async () => {
    const result = await new NzPostTracker().fetch(process.env.NZ_POST_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some(event => event.time)).toBe(true);
  });
  it('distinguishes the explicit synthetic absence response', async () => {
    await expect(new NzPostTracker().fetch('98765432109876543210')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
