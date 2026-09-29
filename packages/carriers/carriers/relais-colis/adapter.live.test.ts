import { describe, expect, it } from 'vitest';
import { adapter } from './adapter';
import { NOOP_RECORDER } from '../../core/telemetry';

const carrier = adapter({ trawl: null, browserExecutablePath: null, env: {}, recorder: NOOP_RECORDER });
describe('Relais Colis anonymous live history', () => {
  it.skipIf(!process.env.RELAIS_COLIS_TRACKING_NUMBER)('retrieves identity-bound grouped scans', async () => {
    const result = await carrier.track({ number: process.env.RELAIS_COLIS_TRACKING_NUMBER! });
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_status_text).toBeTruthy();
  });
  it.skipIf(!process.env.RELAIS_COLIS_UNKNOWN_NUMBER)('identifies matching explicit no-history', async () => {
    await expect(carrier.track({ number: process.env.RELAIS_COLIS_UNKNOWN_NUMBER! })).rejects.toMatchObject({ kind: 'not_found' });
  });
});
