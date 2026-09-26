import { describe, expect, it } from 'vitest';
import { ChallengeError, UpstreamHttpError } from '@carriers/core/errors';
import { PostalNinjaTracker } from '@carriers/providers/postal-ninja/adapter';
import { Ship24Tracker } from '@carriers/providers/ship24/adapter';

// Public forum example; no account or recipient details required.
// https://www.reddit.com/r/AirReps/comments/1vfhh53/please_help_yunexpress_alibaba_tracking_stuck_on/
const number = 'YT2621200705470145';

describe.runIf(Boolean(process.env.TRACKING_CHROMIUM_PATH))('universal form scrapers', () => {
  for (const [name, tracker] of [
    ['Postal Ninja', new PostalNinjaTracker()], ['Ship24', new Ship24Tracker()],
  ] as const) {
    it(`retrieves matching history from ${name}`, async (context) => {
      const result = await tracker.fetch(number).catch((error: unknown) => {
        // An unsolved challenge, or a block of the runner's network, proves
        // neither breakage nor health.
        if (error instanceof ChallengeError) return context.skip(`${name} browser challenge: provider remains unverified`);
        if (error instanceof UpstreamHttpError && [403, 429].includes(error.status)) {
          return context.skip(`${name} answered HTTP ${error.status} to this network: provider remains unverified`);
        }
        throw error;
      });
      expect(result.tracking_provider).toBe(name);
      expect(result.current_stage).toBe('delivered');
      expect(result.events?.length).toBeGreaterThan(0);
      expect(JSON.stringify(result)).not.toMatch(/PIN:|House Number:|Door NO:/);
    }, 55_000);
  }
});
