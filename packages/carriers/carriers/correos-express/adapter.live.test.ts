import { describe, expect, it } from 'vitest';
import { CorreosExpressTracker } from './adapter';

describe('Correos Express live tracking', () => {
  it.skipIf(!process.env.CORREOS_EXPRESS_TRACKING_NUMBER)('returns matching public history', async () => {
    const result = await new CorreosExpressTracker().fetch(process.env.CORREOS_EXPRESS_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
  it.skipIf(!process.env.CORREOS_EXPRESS_UNKNOWN_NUMBER)('identifies an explicit portal negative', async () => {
    await expect(new CorreosExpressTracker().fetch(process.env.CORREOS_EXPRESS_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'not_found' });
  });
});
