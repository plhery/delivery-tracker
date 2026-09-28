import { describe, expect, it } from 'vitest';
import { AustrianPostTracker } from './adapter';

describe('Austrian Post anonymous live tracking', () => {
  it.skipIf(!process.env.AUSTRIAN_POST_TRACKING_NUMBER)('returns identity-bound tracking history', async () => {
    const result = await new AustrianPostTracker().fetch(process.env.AUSTRIAN_POST_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_update).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
