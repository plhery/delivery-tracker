import { describe, expect, it } from 'vitest';
import { RoyalMailTracker } from './adapter';

// A real shipment supplied outside the repository, e.g.
// ROYAL_MAIL_LIVE_TRACKING_NUMBER=SG999999999GB npm run test:carriers:live
// Open-source rule: never commit the number, a response, or any private
// field it returns. The wrong-number probe below needs no browser service.
const LIVE_TRACKING_NUMBER = (process.env.ROYAL_MAIL_LIVE_TRACKING_NUMBER ?? '').trim();

describe('Royal Mail live browser tracking', () => {
  it('reports the missing browser service instead of burning a direct attempt', async () => {
    await expect(new RoyalMailTracker({ trawlUrl: '', timeoutMs: 5_000 }).fetch('SG999999999GB'))
      .rejects.toMatchObject({
        name: 'ChallengeError',
        message: 'Royal Mail challenged direct tracking; configure FLARESOLVERR_URL for browser fallback',
      });
  });

  it.runIf(Boolean(LIVE_TRACKING_NUMBER))(
    'normalizes a caller-supplied real shipment without retaining private response fields',
    async () => {
      const result = await new RoyalMailTracker({ timeoutMs: 60_000 }).fetch(LIVE_TRACKING_NUMBER);
      expect(result.status).not.toBe('unknown');
      expect(result.last_status_text).toEqual(expect.any(String));
      expect(Array.isArray(result.events)).toBe(true);
      for (const key of Object.keys(result)) {
        expect([
          'status',
          'current_stage',
          'last_status_text',
          'last_update',
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
          'provider_code',
          'stage',
          'time',
        ].includes(key))).toBe(true);
      }
    },
    80_000,
  );
});
