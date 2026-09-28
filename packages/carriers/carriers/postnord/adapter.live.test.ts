import { describe, expect, it } from 'vitest';
import { PostnordTracker } from './adapter';

describe('PostNord live tracking', () => {
  it('returns a structured negative with the complete anonymous request', async () => {
    await expect(new PostnordTracker().fetch('RR000000005SE')).rejects.toMatchObject({ kind: 'not_found' });
  });
  it.skipIf(!process.env.POSTNORD_TRACKING_NUMBER)('returns matching real history', async () => {
    const result = await new PostnordTracker().fetch(process.env.POSTNORD_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_update).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
