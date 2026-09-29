import { describe, expect, it } from 'vitest';
import { NOOP_RECORDER } from '../../core/telemetry';
import { normalizeCarrierResult } from '../../core/result';
import { adapter } from './adapter';

const instance = () => adapter({ trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });

describe('Ninja Van live tracking', () => {
  it.skipIf(!process.env.NINJA_VAN_TRACKING_NUMBER)('returns identity-bound public history', async () => {
    const result = normalizeCarrierResult(await instance().track({ number: process.env.NINJA_VAN_TRACKING_NUMBER! }));
    expect(result.events?.length).toBeGreaterThan(0);
  });

  it.skipIf(!process.env.NINJA_VAN_UNKNOWN_NUMBER)('identifies an explicitly absent parcel', async () => {
    await expect(instance().track({ number: process.env.NINJA_VAN_UNKNOWN_NUMBER! })).rejects.toMatchObject({ kind: 'not_found' });
  });
});
