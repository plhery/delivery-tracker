import { describe, expect, it } from 'vitest';
import { USPSTracker } from './adapter';

// A real shipment supplied outside the repository, e.g.
// USPS_LIVE_TRACKING_NUMBER=9400111201080805483016 npm run test:carriers:live
// Open-source rule: never commit the number, a response, or any private
// field it returns. The wrong-number probe below needs no browser service.
const LIVE_TRACKING_NUMBER = (process.env.USPS_LIVE_TRACKING_NUMBER ?? '').trim();

describe('USPS live browser tracking', () => {
  it('reports the missing browser service instead of burning a direct attempt', async () => {
    await expect(new USPSTracker({ trawlUrl: '', timeoutMs: 5_000 }).fetch('9400111201080805483016'))
      .rejects.toMatchObject({
        name: 'ChallengeError',
        message: 'USPS challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
      });
  });

  it.runIf(Boolean(LIVE_TRACKING_NUMBER))(
    'normalizes a caller-supplied real shipment without retaining private response fields',
    async () => {
      const result = await new USPSTracker({ timeoutMs: 90_000 }).fetch(LIVE_TRACKING_NUMBER);
      expect(result.status).not.toBe('unknown');
      expect(result.last_status_text).toEqual(expect.any(String));
      expect((result.events ?? []).length).toBeGreaterThan(0);
      for (const key of Object.keys(result)) {
        expect([
          'status',
          'current_stage',
          'last_status_text',
          'last_update',
          'last_update_local',
          'expected_delivery',
          'events',
          'tracking_source',
          'tracking_url',
        ]).toContain(key);
      }
      for (const event of result.events ?? []) {
        expect(Object.keys(event).every((key) => [
          'description',
          'location',
          'stage',
          'time',
          'local_time',
          'raw_time',
        ].includes(key))).toBe(true);
      }
    },
  );
});
