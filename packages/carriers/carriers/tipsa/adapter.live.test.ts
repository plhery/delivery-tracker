import { describe, expect, it } from 'vitest';
import { adapter } from './adapter';
import { NOOP_RECORDER } from '../../core/telemetry';

const instance = () => adapter({ fetcher: fetch, env: {}, recorder: NOOP_RECORDER, trawl: null, browserExecutablePath: null });

describe('TIPSA live shipment page', () => {
  it('answers a well-formed unknown reference with a clean not-found', async () => {
    await expect(instance().track({ number: '0990010990010000000017' })).rejects.toMatchObject({ kind: 'not_found' });
  });

  it.skipIf(!process.env.TIPSA_TRACKING_NUMBER)('reads a real reference on Madrid time without recipient details', async () => {
    const result = await instance().track({ number: process.env.TIPSA_TRACKING_NUMBER! });
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.events?.every((event) => /T\d{2}:\d{2}:00\+0[12]:00$/.test(event.time ?? ''))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/Destinatario|Remitente|Receptor|Observaciones/);
  });
});
