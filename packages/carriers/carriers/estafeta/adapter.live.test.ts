import { describe, expect, it } from 'vitest';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter, EstafetaTracker } from './adapter';

describe('Estafeta live tracking', () => {
  it.skipIf(!process.env.ESTAFETA_TRACKING_NUMBER)('returns exact single-piece local history', async () => {
    const instance = adapter({ fetcher: fetch, env: {}, recorder: NOOP_RECORDER, trawl: null, browserExecutablePath: null });
    const result = await instance.track({ number: process.env.ESTAFETA_TRACKING_NUMBER! });
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some(event => event.local_time)).toBe(true);
    expect(result.last_update).toBeNull();
  });
  it.skipIf(!process.env.ESTAFETA_UNKNOWN_NUMBER)('keeps unbound unavailable information inconclusive', async () => {
    await expect(new EstafetaTracker().fetch(process.env.ESTAFETA_UNKNOWN_NUMBER!)).rejects.toMatchObject({ kind: 'indeterminate' });
  });
  it.skipIf(!process.env.ESTAFETA_MULTIPIECE_NUMBER)('rejects ambiguous multiple-piece guides', async () => {
    await expect(new EstafetaTracker().fetch(process.env.ESTAFETA_MULTIPIECE_NUMBER!)).rejects.toMatchObject({ kind: 'indeterminate' });
  });
});
