import { describe, expect, it } from 'vitest';
import { LandmarkTracker } from './adapter';

describe('Landmark live tracking', () => {
  it.skipIf(!process.env.LANDMARK_GLOBAL_TRACKING_NUMBER)('returns identity-bound history', async () => {
    const result = await new LandmarkTracker().fetch(process.env.LANDMARK_GLOBAL_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
  it.skipIf(!process.env.LANDMARK_GLOBAL_UNKNOWN_NUMBER)('preserves the observed unknown-number semantics', async () => {
    await expect(new LandmarkTracker().fetch(process.env.LANDMARK_GLOBAL_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'not_found' });
  });
  it.skipIf(!process.env.LANDMARK_GLOBAL_ALIAS_NUMBER)('binds an N1 alias to the same canonical parcel', async () => {
    const number = process.env.LANDMARK_GLOBAL_ALIAS_NUMBER!;
    const result = await new LandmarkTracker().fetch(number);
    expect(result.canonical_tracking_number).toBe(number.replace(/N1$/, ''));
    expect(result.events?.length).toBeGreaterThan(0);
  });
});
