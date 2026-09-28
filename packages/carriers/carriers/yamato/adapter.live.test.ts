import { describe, expect, it } from 'vitest';
import { YamatoTracker } from './adapter';

describe('Yamato live compatibility', () => {
  it.skipIf(!process.env.YAMATO_TRACKING_NUMBER)('returns identity-bound domestic history without browser state', async () => {
    const result = await new YamatoTracker().fetch(process.env.YAMATO_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_status_text).toEqual(expect.any(String));
    expect(result.events?.every((event) => event.description && event.provider_time_text)).toBe(true);
    expect(result.events?.every((event) => !event.time || /Z$/.test(event.time))).toBe(true);
    expect(result.last_update ?? null).toBe(result.events?.[0].time ?? null);
  });
});
