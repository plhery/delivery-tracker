import { describe, expect, it } from 'vitest';
import { CanadaPostTracker } from './adapter';

// A real shipment supplied outside the repository, e.g.
// CANADA_POST_LIVE_TRACKING_NUMBER=0073938000549297 npm run test:carriers:live
// Open-source rule: never commit the number, a response, or any private
// field it returns.
const LIVE_TRACKING_NUMBER = (process.env.CANADA_POST_LIVE_TRACKING_NUMBER ?? '').trim();
// An expired open-source example: the endpoint answers, but knows no history.
const EXPIRED_NUMBER = '0073938000549297';

describe('Canada Post live anonymous tracking', () => {
  it('maps an expired number to the unlocated unknown result', async () => {
    const result = await new CanadaPostTracker({ timeoutMs: 20_000 }).fetch(EXPIRED_NUMBER);
    expect(result).toMatchObject({ status: 'unknown', events: [] });
  });

  it.runIf(Boolean(LIVE_TRACKING_NUMBER))(
    'normalizes a caller-supplied real shipment without retaining private response fields',
    async () => {
      const result = await new CanadaPostTracker({ timeoutMs: 20_000 }).fetch(LIVE_TRACKING_NUMBER);
      expect(result.status).not.toBe('unknown');
      expect(result.last_status_text).toEqual(expect.any(String));
      expect((result.events ?? []).length).toBeGreaterThan(0);
      for (const key of Object.keys(result)) {
        expect([
          'status',
          'current_stage',
          'last_status_text',
          'last_update',
          'expected_delivery',
          'delivered_at',
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
  );
});
