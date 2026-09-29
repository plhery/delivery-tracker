import { describe, expect, it } from 'vitest';
import { adapter } from './adapter';
import { carrierErrorKind } from '../../core/errors';
import { NOOP_RECORDER } from '../../core/telemetry';

const NUMBER = process.env.CANADA_POST_LIVE_TRACKING_NUMBER?.trim();
const NOTICE = process.env.CANADA_POST_LIVE_NOTICE_NUMBER?.trim();
const native = () => adapter({ trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });

describe('Canada Post anonymous native history', () => {
  it.runIf(Boolean(NUMBER))('retrieves an identity-bound caller-supplied parcel with projected history', async () => {
    const result = await native().track({ number: NUMBER! }, { budgetMs: 20_000 });
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_status_text).toEqual(expect.any(String));
    for (const key of Object.keys(result)) expect(['status', 'current_stage', 'last_status_text', 'last_update', 'last_update_local',
      'expected_delivery', 'delivered_at', 'events', 'canonical_tracking_number', 'tracking_url', 'tracking_source']).toContain(key);
    for (const event of result.events ?? []) {
      expect(Object.keys(event).every(key => ['description', 'location', 'provider_code', 'stage', 'time', 'local_time',
        'provider_time_text', 'provider_leg', 'summary_snapshot'].includes(key))).toBe(true);
    }
  });

  it.runIf(Boolean(NOTICE))('resolves a caller-supplied delivery notice to exact native detail', async () => {
    const result = await native().track({ number: NOTICE! }, { budgetMs: 20_000 });
    expect(result.canonical_tracking_number).toEqual(expect.any(String));
    expect(result.events?.length).toBeGreaterThan(0);
  });

  it.each(['0000000000000000', '000000000000000', '0000000000000'])('keeps no-history control %s inconclusive', async number => {
    try { await native().track({ number }, { budgetMs: 20_000 }); expect.fail('expected inconclusive history'); }
    catch (error) { expect(carrierErrorKind(error)).toBe('indeterminate'); }
  });
});
