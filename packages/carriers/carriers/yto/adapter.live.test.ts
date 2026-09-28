import { describe, expect, it } from 'vitest';
import { IndeterminateError } from '../../core/errors';
import { YtoTracker } from './adapter';

describe('YTO live compatibility', () => {
  it.skipIf(!process.env.YTO_TRACKING_NUMBER)('returns identity-bound domestic history without browser state', async () => {
    const result = await new YtoTracker().fetch(process.env.YTO_TRACKING_NUMBER!);
    expect(result.events?.length).toBeGreaterThan(0);
    expect(result.last_status_text).toEqual(expect.any(String));
    expect(result.events?.every(event => event.description && event.provider_code && (event.time || event.provider_time_text))).toBe(true);
  });

  it.skipIf(!process.env.YTO_TRACKING_NUMBER)('keeps an identity-only synthetic response indeterminate', async () => {
    await expect(new YtoTracker().fetch('YT0000000000001')).rejects.toBeInstanceOf(IndeterminateError);
  });
});
