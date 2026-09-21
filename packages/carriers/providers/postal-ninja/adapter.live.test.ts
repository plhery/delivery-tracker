import { describe, expect, it } from 'vitest';
import { TrawlClient } from '../../core/transport';
import { PostalNinjaTracker } from './adapter';

// Public forum reference, also used by src/server/universalScrapers.live.test.ts.
// https://www.reddit.com/r/AirReps/comments/1vfhh53/please_help_yunexpress_alibaba_tracking_stuck_on/
const number = 'YT2621200705470145';

describe.runIf(Boolean(process.env.FLARESOLVERR_URL))('Postal Ninja through TRAWL', () => {
  it('retrieves the public reference in successive isolated contexts', async () => {
    const tracker = new PostalNinjaTracker({trawl: TrawlClient.fromEnvironment(process.env)});
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await tracker.fetch(number, 30_000);
      expect(result).toMatchObject({tracking_provider: 'Postal Ninja', current_stage: 'delivered'});
      // All 32 upstream scans project successfully; two delivery wordings at
      // the same time normalize to the same milestone and are deduplicated.
      expect(result.events).toHaveLength(31);
      expect(JSON.stringify(result)).not.toMatch(/PIN:|House Number:|Door NO:/);
    }
  }, 90_000);

  it('keeps an untraceable synthetic number inconclusive', async () => {
    const tracker = new PostalNinjaTracker({trawl: TrawlClient.fromEnvironment(process.env)});
    await expect(tracker.fetch('CODEX0000000000000000', 30_000)).rejects.toMatchObject({kind: 'indeterminate'});
  }, 45_000);
});
