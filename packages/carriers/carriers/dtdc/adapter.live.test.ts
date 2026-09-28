import { describe, expect, it } from 'vitest';
import { DtdcTracker } from './adapter';

describe('DTDC live compatibility', () => {
  it.skipIf(!process.env.DTDC_TRACKING_NUMBER)('returns identity-bound dated history without session state', async () => {
    const result = await new DtdcTracker().fetch(process.env.DTDC_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_status_text).toEqual(expect.any(String));
    expect(result.last_update).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.events?.every(event => event.description && event.time && /Z$/.test(event.time))).toBe(true);
  });
});
