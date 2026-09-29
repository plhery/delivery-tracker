import { describe, expect, it } from 'vitest';
import { NOOP_RECORDER } from '../../core/telemetry';
import { adapter } from './adapter';

const instance = () => adapter({ fetcher: fetch, trawl: null, browserExecutablePath: null, recorder: NOOP_RECORDER, env: {} });

describe('Ecoscooting live tracking', () => {
  it.skipIf(!process.env.ECOSCOOTING_TRACKING_NUMBER)('returns identity-bound history', async () => {
    const result = await instance().track({ number: process.env.ECOSCOOTING_TRACKING_NUMBER! });
    expect(result.events?.length).toBeGreaterThan(0);
  });
  it.skipIf(!process.env.ECOSCOOTING_PORTUGAL_NUMBER)('returns Portuguese history and completion evidence', async () => {
    const result = await instance().track({ number: process.env.ECOSCOOTING_PORTUGAL_NUMBER! });
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.status).toBe('delivered');
    expect(result.delivered_at).toBe(result.last_update);
    expect(result.events?.every(event => event.time)).toBe(true);
  });
  it.skipIf(!process.env.ECOSCOOTING_UNKNOWN_NUMBER)('preserves the observed unknown-number semantics', async () => {
    await expect(instance().track({ number: process.env.ECOSCOOTING_UNKNOWN_NUMBER! })).rejects.toMatchObject({ kind: 'indeterminate' });
  });
});
