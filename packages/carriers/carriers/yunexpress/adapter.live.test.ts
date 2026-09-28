import { describe, expect, it } from 'vitest';
import { TrawlClient } from '../../core/transport';
import { YunExpressTracker } from './adapter';

const enabled = Boolean(process.env.FLARESOLVERR_URL || process.env.TRACKING_CHROMIUM_PATH);
const tracker = () => new YunExpressTracker({ trawl: TrawlClient.fromEnvironment(), executablePath: process.env.TRACKING_CHROMIUM_PATH });

describe.skipIf(!enabled)('YunExpress live browser compatibility', () => {
  it.skipIf(!process.env.YUNEXPRESS_TRACKING_NUMBER)('captures fresh anonymous parcel history', async () => {
    const result = await tracker().fetch(process.env.YUNEXPRESS_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => event.description && (event.time || event.local_time))).toBe(true);
  });

  it('recognizes an identity-bound missing-item response', async () => {
    await expect(tracker().fetch('YT0000000000000000')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
