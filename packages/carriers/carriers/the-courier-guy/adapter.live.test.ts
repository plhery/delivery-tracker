import { describe, expect, it } from 'vitest';
import { CourierGuyTracker } from './adapter';

describe('The Courier Guy live tracking', () => {
  it.skipIf(!process.env.COURIER_GUY_TRACKING_NUMBER)('returns matching shipment history', async () => {
    const result = await new CourierGuyTracker().fetch(process.env.COURIER_GUY_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
  });
  it.skipIf(!process.env.COURIER_GUY_UNKNOWN_NUMBER)('recognizes only explicit absence', async () => {
    await expect(new CourierGuyTracker().fetch(process.env.COURIER_GUY_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'not_found' });
  });
});
