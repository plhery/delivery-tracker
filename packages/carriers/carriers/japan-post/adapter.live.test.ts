import { describe, expect, it } from 'vitest';
import { JapanPostTracker } from './adapter';

describe('Japan Post live compatibility', () => {
  it.skipIf(!process.env.JAPAN_POST_TRACKING_NUMBER)('returns identity-bound history without browser state', async () => {
    const result = await new JapanPostTracker().fetch(process.env.JAPAN_POST_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => event.local_time && event.description)).toBe(true);
    expect(result.events?.every((event) => event.time === undefined || /Z$/.test(event.time))).toBe(true);
    expect(result.last_update ?? null).toBe(result.events?.[0].time ?? null);
    expect(result.last_update_local).toEqual(expect.any(String));
  });

  it('recognizes the official synthetic unknown-item result', async () => {
    await expect(new JapanPostTracker().fetch('CN000000005JP')).rejects.toMatchObject({ kind: 'not_found', status: 404 });
  });
});
