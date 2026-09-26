import { describe, expect, it } from 'vitest';
import { EvriTracker } from './adapter';

describe('Evri International live compatibility', () => {
  it.skipIf(!process.env.EVRI_TRACKING_NUMBER)('returns matching international history with anonymous HTTP', async () => {
    const result = await new EvriTracker().fetch(process.env.EVRI_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => event.local_time && event.description && !event.time)).toBe(true);
    expect(result.last_status_text).toEqual(expect.any(String));
  });

  it('recognizes a synthetic unknown international reference', async () => {
    await expect(new EvriTracker().fetch('H000000000000000')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
