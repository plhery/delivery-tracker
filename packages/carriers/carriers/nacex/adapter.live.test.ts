import { describe, expect, it } from 'vitest';
import { NacexTracker } from './adapter';

describe('NACEX live tracking', () => {
  it.skipIf(!process.env.NACEX_TRACKING_NUMBER)('returns matching detailed scans', async () => {
    const result = await new NacexTracker().fetch(process.env.NACEX_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
  it.skipIf(!process.env.NACEX_UNKNOWN_NUMBER)('identifies an explicit no-shipment result', async () => {
    await expect(new NacexTracker().fetch(process.env.NACEX_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'not_found' });
  });
});
