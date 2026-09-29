import { describe, expect, it } from 'vitest';
import { adapter } from './adapter';
import { NOOP_RECORDER } from '../../core/telemetry';

const instance = () => adapter({ fetcher: fetch, env: {}, recorder: NOOP_RECORDER, trawl: null, browserExecutablePath: null });

describe('Ciblex live anonymous tracking', () => {
  it.skipIf(!process.env.CIBLEX_TRACKING_NUMBER)('retrieves identity-bound history through the full factory', async () => {
    const result = await instance().track({ number: process.env.CIBLEX_TRACKING_NUMBER! });
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.some(event => event.time)).toBe(true);
  });
  it.skipIf(!process.env.CIBLEX_UNKNOWN_NUMBER)('keeps an empty table or empty200 inconclusive', async () => {
    await expect(instance().track({ number: process.env.CIBLEX_UNKNOWN_NUMBER! })).rejects.toMatchObject({ kind: 'indeterminate' });
  });
});
