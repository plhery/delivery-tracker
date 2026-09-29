import { describe, expect, it } from 'vitest';
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
  it.skipIf(!executablePath)('keeps an unbound synthetic unknown response inconclusive', async () => {
    await expect(instance().track({ number: '0000000000001' })).rejects.toMatchObject({ kind: 'indeterminate' });
  });
});
