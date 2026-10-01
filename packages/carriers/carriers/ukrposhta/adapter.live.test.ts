import { describe, expect, it } from 'vitest';
import { ChallengeError } from '../../core/errors';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter } from './adapter';

const executablePath = process.env.TRACKING_CHROMIUM_PATH;
const instance = () => adapter({ browserExecutablePath: executablePath ?? null, trawl: null, recorder: NOOP_RECORDER, env: {} });

describe('Ukrposhta native anonymous browser live', () => {
  it.skipIf(!executablePath || !process.env.UKRPOSHTA_TRACKING_NUMBER)('returns complete matching history', async () => {
    const result = normalizeCarrierResult(await instance().track({ number: process.env.UKRPOSHTA_TRACKING_NUMBER! }));
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some(event => event.local_time || event.provider_time_text)).toBe(true);
    expect(result.last_update).toBeNull();
  });
  it.skipIf(!executablePath)('keeps an unbound synthetic unknown response inconclusive', async (context) => {
    const error: unknown = await instance().track({ number: '0000000000001' }).then(() => undefined, caught => caught);
    // The portal scores the browser invisibly and refuses lookups below its
    // threshold. A refused browser proves neither breakage nor health.
    if (error instanceof ChallengeError) return context.skip('Ukrposhta refused the browser\'s automatic verification: adapter remains unverified');
    expect(error).toMatchObject({ kind: 'indeterminate' });
  });
});
