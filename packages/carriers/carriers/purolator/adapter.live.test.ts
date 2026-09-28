import { describe, expect, it } from 'vitest';
import { PurolatorTracker } from './adapter';

describe('Purolator live tracking', () => {
  it.skipIf(!process.env.PUROLATOR_TRACKING_NUMBER)('returns matching real history', async () => {
    const result = await new PurolatorTracker().fetch(process.env.PUROLATOR_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
});
