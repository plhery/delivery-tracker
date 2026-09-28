import { describe, expect, it } from 'vitest';
import { EcoscootingTracker } from './adapter';

describe('Ecoscooting live tracking', () => {
  it.skipIf(!process.env.ECOSCOOTING_TRACKING_NUMBER)('returns identity-bound history', async () => {
    const result = await new EcoscootingTracker().fetch(process.env.ECOSCOOTING_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
  it.skipIf(!process.env.ECOSCOOTING_UNKNOWN_NUMBER)('preserves the observed unknown-number semantics', async () => {
    await expect(new EcoscootingTracker().fetch(process.env.ECOSCOOTING_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'indeterminate' });
  });
});
