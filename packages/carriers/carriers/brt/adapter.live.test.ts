import { describe, expect, it } from 'vitest';
import { BrtTracker } from './adapter';

describe('BRT anonymous live history', () => {
  it.skipIf(!process.env.BRT_TRACKING_NUMBER)('retrieves exact BRTcode tracking scans', async () => {
    const result = await new BrtTracker().fetch(process.env.BRT_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_update).toBeNull();
  });
  it.skipIf(!process.env.BRT_UNKNOWN_NUMBER)('identifies the explicit matching no-parcel result', async () => {
    await expect(new BrtTracker().fetch(process.env.BRT_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'not_found' });
  });
});
