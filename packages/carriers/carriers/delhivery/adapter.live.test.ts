import { describe, expect, it } from 'vitest';
import { DelhiveryTracker } from './adapter';

describe('Delhivery live tracking', () => {
  it('returns the explicit invalid-or-old waybill result', async () => {
    await expect(new DelhiveryTracker().fetch('0000000000000')).rejects.toMatchObject({ kind: 'not_found' });
  });
  it.skipIf(!process.env.DELHIVERY_TRACKING_NUMBER)('returns matching real scans', async () => {
    expect((await new DelhiveryTracker().fetch(process.env.DELHIVERY_TRACKING_NUMBER!)).events?.length).toBeGreaterThan(0);
  });
});
