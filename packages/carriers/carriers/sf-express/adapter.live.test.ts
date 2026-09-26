import { describe, expect, it } from 'vitest';
import { SfExpressTracker } from './adapter';
import { TrawlClient } from '../../core/transport';

const trawl = TrawlClient.fromEnvironment();
const number = process.env.SF_EXPRESS_TRACKING_NUMBER;

describe('SF Express live public tracking', () => {
  it.skipIf(!trawl || !number)('returns matched dated history through the browser service', async () => {
    const result = await new SfExpressTracker({ trawl }).fetch(number!);
    expect(result.events?.length).toBeGreaterThan(0);
    const expectedCount = Number(process.env.SF_EXPRESS_EXPECTED_EVENTS);
    if (Number.isInteger(expectedCount) && expectedCount > 0) expect(result.events).toHaveLength(expectedCount);
    expect(result.events?.every((event) => typeof event.local_time === 'string' && !event.time)).toBe(true);
    expect(result.last_status_text).toEqual(expect.any(String));
  });

  it.skipIf(!trawl || process.env.SF_EXPRESS_CHECK_RESTRICTION !== '1')('preserves the observed synthetic-query restriction', async () => {
    await expect(new SfExpressTracker({ trawl }).fetch('SF0000000000000')).rejects.toMatchObject({ kind: 'challenge' });
  });
});
