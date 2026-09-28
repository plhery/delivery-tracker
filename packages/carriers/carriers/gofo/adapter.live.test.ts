import { describe, expect, it } from 'vitest';
import { GofoTracker } from './adapter';

describe('Gofo live tracking', () => {
  it.skipIf(!process.env.GOFO_TRACKING_NUMBER)('returns identity-bound history', async () => {
    const result = await new GofoTracker().fetch(process.env.GOFO_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
  it.skipIf(!process.env.GOFO_UNKNOWN_NUMBER)('preserves the observed unknown-number semantics', async () => {
    await expect(new GofoTracker().fetch(process.env.GOFO_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'not_found' });
  });
});
