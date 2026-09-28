import { describe, expect, it } from 'vitest';
import { CttExpressTracker } from './adapter';

describe('CTT Express live tracking', () => {
  it.skipIf(!process.env.CTT_EXPRESS_TRACKING_NUMBER)('returns matching real history', async () => {
    const result = await new CttExpressTracker().fetch(process.env.CTT_EXPRESS_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
});
