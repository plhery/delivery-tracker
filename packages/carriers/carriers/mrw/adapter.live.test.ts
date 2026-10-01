import { describe, expect, it } from 'vitest';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter } from './adapter';

const instance = () => adapter({ fetcher: fetch, env: {}, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER });

describe('MRW live anonymous tracking', () => {
  it.skipIf(!process.env.MRW_TRACKING_NUMBER)('retrieves bound native history through the full factory', async () => {
    const result = await instance().track({ number: process.env.MRW_TRACKING_NUMBER! });
    expect(result.events?.length).toBeGreaterThan(1);
    expect(result.events?.[0]?.local_time).toBeTruthy();
    expect(result.summary_only).not.toBe(true);
    expect(result.last_update).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/openMap|pickup_point_address|PRIVATE_SYNTHETIC/);
  });

  it.skipIf(!process.env.MRW_SUMMARY_ONLY_NUMBER)('retains a bound status without inventing history', async () => {
    const result = await instance().track({ number: process.env.MRW_SUMMARY_ONLY_NUMBER! });
    expect(result.status).not.toBe('unknown');
    expect(result.summary_only).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.last_update).toBeNull();
  });

  it.skipIf(!process.env.MRW_UNKNOWN_NUMBER)('keeps ambiguous unknown tracking inconclusive', async () => {
    await expect(instance().track({ number: process.env.MRW_UNKNOWN_NUMBER! }))
      .rejects.toMatchObject({ kind: 'indeterminate' });
  });
});
