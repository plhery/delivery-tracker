import { describe, expect, it } from 'vitest';
import { adapter } from './adapter';
import { NOOP_RECORDER } from '../../core/telemetry';

const instance = () => adapter({ fetcher: fetch, env: {}, recorder: NOOP_RECORDER, trawl: null, browserExecutablePath: null });

describe('Correos de Chile live anonymous tracking', () => {
  it.skipIf(!process.env.CORREOS_CHILE_TRACKING_NUMBER)('retrieves bound history through the full factory', async () => {
    const result = await instance().track({ number: process.env.CORREOS_CHILE_TRACKING_NUMBER! });
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.[0]?.description).toBeTruthy();
    expect(JSON.stringify(result)).not.toMatch(/RutEntrega|NombreEntrega|sucursales|Avisos|Errores/);
  });
  it.skipIf(!process.env.CORREOS_CHILE_UNKNOWN_NUMBER)('keeps ambiguous missing history inconclusive', async () => {
    await expect(instance().track({ number: process.env.CORREOS_CHILE_UNKNOWN_NUMBER! }))
      .rejects.toMatchObject({ kind: 'indeterminate' });
  });
});
