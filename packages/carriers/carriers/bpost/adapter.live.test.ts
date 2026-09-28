import { describe, expect, it } from 'vitest';
import { BpostTracker } from './adapter';

describe('bpost live tracking', () => {
  it('recognizes the anonymous batch endpoint missing-item response', async () => {
    await expect(new BpostTracker().fetch('999999999999999999999999')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it.skipIf(!process.env.BPOST_TRACKING_NUMBER)('returns matching real history without a postcode', async () => {
    const result = await new BpostTracker().fetch(process.env.BPOST_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => event.description && event.local_time && !event.time)).toBe(true);
  });
});
