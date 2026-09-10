import { describe, expect, it } from 'vitest';
import { PostalNinjaTracker } from './postalNinja';
import { Ship24Tracker } from './ship24';

// Public forum example; no account or recipient details required.
// https://www.reddit.com/r/AirReps/comments/1vfhh53/please_help_yunexpress_alibaba_tracking_stuck_on/
const number = 'YT2621200705470145';

describe.runIf(Boolean(process.env.TRACKING_CHROMIUM_PATH))('universal form scrapers', () => {
  for (const [name, tracker] of [
    ['Postal Ninja', new PostalNinjaTracker()], ['Ship24', new Ship24Tracker()],
  ] as const) {
    it(`retrieves matching history from ${name}`, async () => {
      const result = await tracker.fetch(number);
      expect(result.tracking_provider).toBe(name);
      expect(result.current_stage).toBe('delivered');
      expect(result.events?.length).toBeGreaterThan(0);
      expect(JSON.stringify(result)).not.toMatch(/PIN:|House Number:|Door NO:/);
    }, 55_000);
  }
});
