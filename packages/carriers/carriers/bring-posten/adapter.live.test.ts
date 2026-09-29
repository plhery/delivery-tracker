import { describe, expect, it } from 'vitest';
import { BringTracker } from './adapter';

describe('Bring live consumer tracking', () => {
  it.skipIf(!process.env.BRING_TRACKING_NUMBER)('returns exact matching history', async () => {
    const result = await new BringTracker().fetch(process.env.BRING_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
  it.skipIf(!process.env.BRING_UNKNOWN_NUMBER)('keeps unbound absence inconclusive', async () => {
    await expect(new BringTracker().fetch(process.env.BRING_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'indeterminate' });
  });
});
