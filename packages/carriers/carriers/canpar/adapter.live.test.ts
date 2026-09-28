import { describe, expect, it } from 'vitest';
import { CanparTracker } from './adapter';

describe('Canpar live tracking', () => {
  it.skipIf(!process.env.CANPAR_TRACKING_NUMBER)('returns identity-bound history', async () => {
    const result = await new CanparTracker().fetch(process.env.CANPAR_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });

  it.skipIf(!process.env.CANPAR_UNKNOWN_NUMBER)('keeps empty results inconclusive', async () => {
    await expect(new CanparTracker().fetch(process.env.CANPAR_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'indeterminate' });
  });
});
