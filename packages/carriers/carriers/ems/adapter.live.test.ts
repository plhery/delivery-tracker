import { describe, expect, it } from 'vitest';
import { EmsTracker } from './adapter';

describe('EMS live compatibility', () => {
  it.skipIf(!process.env.EMS_TRACKING_NUMBER)('returns real EMS history without browser state', async () => {
    const result = await new EmsTracker().fetch(process.env.EMS_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_status_text).toEqual(expect.any(String));
    expect(result.events?.every((event) => event.time && event.description)).toBe(true);
  });

  it('recognizes the synthetic empty lookup', async () => {
    await expect(new EmsTracker().fetch('EB000000005CN')).rejects.toMatchObject({ kind: 'not_found', status: 404 });
  });
});
