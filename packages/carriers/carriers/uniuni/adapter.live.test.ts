import { describe, expect, it } from 'vitest';
import { UniuniTracker } from './adapter';

describe('UniUni live tracking', () => {
  it.skipIf(!process.env.UNIUNI_TRACKING_NUMBER)('returns identity-bound history', async () => {
    const result = await new UniuniTracker().fetch(process.env.UNIUNI_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });

  it.skipIf(!process.env.UNIUNI_UNKNOWN_NUMBER)('identifies explicit absence', async () => {
    await expect(new UniuniTracker().fetch(process.env.UNIUNI_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'not_found' });
  });
});
