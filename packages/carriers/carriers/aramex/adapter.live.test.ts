import { describe, expect, it } from 'vitest';
import { AramexTracker } from './adapter';

// The direct site blocks unattended requests from server and CI networks.
// Keep this diagnostic available only when the caller opts into that site.
describe.runIf(process.env.ARAMEX_DIRECT_LIVE === '1')('Aramex direct live tracking', () => {
  it('returns the explicit no-results page', async () => {
    await expect(new AramexTracker().fetch('999999999999')).rejects.toMatchObject({ kind: 'not_found' });
  });
  it.skipIf(!process.env.ARAMEX_TRACKING_NUMBER)('returns matching real scans', async () => {
    expect((await new AramexTracker().fetch(process.env.ARAMEX_TRACKING_NUMBER!)).events?.length).toBeGreaterThan(0);
  });
});
