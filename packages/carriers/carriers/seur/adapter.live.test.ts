import { describe, expect, it } from 'vitest';
import { adapter } from './adapter';

const instance = () => adapter({ fetcher: fetch, env: {}, trawl: null, browserExecutablePath: null,
  recorder: { step() {}, lookup() {} } });

describe('SEUR public simple tracking', () => {
  it.skipIf(!process.env.SEUR_TRACKING_NUMBER)('retrieves identity-bound history through the full factory', async () => {
    const result = await instance().track({ number: process.env.SEUR_TRACKING_NUMBER! });
    expect(result.events?.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/pin_entrega|pin_locker|deliverer_latitude|comentario_bbdd/);
  });
  it.skipIf(!process.env.SEUR_UNKNOWN_NUMBER)('keeps no-history controls inconclusive', async () => {
    await expect(instance().track({ number: process.env.SEUR_UNKNOWN_NUMBER! })).rejects.toMatchObject({ kind: 'indeterminate' });
  });
});
