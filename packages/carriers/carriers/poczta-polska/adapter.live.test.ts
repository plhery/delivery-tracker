import { describe, expect, it } from 'vitest';
import { PocztaPolskaTracker } from './adapter';

describe('Poczta Polska anonymous tracking live', () => {
  it.skipIf(!process.env.POCZTA_POLSKA_TRACKING_NUMBER)('returns exact-reference history', async () => {
    const result = await new PocztaPolskaTracker().fetch(process.env.POCZTA_POLSKA_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some(event => event.time || event.local_time || event.provider_time_text)).toBe(true);
  });
  it('distinguishes the exact synthetic absence response', async () => {
    await expect(new PocztaPolskaTracker().fetch('RR000000014PL')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
