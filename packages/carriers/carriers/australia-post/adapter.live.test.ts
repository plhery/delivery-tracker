import { describe, expect, it } from 'vitest';
import { AustraliaPostTracker } from './adapter';
import { TrawlClient } from '../../core/transport';

const trawl = TrawlClient.fromEnvironment();
const number = process.env.AUSTRALIA_POST_TRACKING_NUMBER;

describe('Australia Post live browser compatibility', () => {
  it.skipIf(!trawl || !number)('returns matched public history through the browser service', async () => {
    const result = await new AustraliaPostTracker({ trawl }).fetch(number!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => event.time && /(?:Z|[+-]\d{2}:\d{2})$/.test(event.time))).toBe(true);
    expect(result.last_status_text).toEqual(expect.any(String));
  });

  it.skipIf(!trawl)('recognizes a synthetic unknown reference', async () => {
    await expect(new AustraliaPostTracker({ trawl }).fetch('7T0000000000000000000')).rejects.toMatchObject({ kind: 'not_found' });
  });
});
