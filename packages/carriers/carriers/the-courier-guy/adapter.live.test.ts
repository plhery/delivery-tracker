import { describe, expect, it } from 'vitest';
import { normalizeCarrierResult } from '../../core/result';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter } from './adapter';

const instance = () => adapter({ trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });

describe('The Courier Guy live tracking', () => {
  it.skipIf(!process.env.COURIER_GUY_TRACKING_NUMBER)('returns matching shipment history', async () => {
    const result = normalizeCarrierResult(await instance().track({ number: process.env.COURIER_GUY_TRACKING_NUMBER! }));
    expect(result.events?.length).toBeGreaterThan(0);
  });
  it.skipIf(!process.env.COURIER_GUY_UNKNOWN_NUMBER)('recognizes only explicit absence', async () => {
    await expect(instance().track({ number: process.env.COURIER_GUY_UNKNOWN_NUMBER! })).rejects.toMatchObject({ kind: 'not_found' });
  });
});
